import { search, retrieveForConversation } from './retrieval.js';
import { renderMarkdown, esc } from './render.js';
import { streamChat, checkHealth } from './api.js';
import * as ing from './ingest.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const LS_C = 'garhi.convs.v1', LS_S = 'garhi.settings.v1';
const NEW_TITLE = 'محادثة جديدة';
const cfg = window.GARHI_CONFIG || {};

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ } };

const saved = lsGet(LS_S, {});
const settings = { apiUrl: saved.apiUrl || cfg.apiUrl || '', token: saved.token || '', share: saved.share !== false };
const S = { builtin: [], local: [], docs: [], convs: lsGet(LS_C, []), active: null, busy: false, abort: null, mode: 'chat', health: { state: 'unconfigured' }, cat: null };

/* ---------- helpers ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('تم النسخ'); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('تم النسخ'); } catch { toast('تعذر النسخ'); } ta.remove(); }
}
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const persist = () => { S.convs = S.convs.slice(0, 50); lsSet(LS_C, S.convs.map(c => ({ ...c, messages: c.messages.filter(m => !m.transient) }))); };
const conv = () => S.convs.find(c => c.id === S.active);

const STATUS_AR = { historical: 'تاريخي / غير معتمد', training: 'مرجع تدريبي', policy: 'قاعدة', approved: 'معتمد', 'user-upload': 'ملف مضاف — غير معتمد' };
const LABEL_UI = { 'VERIFIED': ['v', 'موثّق'], 'PARTIALLY VERIFIED': ['p', 'موثّق جزئيًا'], 'CONFLICTING SOURCES': ['c', 'مصادر متعارضة'], 'NOT FOUND': ['n', 'غير موجود في المراجع'] };

/* ---------- status / health ---------- */
const HEALTH_TXT = { unconfigured: 'AI غير مُعد', down: 'الخادم غير متاح', nokey: 'الخادم متصل · بدون مفتاح AI', ready: 'AI مُعد' };
async function refreshHealth() {
  S.health = await checkHealth(settings.apiUrl);
  const el = $('#status');
  el.className = 'status ' + S.health.state;
  el.querySelector('em').textContent = HEALTH_TXT[S.health.state];
  el.title = S.health.state === 'ready' ? 'مفتاح الـAPI مضاف على الخادم (لا يعني أنه تم اختباره)' : 'افتح الإعدادات لضبط رابط الخادم';
  return S.health;
}

/* ---------- rendering ---------- */
function srcHtml(s) {
  const pg = s.pages?.length ? `ص ${s.pages.join('، ')}` : 'بدون رقم صفحة';
  const steps = s.steps?.length ? `<ol>${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '';
  return `<details class="src"><summary><span>${esc(s.title)}</span><span class="st">${esc(STATUS_AR[s.status] || s.status)}</span><span class="pg">${esc(pg)}</span></summary>
    <div class="ex"><div>${esc(s.excerpt)}</div>${steps}${s.note ? `<div class="nt">${esc(s.note)}</div>` : ''}</div></details>`;
}
function verdictHtml(m) {
  if (!m.meta) return '';
  const [cls, ar] = LABEL_UI[m.meta.label] || ['n', m.meta.label];
  const unverified = (m.meta.sources || []).some(s => s.status !== 'approved');
  const note = m.meta.label === 'NOT FOUND' ? 'لا يوجد دليل كافٍ في المراجع المتاحة.'
    : unverified ? 'المصادر المسترجعة غير معتمدة (تاريخية/ملفات مضافة) — راجع الإجراء الرسمي أو المشرف قبل التنفيذ.' : '';
  const gen = m.meta.generated === false ? ' · رد ثابت (بدون توليد AI)' : '';
  return `<div class="verdict"><span class="badge ${cls}">${esc(m.meta.label)}</span><span class="vtext"><b>${ar}</b>${gen}${note ? ' — ' + note : ''}</span></div>` +
    (m.meta.sources?.length ? `<div class="sources">${m.meta.sources.map(srcHtml).join('')}</div>` : '');
}
function msgHtml(m, i, last) {
  if (m.role === 'info') return `<div class="msg info"><div class="av">ⓘ</div><div class="body"><div class="bubble">${esc(m.content)}</div></div></div>`;
  const user = m.role === 'user';
  let inner;
  if (user) inner = esc(m.content);
  else if (m.error) inner = `<strong>تعذر الحصول على إجابة.</strong><br>${esc(m.error.message)}`;
  else if (!m.content) inner = '<span class="typing" aria-label="جاري الكتابة"><i></i><i></i><i></i></span>';
  else inner = renderMarkdown(m.content);
  const streaming = S.busy && last && !user && !m.error && m.content;
  const acts = !user && !S.busy && (m.error ? `<div class="acts"><button data-act="retry">↻ إعادة المحاولة</button><button data-act="local">بحث محلي في المراجع</button></div>`
    : m.content ? `<div class="acts"><button data-act="copy" data-i="${i}">نسخ الإجابة</button>${m.stopped ? '<span class="vtext"> (تم إيقاف التوليد)</span>' : ''}</div>` : '') || '';
  return `<div class="msg ${user ? 'user' : 'assistant'} ${m.error ? 'err' : ''}" data-i="${i}"><div class="av">${user ? 'أنت' : 'G'}</div><div class="body"><div class="who">${user ? 'أنت' : 'GARHI'}</div>
    <div class="bubble${streaming ? ' cursor' : ''}" dir="auto">${inner}</div>${user ? '' : verdictHtml(m)}${acts}</div></div>`;
}
function renderMessages(stick = true) {
  const c = conv(); const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  $('#welcome').classList.toggle('hidden', !!(c && c.messages.length));
  let th = $('#thread');
  if (!th) { th = document.createElement('div'); th.id = 'thread'; th.className = 'thread'; box.appendChild(th); }
  th.innerHTML = c ? c.messages.map((m, i) => msgHtml(m, i, i === c.messages.length - 1)).join('') : '';
  if (stick && nearBottom) box.scrollTop = box.scrollHeight;
  $('#convTitle').textContent = c && c.title !== NEW_TITLE ? c.title : 'GARHI';
  updateComposerState();
}
let raf = 0;
const scheduleRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderMessages(); }); };

function renderConvList() {
  const q = $('#convSearch').value.trim().toLowerCase();
  const list = S.convs.filter(c => !q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content?.toLowerCase().includes(q)));
  $('#convList').innerHTML = list.length ? list.map(c => `<div class="conv ${c.id === S.active ? 'active' : ''}" data-id="${c.id}">
    <button class="t" data-open="${c.id}" title="${esc(c.title)}">${esc(c.title)}</button>
    <button class="mini-i" data-rename="${c.id}" title="إعادة تسمية" aria-label="إعادة تسمية">✎</button>
    <button class="mini-i" data-del="${c.id}" title="حذف" aria-label="حذف">🗑</button></div>`).join('')
    : '<p class="hint" style="padding:8px">لا توجد محادثات.</p>';
}

/* ---------- conversations ---------- */
function newChat() {
  const existing = S.convs.find(c => c.title === NEW_TITLE && !c.messages.length);
  if (existing) { S.active = existing.id; }
  else { const c = { id: uid(), title: NEW_TITLE, updated: Date.now(), messages: [] }; S.convs.unshift(c); S.active = c.id; }
  closeSidebar(); renderConvList(); renderMessages(); $('#input').focus();
}
function ensureConv() { if (!conv()) newChat(); return conv(); }

/* ---------- sending ---------- */
const currentMode = () => $('input[name=mode]:checked').value;
function updateComposerState() {
  $('#send').classList.toggle('hidden', S.busy); $('#stop').classList.toggle('hidden', !S.busy);
  $('#send').disabled = !$('#input').value.trim();
}
async function send(text) {
  text = String(text ?? '').trim();
  if (!text || S.busy) return;
  const c = ensureConv();
  c.messages.push({ role: 'user', content: text });
  if (c.title === NEW_TITLE) c.title = text.replace(/\s+/g, ' ').slice(0, 42);
  c.updated = Date.now();
  $('#input').value = ''; autosize();
  await run(c);
}
async function run(c) {
  const mode = currentMode();
  const a = { role: 'assistant', content: '', meta: null };
  c.messages.push(a);
  S.busy = true; S.abort = new AbortController(); renderMessages(); renderConvList();
  const history = c.messages.slice(0, -1).filter(m => (m.role === 'user' || m.role === 'assistant') && !m.error && m.content).map(({ role, content }) => ({ role, content }));
  const clientPassages = settings.share && S.local.length
    ? retrieveForConversation(S.local, history, { k: 3 }).map(r => ({ id: r.id, title: r.title, pages: r.sourcePages, text: String(r.summary).slice(0, 1500) })) : [];
  $('#note').textContent = clientPassages.length ? `تم إرفاق ${clientPassages.length} مقتطفات من ملفاتك المحلية مع هذا السؤال.` : 'لا تُدخل بيانات شخصية للعملاء (أرقام، رقم قومي، كلمات سر، OTP).';
  try {
    const { got } = await streamChat({
      apiUrl: settings.apiUrl, token: settings.token, messages: history, mode, clientPassages, signal: S.abort.signal,
      onMeta: m => { a.meta = m; scheduleRender(); },
      onDelta: t => { a.content += t; scheduleRender(); },
    });
    if (!got && !a.content) a.error = { code: 'EMPTY', message: 'الخادم رجّع رد فاضي. أعد المحاولة.' };
  } catch (e) {
    if (e?.name === 'AbortError') { a.stopped = true; if (!a.content) c.messages.pop(); }
    else a.error = { code: e.code || 'ERR', message: e.message || 'حصل خطأ غير متوقع.' };
  } finally {
    S.busy = false; S.abort = null; c.updated = Date.now(); persist(); renderMessages(); renderConvList();
    if (a.error && (a.error.code === 'NO_API_KEY' || a.error.code === 'NOT_CONFIGURED')) refreshHealth();
  }
}
async function retry() {
  const c = conv(); if (!c || S.busy) return;
  while (c.messages.length && c.messages.at(-1).role !== 'user') c.messages.pop();
  if (c.messages.length) await run(c);
}

/* ---------- local search (clearly NOT AI) ---------- */
const allRecs = () => [...S.local, ...S.builtin];
function cardHtml(d) {
  const pg = (d.sourcePages || []).map(p => `<span class="pill pg">ص ${p}</span>`).join('');
  return `<div class="card"><h5>${esc(d.title)}</h5><small>${esc(d.category)}</small><p>${esc(d.summary)}</p>
    ${d.steps?.length ? `<ol>${d.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    <div class="row"><span class="pill">${esc(STATUS_AR[d.status] || d.status)}</span>${pg}
    <button class="mini" data-ask="${esc(d.title)}">اسأل عنها في الشات</button>
    <button class="mini" data-copy-text="${esc(d.title + '\n' + d.summary + '\nالمصدر: ' + (d.filename || 'tech.pdf') + (d.sourcePages?.length ? ' — ص ' + d.sourcePages.join('، ') : ''))}">نسخ</button></div></div>`;
}
function runRefSearch(q) {
  const r = q.trim() ? search(allRecs(), q, { k: 8 }) : [];
  $('#refResults').innerHTML = !q.trim() ? '' : r.length ? r.map(cardHtml).join('') : '<p class="hint">مفيش نتيجة مطابقة في المراجع المفهرسة. ده معناه إن المعلومة مش موجودة في الفهرس، مش إنها غير صحيحة.</p>';
}
function openRefs(tab = 'search', query = '') { $('#refs').classList.add('open'); setTab(tab); if (query) { $('#refQuery').value = query; runRefSearch(query); } }
function setTab(t) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $('#tabSearch').classList.toggle('hidden', t !== 'search'); $('#tabCases').classList.toggle('hidden', t !== 'cases'); $('#tabFiles').classList.toggle('hidden', t !== 'files');
  if (t === 'cases') renderCases(); if (t === 'files') renderFiles();
}
function renderCases() {
  const cats = [...new Set(allRecs().map(d => d.category))];
  S.cat ??= cats[0];
  $('#catChips').innerHTML = cats.map(c => `<button data-cat="${esc(c)}" class="${c === S.cat ? 'active' : ''}">${esc(c)}</button>`).join('');
  $('#caseResults').innerHTML = allRecs().filter(d => d.category === S.cat).map(cardHtml).join('');
}

/* ---------- files tab ---------- */
async function loadLocal() {
  try { S.docs = await ing.listDocs(); S.local = await ing.listRecords(); } catch { S.docs = []; S.local = []; }
}
function renderFiles() {
  $('#fileList').innerHTML = S.docs.length ? S.docs.sort((a, b) => b.addedAt - a.addedAt).map(d => {
    const pct = d.pagesTotal ? Math.round(((d.pagesOk + d.pagesLow) / d.pagesTotal) * 100) : 0;
    const review = S.local.filter(r => r.docId === d.id && ['ocr_low', 'failed', 'corrected'].includes(r.pageStatus));
    return `<div class="card"><h5>${esc(d.name)}</h5><small>${esc(ing.summarizeDoc(d))}</small><div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row">${d.pagesFailed ? `<button class="mini" data-retry="${d.id}">إعادة معالجة الصفحات الفاشلة</button>` : ''}<button class="mini" data-deldoc="${d.id}">حذف الملف</button></div>
      ${review.length ? `<details><summary class="hint">مراجعة وتصحيح (${review.length})</summary>${review.map(r => `<div><small>صفحة ${r.page ?? '—'} · ${esc(r.evidence)}</small>
        <textarea data-rec="${r.id}" dir="auto">${esc(r.summary)}</textarea><button class="mini" data-saverec="${r.id}">حفظ التصحيح</button></div>`).join('')}</details>` : ''}</div>`;
  }).join('') : '<p class="hint">لا توجد ملفات مضافة بعد.</p>';
}
async function addFiles(files, mode) {
  for (const f of files) {
    const err = ing.validateFile(f);
    if (err) { toast(`${f.name}: ${err}`); continue; }
    const c = ensureConv();
    const info = { role: 'info', content: `جاري معالجة ${f.name}…`, transient: true };
    c.messages.push(info); renderMessages();
    try {
      const { doc, records } = await ing.ingestFile(f, p => { info.content = `جاري معالجة ${f.name} — صفحة ${p.page} من ${p.total}…`; scheduleRender(); });
      info.content = `${f.name}: ${ing.summarizeDoc(doc)}. الملف محلي وغير معتمد.`; info.transient = false;
      await loadLocal();
      if (mode === 'quiz' && records[0]?.summary) {
        $('#input').value = records[0].summary; autosize(); updateComposerState();
        const r = records[0];
        $('#note').className = 'note warn';
        $('#note').textContent = r.pageStatus === 'ocr_low' || r.pageStatus === 'ocr'
          ? `تم استخراج النص بـOCR (ثقة ${Math.round(r.confidence ?? 0)}%). راجع السؤال والاختيارات وصحّح أي خطأ قبل الإرسال.` : 'راجع النص المستخرج قبل الإرسال.';
      }
    } catch (e) { info.content = `تعذرت معالجة ${f.name}: ${e.message}`; info.transient = false; }
    persist(); renderMessages();
  }
}

/* ---------- UI wiring ---------- */
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; }
const openSidebar = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };

$('#composer').addEventListener('submit', e => { e.preventDefault(); send($('#input').value); });
$('#input').addEventListener('input', () => { autosize(); updateComposerState(); $('#note').className = 'note'; });
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($('#input').value); } });
$('#stop').addEventListener('click', () => S.abort?.abort());
$('#attach').addEventListener('click', () => $('#file').click());
$('#addFiles').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs, currentMode()); });
$$('input[name=mode]').forEach(r => r.addEventListener('change', () => {
  const m = currentMode();
  $('#input').placeholder = m === 'quiz' ? 'الصق السؤال والاختيارات (A, B, C…)'
    : m === 'call' ? 'شكوى العميل + الخدمة + المؤشرات + اللي اتجرب…' : 'اكتب سؤالك هنا…';
}));
$('#suggestions').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.quiz) { $('input[name=mode][value=quiz]').click(); $('#input').focus(); toast('وضع حل الكويز: الصق السؤال أو أرفق صورة'); }
  else send(b.dataset.q);
});
$('#newChat').addEventListener('click', newChat);
$('#openSidebar').addEventListener('click', openSidebar);
$('#closeSidebar').addEventListener('click', closeSidebar);
$('#scrim').addEventListener('click', closeSidebar);
$('#convSearch').addEventListener('input', renderConvList);
$('#clearChat').addEventListener('click', () => {
  const c = conv(); if (!c || !c.messages.length || S.busy) return;
  if (confirm('مسح كل رسائل المحادثة الحالية؟')) { c.messages = []; c.title = NEW_TITLE; persist(); renderMessages(); renderConvList(); }
});
$('#convList').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'), r = e.target.closest('[data-rename]'), d = e.target.closest('[data-del]');
  if (o && !S.busy) { S.active = o.dataset.open; closeSidebar(); renderConvList(); renderMessages(); }
  if (r) { const c = S.convs.find(x => x.id === r.dataset.rename); const t = prompt('اسم المحادثة:', c.title); if (t?.trim()) { c.title = t.trim().slice(0, 60); persist(); renderConvList(); renderMessages(false); } }
  if (d && confirm('حذف هذه المحادثة نهائيًا؟')) {
    S.convs = S.convs.filter(x => x.id !== d.dataset.del); if (S.active === d.dataset.del) S.active = null; persist(); renderConvList(); renderMessages();
  }
});
$('#messages').addEventListener('click', e => {
  const t = e.target.closest('[data-copy-text]'); if (t) return copy(t.dataset.copyText);
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'copy') copy(conv().messages[+b.dataset.i].content);
  if (b.dataset.act === 'retry') retry();
  if (b.dataset.act === 'local') { const u = [...conv().messages].reverse().find(m => m.role === 'user'); openRefs('search', u?.content || ''); }
});
$('#openRefs').addEventListener('click', () => { closeSidebar(); openRefs(); });
$('#closeRefs').addEventListener('click', () => $('#refs').classList.remove('open'));
$$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
let deb; $('#refQuery').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => runRefSearch(e.target.value), 120); });
$('#refs').addEventListener('click', async e => {
  const t = e.target.closest('[data-copy-text]'); if (t) return copy(t.dataset.copyText);
  const a = e.target.closest('[data-ask]'); if (a) { $('#refs').classList.remove('open'); $('#input').value = `اشرح لي: ${a.dataset.ask}`; autosize(); updateComposerState(); $('#input').focus(); return; }
  const c = e.target.closest('[data-cat]'); if (c) { S.cat = c.dataset.cat; renderCases(); return; }
  const rt = e.target.closest('[data-retry]'); if (rt) { rt.disabled = true; try { await ing.retryFailed(rt.dataset.retry, p => toast(`صفحة ${p.page} من ${p.total}…`)); } catch (er) { toast(er.message); } await loadLocal(); renderFiles(); return; }
  const dd = e.target.closest('[data-deldoc]'); if (dd && confirm('حذف الملف وكل نصوصه المستخرجة من هذا المتصفح؟')) { await ing.deleteDoc(dd.dataset.deldoc); await loadLocal(); renderFiles(); return; }
  const sv = e.target.closest('[data-saverec]'); if (sv) { const rec = S.local.find(r => r.id === sv.dataset.saverec); const ta = $(`textarea[data-rec="${sv.dataset.saverec}"]`); await ing.correctRecord(rec, ta.value); await loadLocal(); renderFiles(); toast('تم حفظ التصحيح (ما زال غير معتمد)'); }
});

/* settings */
const dlg = $('#settings');
$('#openSettings').addEventListener('click', async () => {
  closeSidebar(); $('#setApi').value = settings.apiUrl; $('#setToken').value = settings.token; $('#setShare').checked = settings.share;
  $('#setStatus').textContent = 'الحالة: ' + HEALTH_TXT[S.health.state]; dlg.showModal();
});
dlg.addEventListener('close', async () => {
  if (dlg.returnValue !== 'save') return;
  settings.apiUrl = $('#setApi').value.trim(); settings.token = $('#setToken').value; settings.share = $('#setShare').checked;
  lsSet(LS_S, settings); const h = await refreshHealth(); toast('الحالة: ' + HEALTH_TXT[h.state]);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#refs').classList.remove('open'); closeSidebar(); } });
window.addEventListener('online', refreshHealth);

/* ---------- init ---------- */
(async function init() {
  try { S.builtin = (await (await fetch('knowledge.json')).json()).map(d => ({ ...d, origin: 'builtin' })); } catch { S.builtin = []; toast('تعذر تحميل knowledge.json'); }
  await loadLocal();
  S.active = S.convs[0]?.id ?? null;
  renderConvList(); renderMessages(); updateComposerState();
  refreshHealth();
})();
