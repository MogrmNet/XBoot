import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, extractPath, inline } from '../js/render.js';

test('HTML in model/document text is escaped (XSS)', () => {
  const h = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))');
  assert.ok(!/<img|<script/i.test(h));
  assert.match(h, /&lt;<bdi dir="ltr">script<\/bdi>&gt;/);
  assert.ok(!/<(?!\/?(p|bdi|strong|code|ul|ol|li|h4|pre|div|button)\b)/.test(h), 'no unexpected tags');
});

test('SR paths keep LTR isolation and are copyable', () => {
  const line = 'المسار: Front Line → Physical Cases → BLQ';
  const h = renderMarkdown(line);
  assert.match(h, /<bdi dir="ltr">Front Line → Physical Cases → BLQ<\/bdi>/);
  assert.equal(extractPath(line), 'Front Line → Physical Cases → BLQ');
  assert.match(h, /data-copy-text="Front Line → Physical Cases → BLQ"/);
});

test('ampersands and IPs/IDs survive without entity corruption', () => {
  const h = inline('Wrong Card & Port على 192.168.1.1 تيكت SR-12345');
  assert.ok(!h.includes('<bdi dir="ltr">amp'));
  assert.match(h, /192\.168\.1\.1/);
  assert.match(h, /SR-12345/);
});

test('lists, bold and fenced code render', () => {
  const h = renderMarkdown('**الخلاصة**\n- خطوة 1\n- خطوة 2\n```\nshow port\n```');
  assert.match(h, /<strong>/);
  assert.match(h, /<ul><li>/);
  assert.match(h, /<pre dir="ltr">show port<\/pre>/);
});
