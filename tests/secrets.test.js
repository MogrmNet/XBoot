import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../scripts/scan-secrets.mjs';

const root = fileURL => path.resolve(new URL(fileURL, import.meta.url).pathname);

test('repository contains no secrets, env files or training PDFs', () => {
  assert.deepEqual(scan(root('..')), []);
});

test('scanner actually detects leaked keys, env files and PDFs', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  fs.writeFileSync(path.join(d, 'a.js'), 'const k = "' + 'sk-' + 'ant-api03-abcdefghijklmnopqrstuv' + '";');
  fs.writeFileSync(path.join(d, '.env'), 'X=1');
  fs.writeFileSync(path.join(d, 'tech.pdf'), '%PDF');
  fs.writeFileSync(path.join(d, 'ok.js'), 'ANTHROPIC_API_KEY=your-provider-api-key-here');
  const kinds = scan(d).map(f => f.issue);
  assert.ok(kinds.some(k => /Anthropic/.test(k)));
  assert.ok(kinds.some(k => /env file/.test(k)));
  assert.ok(kinds.some(k => /PDF/.test(k)));
  assert.equal(scan(d).filter(f => f.file === 'ok.js').length, 0);
});

test('frontend files contain no provider key or Authorization header usage', () => {
  for (const f of ['../js/app.js', '../js/api.js', '../js/ingest.js', '../config.js', '../index.html']) {
    const t = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/x-api-key|ANTHROPIC_API_KEY|api\.anthropic\.com/.test(t), f);
  }
});
