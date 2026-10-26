// Quiz parsing + exact/similar matching against records with an answer key.
// A record is a quiz key only if: category contains "Quiz", it has `question`, `options` [{letter,text}], `answerLetter`.
// Only status === 'approved' keys are ever reported as a verified answer.
import { norm, tokenize } from './retrieval.js';

const OPT = /^\s*[\(\[]?([A-Fa-f])[\)\]\.:\-–]\s*(.+?)\s*$/;

export function parseQuiz(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const options = [];
  const q = [];
  for (const line of lines) {
    const m = line.match(OPT);
    if (m) options.push({ letter: m[1].toUpperCase(), text: m[2] });
    else if (!options.length) q.push(line);
    else options[options.length - 1].text += ' ' + line; // wrapped option text
  }
  if (options.length < 2) return null;
  const letters = options.map(o => o.letter);
  const seqOk = letters.every((l, i) => l.charCodeAt(0) === 65 + i);
  return {
    question: q.join(' ').replace(/^\s*(q(uestion)?\s*)?\d+\s*[\.\):\-]\s*/i, '').trim(),
    options,
    warnings: seqOk ? [] : ['ترتيب حروف الاختيارات غير متسلسل — تأكد من قراءة النص (OCR) قبل الاعتماد على النتيجة.'],
  };
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}

export function isQuizKey(r) {
  return /quiz/i.test(r.category || '') && r.question && Array.isArray(r.options) && r.answerLetter;
}

export function matchQuiz(parsed, records) {
  if (!parsed) return { type: 'none' };
  const qn = norm(parsed.question);
  const qt = tokenize(parsed.question, { keepStop: true });
  let best = null;
  for (const r of records.filter(isQuizKey)) {
    const sim = norm(r.question) === qn ? 1 : jaccard(qt, tokenize(r.question, { keepStop: true }));
    if (!best || sim > best.sim) best = { r, sim };
  }
  if (!best || best.sim < 0.6) return { type: 'none' };
  const sameOptions =
    best.r.options.length === parsed.options.length &&
    best.r.options.every(o => {
      const m = parsed.options.find(p => p.letter === String(o.letter).toUpperCase());
      return m && norm(m.text) === norm(o.text);
    });
  if (best.sim === 1 && sameOptions) {
    const verified = best.r.status === 'approved';
    const opt = best.r.options.find(o => String(o.letter).toUpperCase() === String(best.r.answerLetter).toUpperCase());
    return { type: 'exact', verified, record: best.r, answerLetter: String(best.r.answerLetter).toUpperCase(), answerText: opt?.text || '' };
  }
  return { type: 'similar', record: best.r, similarity: Math.round(best.sim * 100) / 100 };
}
