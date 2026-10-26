// GARHI shared retrieval module — runs in the browser AND in the Cloudflare Worker.
// Hybrid lexical retrieval: exact phrase + token match + Arabic/English synonym groups.
// LIMITATION: no embeddings / vector search. Semantic retrieval needs an embedding model + vector store (see README).

const STOP = new Set((
  'ال في من علي على الي الى عن مع هو هي انا ده دي دا اللي لو لما ايه ايش ازاي ازاى امتي فين كام ممكن عايز عاوز عايزه بيشتكي بيسال ' +
  'العميل عميل طيب بعد كده كدا هل ما ماذا كيف the a an is are to of in on for and or what how when where do does i my customer ' +
  'اعمل اتعامل ابدا اسال السؤال ده'
).split(/\s+/).filter(Boolean));

export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(t) {
  if (t.length > 4 && /^(وال|بال|كال|فال)/.test(t)) return t.slice(3);
  if (t.length > 3 && t.startsWith('ال')) return t.slice(2);
  return t;
}

export function tokenize(s, { keepStop = false } = {}) {
  return norm(s).split(' ').map(stem).filter(t => t.length > 1 && (keepStop || !STOP.has(t)));
}

// Retrieval aliases (query expansion only). They are NOT evidence and never shown as facts.
const SYNONYM_GROUPS = [
  ['بطء', 'بطيء', 'بطي', 'slow', 'slowness', 'slow browsing', 'suspect outage'],
  ['فاصل', 'data down', 'وقع', 'مفيش نت', 'النت واقع', 'internet down', 'port operational status'],
  ['مش مستقر', 'physical instability', 'blq', 'bad line quality', 'تقطيع', 'فصل متقطع'],
  ['تغيير الباقه', 'change offering', 'تغيير العرض', 'ترقيه'],
  ['تجديد مبكر', 'early renewal', 'تجديد'],
  ['متابعه', 'follow up', 'followup', 'follow-up', 'بلاغ', 'sr', 'tt', 'تيكت', 'ticket', 'sla'],
  ['باقه اضافيه', 'extra quota', 'كوتا', 'quota', 'top up', 'قراءه المزيد'],
  ['واي فاي', 'wifi', 'wi-fi', 'wireless', 'اعدادات الواي فاي', 'router', 'راوتر'],
  ['restart port', 'ريستارت', 'اعاده تشغيل البورت', 'port'],
  ['ivr', 'تحويل', 'ارقام التحويل', 'routing'],
  ['fv', 'fixed voice', 'خط ارضي', 'تليفون ارضي'],
  ['check availability', 'survey status', 'availability', 'فحص التوافر', 'fbb'],
  ['escalation', 'تصعيد', 'تصعيد البلاغ'],
];
const GROUPS_NORM = SYNONYM_GROUPS.map(g => g.map(norm));

const cache = new WeakMap();
function prep(doc) {
  let p = cache.get(doc);
  if (p) return p;
  const terms = (doc.terms || []).map(norm).filter(Boolean);
  p = {
    titleN: norm(doc.title),
    titleT: tokenize(doc.title),
    catT: tokenize(doc.category),
    terms,
    termT: terms.flatMap(t => tokenize(t)),
    bodyT: new Set(tokenize([doc.summary, ...(doc.steps || []), doc.evidence, doc.question].join(' '))),
  };
  cache.set(doc, p);
  return p;
}

const tokMatch = (q, d) => q === d || (q.length >= 4 && d.length >= 4 && (d.startsWith(q) || q.startsWith(d)));
const anyMatch = (q, arr) => arr.some(d => tokMatch(q, d));

function expand(qNorm, qTokens) {
  const extra = new Set();
  for (const g of GROUPS_NORM) {
    const hit = g.some(a => a && (qNorm === a || (a.length >= 3 && (` ${qNorm} `).includes(` ${a} `)) || qTokens.includes(a)));
    if (hit) g.forEach(a => tokenize(a).forEach(t => { if (!qTokens.includes(t)) extra.add(t); }));
  }
  return [...extra];
}

export function scoreDoc(doc, qNorm, qTokens, expTokens) {
  const p = prep(doc);
  let strong = 0, weak = 0;
  for (const t of qTokens) {
    if (anyMatch(t, p.titleT)) strong += 5;
    if (anyMatch(t, p.termT)) strong += 4;
    if (anyMatch(t, p.catT)) strong += 3;
    if (p.bodyT.has(t)) weak += 1;
  }
  for (const t of expTokens) {
    if (anyMatch(t, p.titleT)) strong += 2;
    if (anyMatch(t, p.termT)) strong += 2;
  }
  // Uploaded files have no curated title/terms, so their body text is the evidence: count it as a strong match.
  if (doc.origin === 'upload') strong += weak * 3;
  if (qNorm.length >= 3) {
    if (p.titleN.includes(qNorm)) strong += 8;
    for (const term of p.terms) {
      if (term.length >= 4 && (` ${qNorm} `).includes(` ${term} `)) strong += 6;
    }
  }
  return { strong, total: strong + weak };
}

export function search(docs, query, { k = 5, minStrong = 3 } = {}) {
  const qNorm = norm(query);
  const qTokens = tokenize(query);
  if (!qNorm) return [];
  const exp = expand(qNorm, qTokens);
  return docs
    .map(d => ({ d, ...scoreDoc(d, qNorm, qTokens, exp) }))
    .filter(x => x.strong >= minStrong)
    .sort((a, b) => b.total - a.total)
    .slice(0, k)
    .map(x => ({ ...x.d, _score: x.total }));
}

// Conversation-aware retrieval.
//  - A message with enough content of its own is searched alone.
//  - A bare follow-up ("طيب أعمل إيه بعد كده؟") has no topic words → borrow the previous user turns.
//  - A short message that matches something by itself ("فين مسار الـSR؟") is searched alone AND with the case context (own hits first).
//  - A short message with NO own match and no follow-up marker ("ما هي عاصمة فرنسا؟") is a NEW topic → do NOT borrow context.
const FOLLOW = /(^| )(بعد كده|بعد كدا|وبعدين|طيب|كمان|الحاله دي|ده|دي|دول|then|next|and then|what now)( |$)/;
export function retrieveForConversation(docs, messages, { k = 5 } = {}) {
  const users = messages.filter(m => m.role === 'user').map(m => String(m.content || ''));
  if (!users.length) return [];
  const last = users[users.length - 1];
  const own = search(docs, last, { k });
  const toks = tokenize(last).length;
  const hasContext = users.length > 1;
  const borrow = hasContext && (toks === 0 || (toks <= 3 && (own.length ? true : FOLLOW.test(norm(last)))));
  if (!borrow) return own;
  const ctx = search(docs, users.slice(-3, -1).join(' \n '), { k });
  const seen = new Set(own.map(d => d.id));
  const extra = ctx.filter(d => !seen.has(d.id)).slice(0, own.length ? 2 : k);
  return [...own.slice(0, k - extra.length), ...extra];
}

export function sanitizeText(s, max = 1500) {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\/?\s*(document|documents|system|instructions?|quiz_match|evidence)[^>]*>/gi, ' ')
    .slice(0, max);
}

export function toSource(p) {
  return {
    id: String(p.id),
    title: sanitizeText(p.title, 160),
    category: sanitizeText(p.category, 80),
    pages: (p.sourcePages || []).slice(0, 20),
    status: p.status || 'unverified',
    origin: p.origin || 'builtin',
    excerpt: sanitizeText(p.summary, 500),
    steps: (p.steps || []).slice(0, 8).map(s => sanitizeText(s, 300)),
    note: sanitizeText(p.evidence, 300),
  };
}

// Evidence label is computed by the application, never self-declared by the model.
export function labelFor(passages) {
  if (!passages.length) return 'NOT FOUND';
  if (passages.some(p => p.status === 'approved')) return 'VERIFIED';
  return 'PARTIALLY VERIFIED';
}
