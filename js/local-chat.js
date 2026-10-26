const $ = id => document.getElementById(id);
const chat = $('chat');
const form = $('chatForm');
const input = $('message');
let docs = [];

function norm(v) {
  return String(v ?? '').toLowerCase()
    .replace(/[أإآ]/g,'ا').replace(/ة/g,'ه')
    .replace(/[^\p{L}\p{N}\s]/gu,' ').trim();
}

function values(v) {
  return Array.isArray(v) ? v.flat(Infinity) : [v];
}

function fields(d) {
  return ['title','category','terms','summary','body','content',
    'answer','description','steps','keywords','text']
    .flatMap(k => values(d[k]))
    .filter(v => typeof v === 'string' && v.trim());
}

function show(text, who='assistant') {
  $('welcome')?.remove();
  const el = document.createElement('div');
  el.className = 'message ' + who;
  el.style.cssText = 'white-space:pre-wrap;padding:14px;margin:10px 0;border-radius:14px;background:' +
    (who === 'user' ? '#27334a' : '#171a27');
  el.textContent = text;
  chat.appendChild(el);
  el.scrollIntoView({behavior:'smooth',block:'end'});
}

function findAnswer(q) {
  const words = [...new Set(norm(q).split(/\s+/).filter(w => w.length > 1))];
  if (!words.length) return 'اكتب سؤالك بشكل مختصر.';

  const ranked = docs.map(d => {
    const title = norm(d.title);
    const category = norm(d.category);
    const all = norm(fields(d).join(' '));
    let score = 0;

    for (const w of words) {
      if (title.includes(w)) score += 8;
      if (category.includes(w)) score += 4;
      if (all.includes(w)) score += 1;
    }
    if (title && words.every(w => title.includes(w))) score += 10;
    return {d, score};
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score);

  if (!ranked.length)
    return 'مش لاقي المعلومة دي في المراجع المحلية. جرّب اسم الخدمة أو العطل بالإنجليزي.';

  const best = ranked[0].d;
  const detailFields = ['summary','answer','steps','body','content','description','text'];
  const parts = detailFields.flatMap(k => values(best[k]))
    .filter(v => typeof v === 'string' && v.trim());

  if (!parts.length)
    return `${best.title || best.category || 'المعلومة'}\nالمصدر المحلي لا يحتوي على تفاصيل كافية للإجابة.`;

  const candidates = parts.flatMap(p =>
    p.split(/\n+|(?<=[.!؟])\s+/).map(s => s.trim()).filter(Boolean)
  );

  const scored = candidates.map(line => {
    const n = norm(line);
    let score = 0;
    for (const w of words) if (n.includes(w)) score++;
    return {line, score};
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score);

  let result = scored.length
    ? scored.slice(0,2).map(x => x.line).join('\n')
    : parts[0];

  if (result.length > 650)
    result = result.slice(0,647).trimEnd() + '...';

  return result;
}

if (!chat || !form || !input) {
  console.error('GARHI: missing chat elements');
} else {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    show(q,'user');
    input.value = '';
    show(docs.length
      ? findAnswer(q)
      : 'قاعدة المعرفة لسه بتتحمّل. حدّث الصفحة وجرب تاني.');
  });

  document.querySelectorAll('[data-question]').forEach(b => {
    b.addEventListener('click', () => {
      input.value = b.dataset.question || b.textContent.trim();
      form.requestSubmit();
    });
  });
}

$('clearChat')?.addEventListener('click', () => {
  chat.replaceChildren();
  const welcome = document.createElement('section');
  welcome.id = 'welcome';
  welcome.className = 'welcome';
  welcome.innerHTML = '<div class="hero-icon">G</div><h2>أهلًا بيك في GARHI</h2><p>اسأل سؤالك الفني.</p>';
  chat.appendChild(welcome);
});

fetch('./knowledge.json')
  .then(r => {
    if (!r.ok) throw Error('HTTP ' + r.status);
    return r.json();
  })
  .then(data => {
    if (!Array.isArray(data)) throw Error('Invalid knowledge format');
    docs = data;
    console.log('GARHI local knowledge:', docs.length);
  })
  .catch(err => {
    console.error(err);
    if (chat) show('في مشكلة في تحميل قاعدة المعرفة المحلية.');
  });
