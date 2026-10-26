const chat = document.getElementById('chat');
const form = document.getElementById('chatForm');
const input = document.getElementById('message');
const send = document.getElementById('send');
let knowledge = [];

function addMessage(text, who = 'assistant') {
  document.getElementById('welcome')?.remove();
  const el = document.createElement('div');
  el.className = `message ${who}`;
  el.textContent = text;
  chat.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
}

function fields(d) {
  return [
    d.title, d.category, d.terms, d.summary,
    d.body, d.content, d.answer, d.description,
    d.steps, d.keywords, d.text
  ].flat(Infinity).filter(Boolean).join(' ');
}

function search(query) {
  const q = normalize(query);
  const words = [...new Set(q.split(/\s+/).filter(w => w.length > 1))];
  if (!words.length) return [];

  return knowledge.map(d => {
    const title = normalize(d.title);
    const text = normalize(fields(d));
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 5;
      if (normalize(d.category).includes(w)) score += 3;
      if (text.includes(w)) score += 1;
    }
    if (title && q.includes(title)) score += 10;
    return { d, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function answer(query) {
  const results = search(query);
  if (!results.length) {
    return 'ملقتش معلومة مطابقة في قاعدة المعرفة المحلية. جرّب اسم العطل أو الاختصار بالإنجليزي، مثل BLQ أو Data Down. مش هخمن خطوات فنية غير موجودة في المراجع.';
  }

  return results.map(({d}, i) => {
    const title = d.title || d.category || `مرجع ${i + 1}`;
    const details = [
      d.summary, d.answer, d.body, d.content,
      d.description, d.steps, d.text
    ].flat(Infinity).filter(Boolean);
    const unique = [...new Set(details.map(x => String(x).trim()))];
    return `${i + 1}. ${title}\n${unique.join('\n') || 'المعلومة موجودة بعنوانها وتصنيفها فقط؛ لا توجد تفاصيل إضافية في السجل.'}`;
  }).join('\n\n──────────\n\n');
}

async function loadKnowledge() {
  try {
    const res = await fetch('./knowledge.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('صيغة قاعدة المعرفة غير صحيحة');
    knowledge = data;
    console.log('GARHI local knowledge loaded:', knowledge.length);
  } catch (e) {
    console.error(e);
    addMessage('تعذر تحميل knowledge.json. تأكد أن الملف موجود في جذر الموقع وأنك تفتح الموقع عبر GitHub Pages، وليس من معاينة ملفات الهاتف.');
    form?.querySelector('button[type="submit"]')?.setAttribute('disabled', '');
  }
}

form?.addEventListener('submit', async e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || !knowledge.length) return;
  addMessage(q, 'user');
  input.value = '';
  send.disabled = true;
  try {
    addMessage(answer(q));
  } finally {
    send.disabled = false;
    input.focus();
  }
});

document.querySelectorAll('[data-question]').forEach(btn => {
  btn.addEventListener('click', () => {
    input.value = btn.dataset.question || '';
    form.requestSubmit();
  });
});

document.getElementById('clearChat')?.addEventListener('click', () => {
  chat.replaceChildren();
  const welcome = document.createElement('section');
  welcome.className = 'welcome';
  welcome.innerHTML = '<div class="hero-icon">G</div><h2>أهلًا بيك في GARHI</h2><p>اسأل عن أعطال WE وإجراءات الدعم الفني.</p>';
  chat.appendChild(welcome);
});

loadKnowledge();
