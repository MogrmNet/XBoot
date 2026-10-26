// Local document ingestion (browser only). Files NEVER leave the device during ingestion.
// PDF text via pdf.js; image-only pages / screenshots via Tesseract.js OCR (ara+eng). Libraries load from jsDelivr on demand.
// Per-page status is tracked honestly: ok | ocr | ocr_low | failed. Nothing is reported as indexed unless it was processed.
import { sanitizeText } from './retrieval.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
export const MAX_BYTES = 25 * 1024 * 1024;
export const OCR_LOW_CONF = 60;
const TEXT_EXT = /\.(txt|md|csv|json)$/i;

/* ---------- IndexedDB ---------- */
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('garhi-local', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('records', { keyPath: 'id' }).createIndex('docId', 'docId');
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
};
const all = store => tx(store, 'readonly', s => s.getAll());

export const listDocs = () => all('docs');
export const listRecords = () => all('records');
export const putRecord = r => tx('records', 'readwrite', s => s.put(r));
export async function deleteDoc(id) {
  const recs = (await listRecords()).filter(r => r.docId === id);
  const d = await db();
  await new Promise((res, rej) => {
    const t = d.transaction(['docs', 'records', 'blobs'], 'readwrite');
    t.objectStore('docs').delete(id);
    t.objectStore('blobs').delete(id);
    recs.forEach(r => t.objectStore('records').delete(r.id));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}

/* ---------- helpers ---------- */
const uid = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function validateFile(file) {
  if (file.size > MAX_BYTES) return 'الملف أكبر من 25MB.';
  const ok = /^(application\/pdf|image\/(png|jpe?g|webp))$/.test(file.type) || TEXT_EXT.test(file.name);
  return ok ? null : 'نوع الملف غير مدعوم. المسموح: PDF, PNG, JPG, WEBP, TXT, MD, CSV, JSON.';
}

export function summarizeDoc(doc) {
  const parts = [`تمت معالجة ${doc.pagesOk + doc.pagesLow} من ${doc.pagesTotal} صفحة`];
  if (doc.pagesLow) parts.push(`${doc.pagesLow} منها OCR بثقة منخفضة (تحتاج مراجعة يدوية)`);
  if (doc.pagesFailed) parts.push(`${doc.pagesFailed} صفحة فشلت وتحتاج إعادة معالجة`);
  return parts.join(' · ');
}

function makeRecord(doc, page, text, status, conf) {
  const low = status === 'ocr_low';
  return {
    id: `${doc.id}-p${page ?? 'x'}-${uid().slice(-4)}`,
    docId: doc.id, filename: doc.name, page,
    title: page ? `${doc.name} — صفحة ${page}` : doc.name,
    category: 'ملف مضاف', terms: [], steps: [],
    summary: sanitizeText(text, 6000),
    sourcePages: page ? [page] : [],
    evidence: status === 'failed' ? 'فشلت معالجة الصفحة.'
      : low ? `OCR بثقة منخفضة (${Math.round(conf)}%) — يلزم تحقق يدوي من النص.`
      : status === 'ocr' ? `نص مستخرج بـOCR (ثقة ${Math.round(conf)}%) — غير معتمد.`
      : 'ملف أضافه المستخدم محليًا — غير معتمد.',
    status: 'user-upload', origin: 'upload', pageStatus: status, confidence: conf ?? null,
  };
}

/* ---------- lazy libs ---------- */
let pdfLib, tessLoad;
async function getPdfjs() {
  if (!pdfLib) {
    pdfLib = await import(/* @vite-ignore */ PDFJS);
    const src = await (await fetch(PDFJS_WORKER)).text();
    pdfLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  return pdfLib;
}
function getTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tessLoad ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = TESS; s.onload = () => res(window.Tesseract); s.onerror = () => rej(new Error('تعذر تحميل مكتبة OCR'));
    document.head.appendChild(s);
  });
  return tessLoad;
}
let ocrWorker;
async function ocr(canvasOrBlob) {
  const T = await getTesseract();
  ocrWorker ??= await T.createWorker('ara+eng');
  const { data } = await ocrWorker.recognize(canvasOrBlob);
  return { text: data.text.trim(), conf: data.confidence };
}

/* ---------- per-source processing ---------- */
async function processPdfPage(pdf, n) {
  const page = await pdf.getPage(n);
  const tc = await page.getTextContent();
  const text = tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
  if (text.length >= 40) return { text, status: 'ok', conf: null };
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  const r = await ocr(canvas);
  if (!r.text) return { text: '', status: 'failed', conf: r.conf };
  return { text: r.text, status: r.conf < OCR_LOW_CONF ? 'ocr_low' : 'ocr', conf: r.conf };
}

function chunkText(text, max = 1100) {
  const out = []; let cur = '';
  for (const para of text.split(/\n{2,}|\r\n{2,}/)) {
    if ((cur + '\n' + para).length > max && cur) { out.push(cur); cur = para; } else cur = cur ? cur + '\n' + para : para;
  }
  if (cur.trim()) out.push(cur);
  return out.flatMap(c => c.length > max * 1.5 ? c.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [c]);
}

export async function ingestFile(file, onProgress = () => {}) {
  const err = validateFile(file);
  if (err) throw new Error(err);
  const doc = { id: uid(), name: file.name, type: file.type || 'text', size: file.size, addedAt: Date.now(), pagesTotal: 0, pagesOk: 0, pagesLow: 0, pagesFailed: 0 };
  const records = [];
  const isPdf = file.type === 'application/pdf';
  const isImg = file.type.startsWith('image/');

  if (isPdf) {
    const pdfjs = await getPdfjs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    doc.pagesTotal = pdf.numPages;
    await tx('blobs', 'readwrite', s => s.put({ id: doc.id, blob: file }));
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress({ page: n, total: pdf.numPages });
      let r;
      try { r = await processPdfPage(pdf, n); } catch { r = { text: '', status: 'failed', conf: null }; }
      records.push(makeRecord(doc, n, r.text, r.status, r.conf));
    }
  } else if (isImg) {
    doc.pagesTotal = 1;
    onProgress({ page: 1, total: 1 });
    let r;
    try { const o = await ocr(file); r = o.text ? { text: o.text, status: o.conf < OCR_LOW_CONF ? 'ocr_low' : 'ocr', conf: o.conf } : { text: '', status: 'failed', conf: o.conf }; }
    catch { r = { text: '', status: 'failed', conf: null }; }
    await tx('blobs', 'readwrite', s => s.put({ id: doc.id, blob: file }));
    records.push(makeRecord(doc, 1, r.text, r.status, r.conf));
  } else {
    const text = await file.text();
    if (/\.json$/i.test(file.name)) {
      let arr; try { const j = JSON.parse(text); arr = Array.isArray(j) ? j : [j]; } catch { throw new Error('ملف JSON غير صالح.'); }
      arr.slice(0, 500).forEach((o, i) => {
        // Uploaded JSON can NEVER claim to be approved/verified.
        const r = makeRecord(doc, null, [o.title, o.summary].filter(Boolean).join(' — ') || JSON.stringify(o), 'ok', null);
        r.title = sanitizeText(o.title || `${file.name} #${i + 1}`, 160);
        r.terms = Array.isArray(o.terms) ? o.terms.map(t => sanitizeText(t, 60)).slice(0, 30) : [];
        r.steps = Array.isArray(o.steps) ? o.steps.map(t => sanitizeText(t, 300)).slice(0, 10) : [];
        r.sourcePages = Array.isArray(o.sourcePages) ? o.sourcePages.filter(Number.isInteger).slice(0, 20) : [];
        r.summary = sanitizeText(o.summary || r.summary, 1500);
        records.push(r);
      });
      doc.pagesTotal = records.length;
    } else {
      chunkText(text).forEach(c => records.push(makeRecord(doc, null, c, 'ok', null)));
      doc.pagesTotal = records.length;
    }
  }
  doc.pagesOk = records.filter(r => r.pageStatus === 'ok' || r.pageStatus === 'ocr').length;
  doc.pagesLow = records.filter(r => r.pageStatus === 'ocr_low').length;
  doc.pagesFailed = records.filter(r => r.pageStatus === 'failed').length;
  const d = await db();
  await new Promise((res, rej) => {
    const t = d.transaction(['docs', 'records'], 'readwrite');
    t.objectStore('docs').put(doc);
    records.forEach(r => t.objectStore('records').put(r));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return { doc, records };
}

export async function retryFailed(docId, onProgress = () => {}) {
  const docs = await listDocs();
  const doc = docs.find(d => d.id === docId);
  const blob = (await tx('blobs', 'readonly', s => s.get(docId)))?.blob;
  if (!doc || !blob) throw new Error('الملف الأصلي غير متاح لإعادة المعالجة.');
  const recs = (await listRecords()).filter(r => r.docId === docId && r.pageStatus === 'failed');
  if (!recs.length) return doc;
  const pdf = blob.type === 'application/pdf' ? await (await getPdfjs()).getDocument({ data: await blob.arrayBuffer() }).promise : null;
  for (const rec of recs) {
    onProgress({ page: rec.page, total: doc.pagesTotal });
    try {
      const r = pdf ? await processPdfPage(pdf, rec.page) : await (async () => { const o = await ocr(blob); return { text: o.text, status: o.text ? (o.conf < OCR_LOW_CONF ? 'ocr_low' : 'ocr') : 'failed', conf: o.conf }; })();
      Object.assign(rec, makeRecord(doc, rec.page, r.text, r.status, r.conf), { id: rec.id });
    } catch { /* stays failed */ }
    await putRecord(rec);
  }
  const fresh = (await listRecords()).filter(r => r.docId === docId);
  Object.assign(doc, {
    pagesOk: fresh.filter(r => r.pageStatus === 'ok' || r.pageStatus === 'ocr').length,
    pagesLow: fresh.filter(r => r.pageStatus === 'ocr_low').length,
    pagesFailed: fresh.filter(r => r.pageStatus === 'failed').length,
  });
  await tx('docs', 'readwrite', s => s.put(doc));
  return doc;
}

// Manual correction of extracted text (clears the low-confidence flag, still unverified/unapproved).
export async function correctRecord(rec, newText) {
  rec.summary = sanitizeText(newText, 6000);
  if (rec.pageStatus === 'failed' || rec.pageStatus === 'ocr_low') rec.pageStatus = 'corrected';
  rec.evidence = 'نص تم تصحيحه يدويًا بواسطة المستخدم — غير معتمد.';
  await putRecord(rec);
  const docs = await listDocs();
  const doc = docs.find(d => d.id === rec.docId);
  if (doc) {
    const fresh = (await listRecords()).filter(r => r.docId === doc.id);
    doc.pagesOk = fresh.filter(r => ['ok', 'ocr', 'corrected'].includes(r.pageStatus)).length;
    doc.pagesLow = fresh.filter(r => r.pageStatus === 'ocr_low').length;
    doc.pagesFailed = fresh.filter(r => r.pageStatus === 'failed').length;
    await tx('docs', 'readwrite', s => s.put(doc));
  }
}
