// Verifies dist/ works under the GitHub Pages project sub-path /XBoot/ (needs Playwright). Run `npm run build` first.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/pages-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (!u.startsWith('/XBoot/')) { r.writeHead(404); return r.end(); }          // like Pages: nothing outside the project path
  const f = path.join(dist, u.slice('/XBoot/'.length) || 'index.html');
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!fs.existsSync(file)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': T[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(r);
});
await new Promise(r => srv.listen(8124, r));
const { chromium } = await import('/home/claude/.npm-global/lib/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const p = await b.newPage();
const bad = [], errs = [];
p.on('response', r => { if (r.url().startsWith('http://localhost:8124') && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8124/XBoot/'); await p.waitForSelector('#welcome');
await p.fill('#input', 'x'); await p.fill('#input', '');
await p.evaluate(() => document.querySelector('#openRefs').click());
await p.fill('#refQuery', 'Early Renewal'); await p.waitForSelector('#refResults .card');
const cards = await p.locator('#refResults .card').count();
await b.close(); srv.close();
console.log({ failedLocalRequests: bad, jsErrors: errs, knowledgeLoadedAndSearchable: cards > 0 });
process.exit(bad.length || errs.length || !cards ? 1 : 0);
