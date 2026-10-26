// Secret / private-file scanner (no dependencies).  node scripts/scan-secrets.mjs [dir]
// Fails (exit 1) if it finds API-key-like strings, private keys, committed .env/.dev.vars files or training PDFs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PATTERNS = [
  ['Anthropic-style key', /sk-ant-[A-Za-z0-9_\-]{10,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{24,}/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_\-]{30,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Secret assignment', /(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*["']?(?!your-|choose-|placeholder|example|changeme|<|\$|process\.env|env\.|settings\.|\s)[A-Za-z0-9_\-]{20,}/i],
];
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist']);
const BAD_FILES = [[/(^|\/)\.env(\..*)?$/, 'env file (only .env.example is allowed)'], [/(^|\/)\.dev\.vars$/, '.dev.vars (local secrets)'], [/\.pdf$/i, 'PDF (training material must not be published)']];
const ALLOWED_FILES = /\.env\.example$|\.dev\.vars\.example$/;

export function scan(root) {
  const findings = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (e.isDirectory()) { walk(full); continue; }
      if (!ALLOWED_FILES.test(rel)) for (const [re, why] of BAD_FILES) if (re.test(rel)) findings.push({ file: rel, issue: why });
      if (fs.statSync(full).size > 2_000_000) continue;
      let text; try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (text.includes('\u0000')) continue;
      text.split('\n').forEach((line, i) => {
        for (const [name, re] of PATTERNS) if (re.test(line)) findings.push({ file: rel, line: i + 1, issue: name });
      });
    }
  })(root);
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const f = scan(root);
  if (f.length) { console.error('SECRET SCAN FAILED:'); f.forEach(x => console.error(` - ${x.file}${x.line ? ':' + x.line : ''} — ${x.issue}`)); process.exit(1); }
  console.log('Secret scan passed: no key-like strings, env files or PDFs found in', root);
}
