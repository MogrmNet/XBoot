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

function textOf(d) {
  return [d.title,d.category,d.terms,d.summary,d.body,d.content,
    d.answer,d.description,d.steps,d.keywords,d.text]
    .flat(Infinity).filter(Boolean).join(' ');
}

function show(text, who='assistant') {
  $('welcome')?.remove();
  const el=document.createElement('div');
  el.className='message '+who;
  el.style.cssText='white-space:pre-wrap;padding:14px;margin:10px 0;border-radius:12px;background:'+(who==='user'?'#27334a':'#171a27');
  el.textContent=text;
  chat.appendChild(el);
  el.scrollIntoView({block:'end'});
}

function answer(q) {
  const words=[...new Set(norm(q).split(/\s+/).filter(w=>w.length>1))];
  if(!words.length) return 'اكتب سؤالك الأول.';
  const found=docs.map(d=>{
    const title=norm(d.title), category=norm(d.category), body=norm(textOf(d));
    let score=0;
    for(const w of words) {
      if(title.includes(w)) score+=6;
      if(category.includes(w)) score+=3;
      if(body.includes(w)) score++;
    }
    return {d,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);

  if(!found.length) return 'لم أجد إجابة مطابقة في قاعدة المعرفة المحلية. جرّب مصطلحًا فنيًا مثل BLQ أو Data Down.';
  return found.map(({d},i)=>{
    const detail=[d.summary,d.answer,d.body,d.content,d.description,d.steps,d.text]
      .flat(Infinity).filter(Boolean);
    return `${i+1}. ${d.title||d.category||'مرجع'}\n${detail.join('\n')||d.terms||'لا توجد تفاصيل إضافية في السجل.'}`;
  }).join('\n\n──────────\n\n');
}

if(form && input && chat) {
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const q=input.value.trim();
    if(!q) return;
    if(!docs.length) { show('قاعدة المعرفة لم تُحمّل بعد. حدّث الصفحة وحاول مجددًا.'); return; }
    show(q,'user');
    input.value='';
    show(answer(q));
  });
  document.querySelectorAll('[data-question]').forEach(b=>{
    b.addEventListener('click',()=>{
      input.value=b.dataset.question||b.textContent.trim();
      form.requestSubmit();
    });
  });
} else {
  console.error('GARHI: chat elements missing in index.html');
}

fetch('./knowledge.json')
  .then(r=>{if(!r.ok) throw Error('HTTP '+r.status);return r.json();})
  .then(data=>{
    if(!Array.isArray(data)) throw Error('Invalid JSON structure');
    docs=data;
    console.log('GARHI local knowledge loaded:',docs.length);
  })
  .catch(e=>{
    console.error('Knowledge load failed:',e);
    if(chat) show('فشل تحميل قاعدة المعرفة. تأكد من وجود knowledge.json في جذر الموقع.');
  });
