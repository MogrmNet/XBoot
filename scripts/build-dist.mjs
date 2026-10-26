// Assemble the PUBLIC static site into dist/ (what GitHub Pages serves). Only an allow-list is copied:
// worker/, tests/, scripts/, .github/, PDFs and env files never reach the public site.
// GARHI_API_URL (a public URL, NOT a secret) is written into dist/config.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './scan-secrets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const api = (process.env.GARHI_API_URL || '').trim().replace(/\/+$/, '');
if (api && !/^https:\/\/[A-Za-z0-9.\-]+(:\d+)?(\/[A-Za-z0-9._~\-\/]*)?$/.test(api)) { console.error('GARHI_API_URL must be a plain https:// URL'); process.exit(1); }

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'style.css', 'knowledge.json']) fs.copyFileSync(path.join(root, f), path.join(dist, f));
fs.cpSync(path.join(root, 'js'), path.join(dist, 'js'), { recursive: true });
fs.writeFileSync(path.join(dist, 'config.js'), `// generated at deploy time — public, non-secret\nwindow.GARHI_CONFIG = ${JSON.stringify({ apiUrl: api })};\n`);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// every local asset referenced by index.html must exist and be RELATIVE (works under /XBoot/)
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(u => !/^(https?:)?\/\//.test(u));
const bad = refs.filter(u => u.startsWith('/') || !fs.existsSync(path.join(dist, u)));
if (bad.length) { console.error('Broken or absolute asset paths:', bad); process.exit(1); }
const findings = scan(dist);
if (findings.length) { console.error('Secret scan failed on dist:', findings); process.exit(1); }
console.log(`dist/ ready — ${refs.length} local assets verified, apiUrl=${api || '(not set: AI chat will show "not configured")'}`);
