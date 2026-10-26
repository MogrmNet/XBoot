// Tiny static dev server (no dependencies):  node scripts/serve.mjs [port]
// Optional: --with-worker mounts the Worker handler at /api/* using env vars (ANTHROPIC_API_KEY, APP_TOKEN, ...)
// so you can test the whole stack on one origin without wrangler. Uses the REAL provider if a key is set.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.find(a => /^\d+$/.test(a)) || 8000);
const withWorker = process.argv.includes('--with-worker');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PRIVATE = /^\/(worker|tests|scripts|\.github|node_modules)\b|\/\.|\.(pdf|env)$/i;

let handle;
if (withWorker) ({ handle } = await import('../worker/src/index.js'));

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (withWorker && url.pathname.startsWith('/api/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });
    const env = { ...process.env, ALLOWED_ORIGIN: `http://localhost:${port}`, KNOWLEDGE_JSON: fs.readFileSync(path.join(root, 'knowledge.json'), 'utf8') };
    const r = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const chunk of r.body) res.write(chunk);
    return res.end();
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (PRIVATE.test(p)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`GARHI dev server: http://localhost:${port}/  (worker ${withWorker ? 'mounted at /api' : 'not mounted — set apiUrl in Settings'})`));
}
