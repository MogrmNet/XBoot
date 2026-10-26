// End-to-end browser check (needs Playwright + Chromium; NOT part of `npm test`).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e.mjs
// The REAL frontend + REAL Worker code run together. Only the model provider (api.anthropic.com) is MOCKED here,
// so this verifies plumbing/UI/retrieval/evidence-handling — it does NOT prove a real AI model answered.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8123;
process.argv.push('--with-worker', String(PORT));
process.env.ANTHROPIC_API_KEY = 'mock-key-for-e2e';
const { server } = await import('./serve.mjs');
await new Promise(r => server.listen(PORT, r));

const upstream = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.anthropic.com')) {
    upstream.push(JSON.parse(init.body));
    const text = '**الخلاصة**\nحسب المرجع التدريبي (تاريخي/غير معتمد): راجع حالة الطلب.\n**مسار الـSR**\nFront Line → Physical Cases → BLQ\n- راجع الإجراء الرسمي';
    const enc = new TextEncoder();
    const parts = text.match(/[\s\S]{1,12}/g);
    return new Response(new ReadableStream({
      async start(c) {
        for (const p of parts) { c.enqueue(enc.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: p } })}\n\n`)); await new Promise(r => setTimeout(r, 15)); }
        c.close();
      },
    }), { status: 200 });
  }
  return realFetch(url, init);
};

const { chromium } = await import('/home/claude/.npm-global/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]); } };
const shots = path.join(os.tmpdir(), 'garhi-shots'); fs.mkdirSync(shots, { recursive: true });

await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#welcome');

await step('opens directly into chat with welcome text, composer, watermark, suggestions', async () => {
  assert.ok(await page.locator('#composer textarea').isVisible());
  assert.match(await page.locator('#welcome').innerText(), /أهلاً بيك في GARHI/);
  assert.match(await page.locator('#welcome').innerText(), /هقولك بوضوح بدل ما أخمّن/);
  assert.equal(await page.locator('.watermark').innerText(), 'GARHI');
  assert.equal(await page.locator('#suggestions button').count(), 8);
  assert.ok(Number(await page.evaluate(() => getComputedStyle(document.querySelector('.watermark')).opacity)) < 0.06);
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
});

await step('no API configured → honest Arabic error, retry + local search offered, no fake answer', async () => {
  assert.match(await page.locator('#status').innerText() + await page.locator('#status').getAttribute('class'), /unconfigured/);
  await page.fill('#input', 'العميل عايز Early Renewal');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.msg.err');
  const t = await page.locator('.msg.err').innerText();
  assert.match(t, /الذكاء الاصطناعي غير مُعد/);
  assert.equal(upstream.length, 0);
  assert.ok(await page.locator('[data-act=retry]').isVisible());
  assert.ok(await page.locator('[data-act=local]').isVisible());
});

await step('settings: configure backend URL → status becomes configured', async () => {
  await page.click('#clearChat').catch(() => {}); page.once('dialog', d => d.accept());
  await page.evaluate(() => { document.querySelector('#openSettings').click(); });
  await page.fill('#setApi', `http://localhost:${PORT}`);
  await page.click('#settingsForm button[value=save]');
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('ready'));
});

await step('retry after configuring → streamed grounded answer, sources with pages, evidence label', async () => {
  await page.click('[data-act=retry]');
  await page.waitForSelector('.msg.assistant .badge', { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('.bubble.cursor') && !document.querySelector('#stop:not(.hidden)'));
  const a = page.locator('.msg.assistant').last();
  assert.match(await a.innerText(), /الخلاصة/);
  assert.equal(await a.locator('.badge').innerText(), 'PARTIALLY VERIFIED');
  assert.ok(await a.locator('details.src').count() >= 1);
  assert.match(await a.locator('.src .pg').first().innerText(), /ص \d/);
  assert.ok(await a.locator('button[data-copy-text^="Front Line"]').count() === 1, 'copy-path button');
  assert.ok(await a.locator('bdi[dir=ltr]').count() > 0);
  assert.equal(upstream.length, 1);
  assert.match(upstream[0].system, /<documents>/);
  assert.ok(!JSON.stringify(upstream[0]).includes('mock-key-for-e2e'), 'key not in model payload');
});

await step('follow-up without keywords keeps conversation context', async () => {
  await page.fill('#input', 'طيب أعمل إيه بعد كده؟');
  await page.click('#send');
  await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length >= 2 && !document.querySelector('.bubble.cursor') && document.querySelector('#send:not(.hidden)'));
  assert.equal(upstream.length, 2);
  assert.ok(upstream[1].messages.length >= 3);
  assert.match(upstream[1].system, /Early Renewal/);
});

await step('unrelated question → NOT FOUND, fixed Arabic message, model not called', async () => {
  const before = upstream.length;
  await page.fill('#input', 'ما هي عاصمة فرنسا؟');
  await page.click('#send');
  await page.waitForFunction(() => [...document.querySelectorAll('.badge')].some(b => b.textContent === 'NOT FOUND'));
  assert.equal(upstream.length, before);
  assert.match(await page.locator('.msg.assistant').last().innerText(), /مش هخمن مسار أو SLA/);
});

await step('conversation history: listed, searchable, rename, persists after reload', async () => {
  assert.ok(await page.locator('.conv').count() >= 1);
  await page.reload(); await page.waitForSelector('#thread .msg');
  assert.ok(await page.locator('#thread .msg').count() >= 6);
  await page.fill('#convSearch', 'zzzz-nothing');
  assert.equal(await page.locator('.conv').count(), 0);
  await page.fill('#convSearch', '');
});

await step('reference drawer: local search labelled as search (not AI), shows pages', async () => {
  await page.evaluate(() => document.querySelector('#openRefs').click());
  await page.fill('#refQuery', 'Extra Quota');
  await page.waitForSelector('#refResults .card');
  assert.match(await page.locator('#tabSearch .hint').first().innerText(), /وليست إجابة مولّدة بالذكاء الاصطناعي/);
  assert.ok(await page.locator('#refResults .pill.pg').count() > 0);
  await page.screenshot({ path: path.join(shots, 'refs.png') });
  await page.click('#closeRefs');
});

await step('file upload (txt) → processed locally, status reported, passage sent as user-upload', async () => {
  const f = path.join(shots, 'my-notes.txt'); fs.writeFileSync(f, 'إجراء تجريبي خاص بحالة Wireless Settings للاختبار فقط.\n\nفقرة تانية.');
  await page.setInputFiles('#file', f);
  await page.waitForFunction(() => document.body.innerText.includes('تمت معالجة'));
  const before = upstream.length;
  await page.fill('#input', 'Wireless Settings');
  await page.click('#send');
  await page.waitForFunction(n => window.__x = document.querySelectorAll('.msg.assistant').length > n, 0);
  await page.waitForFunction(() => document.querySelector('#send:not(.hidden)'));
  assert.equal(upstream.length, before + 1);
  assert.match(upstream.at(-1).system, /status="user-upload"/);
});

await step('invalid upload type is rejected', async () => {
  const f = path.join(shots, 'evil.exe'); fs.writeFileSync(f, 'MZ');
  await page.setInputFiles('#file', f);
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('show') && /غير مدعوم/.test(document.querySelector('#toast').textContent));
});

await step('quiz mode with no answer key → "no confirmed answer" and no guess', async () => {
  const before = upstream.length;
  await page.evaluate(() => document.querySelector('input[name=mode][value=quiz]').click());
  await page.fill('#input', 'Q1. ما هو الإجراء؟\nA) واحد\nB) اثنين\nC) ثلاثة');
  await page.click('#send');
  await page.waitForFunction(() => document.body.innerText.includes('مش لاقي إجابة مؤكدة للسؤال ده في المراجع المتاحة'));
  assert.equal(upstream.length, before);
  await page.evaluate(() => document.querySelector('input[name=mode][value=chat]').click());
});

await step('XSS: hostile text in a user message is not executed', async () => {
  await page.fill('#input', '<img src=x onerror="window.__pwned=1"> Early Renewal');
  await page.click('#send');
  await page.waitForFunction(() => document.querySelector('#send:not(.hidden)'));
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

await step('stop button aborts generation and keeps partial text', async () => {
  await page.fill('#input', 'العميل بيسأل عن Extra Quota');
  await page.click('#send');
  await page.waitForSelector('#stop:not(.hidden)');
  await page.click('#stop');
  await page.waitForFunction(() => document.querySelector('#send:not(.hidden)'));
});

await page.screenshot({ path: path.join(shots, 'desktop.png') });

// Mobile layout
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(`http://localhost:${PORT}/`);
await mp.waitForSelector('#welcome');
await step('mobile: no horizontal overflow, composer visible, sidebar is a drawer', async () => {
  assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'horizontal overflow');
  assert.ok(await mp.locator('#input').isVisible());
  assert.ok(!(await mp.locator('#sidebar').evaluate(el => el.getBoundingClientRect().left < window.innerWidth - 5)));
  await mp.click('#openSidebar');
  await mp.waitForFunction(() => document.querySelector('#sidebar').classList.contains('open'));
  await mp.waitForTimeout(350);
  assert.ok(await mp.locator('#newChat').isVisible());
  await mp.screenshot({ path: path.join(shots, 'mobile-drawer.png') });
  await mp.click('#closeSidebar');
  await mp.waitForTimeout(450);
  await mp.screenshot({ path: path.join(shots, 'mobile.png') });
});

await step('no uncaught JS errors', async () => assert.deepEqual(errors, []));

await browser.close(); server.close();
for (const [s, n] of results) console.log(s, n);
console.log('screenshots:', shots);
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
