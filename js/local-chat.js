const $ = id => document.getElementById(id);
const chat = $('chat');
const form = $('chatForm');
const input = $('message');
const send = $('send');
let docs = [];

function norm(v) {
  return String(v ?? '').toLowerCase()
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
}

function show(text, who = 'assistant') {
  $('welcome')?.remove();
  const el = document.createElement('div');
  el.className = 'message ' + who;
  el.style.cssText = 'white-space:pre-wrap;padding:14px;margin:10px 0;border-radius:14px;background:' + (who === 'user' ? '#27334a' : '#171a27');
  el.textContent = text;
  chat.appendChild(el);
  el.scrollIntoView({behavior:'smooth',block:'end'});
}

function content(d) {
  return [d.title,d.category,d.terms,d.summary,d.body,d.content,d.answer,d.description,d.steps,d.keywords,d.text]
    .flat(Infinity).filter(Boolean).join(' ');
}

function respond(q) {
  const words = [...new Set(norm(q).split(/\s+/).filter(w => w.length > 1))];
  const ranked = docs.map(d => {
    const title = norm(d.title), text = norm(content(d));
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 5;
      if (norm(d.category).includes(w)) score += 3;
      if (text.includes(w)) score++;
    }
    return {d,score};
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score).slice(0,3);

  if (!ranked.length) return 'ملقتش معلومة مطابقة في قاعدة المعرفة. جرّب كلمة فنية بالإنجليزي مثل BLQ أو Data Down.';
  return ranked.map(({d},i) => {
    const details = [d.summary,d.answer,d.body,d.content,d.description,d.steps,d.text]
      .flat(Infinity).filter(Boolean);
    return `${i+1}) ${d.title || d.category || 'معلومة'}\n${details.join('\n') || d.terms || 'لا توجد تفاصيل إضافية في السجل.'}`;
  }).join('\n\n────────\n\n');
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  show(q,'user');
  input.value = '';
  show(respond(q));
});

document.querySelectorAll('[data-question]').forEach(b => {
  b.addEventListener('click', () => {
    input.value = b.dataset.question || b.textContent.trim();
    form.requestSubmit();
  });
});

(async () => {
  try {
    const r = await fetch('./knowledge.json?local=1');
    if (!r.ok) throw Error('HTTP ' + r.status);
    docs = await r.json();
    if (!Array.isArray(docs)) throw Error('Invalid knowledge format');
    console.log('GARHI local records:', docs.length);
  } catch (e) {
    console.error(e);
    show('فشل تحميل قاعدة المعرفة: ' + e.message + '. افتح الموقع بعد اكتمال النشر وتأكد من وجود knowledge.json في جذر المشروع.');
  }
})();
