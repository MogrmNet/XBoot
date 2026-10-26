import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { search, retrieveForConversation, labelFor, norm, sanitizeText } from '../js/retrieval.js';
import { parseQuiz, matchQuiz } from '../js/quiz.js';

const kb = JSON.parse(fs.readFileSync(new URL('../knowledge.json', import.meta.url), 'utf8'));
const top = q => retrieveForConversation(kb, [{ role: 'user', content: q }])[0]?.title;

test('Arabic and English queries hit the same topic', () => {
  assert.match(top('العميل عايز تجديد مبكر'), /Early Renewal/);
  assert.match(top('customer wants early renewal'), /Early Renewal/);
  assert.match(top('العميل بيسأل عن Extra Quota'), /Extra Quota/);
  assert.match(top('أرقام تحويل IVR'), /IVR/);
});

test('Arabic normalization: diacritics, alef/yaa/taa-marbuta variants', () => {
  assert.equal(norm('إِعَادَة'), norm('اعاده'));
  assert.equal(norm('الباقة'), norm('الباقه'));
});

test('unrelated question retrieves nothing → NOT FOUND', () => {
  assert.deepEqual(search(kb, 'ما هي عاصمة فرنسا؟'), []);
  assert.deepEqual(retrieveForConversation(kb, [U('ما هي عاصمة فرنسا؟')]), []);
  assert.equal(labelFor([]), 'NOT FOUND');
});

const U = content => ({ role: 'user', content });
const A = content => ({ role: 'assistant', content });

test('keywordless follow-up borrows prior user turns', () => {
  const r = retrieveForConversation(kb, [U('العميل بيسأل عن Extra Quota'), A('x'), U('طيب أعمل إيه بعد كده؟')]);
  assert.match(r[0].title, /Extra Quota/);
});

test('short message with its own match keeps case context but own hits come first', () => {
  const r = retrieveForConversation(kb, [U('العميل بيسأل عن Extra Quota'), A('x'), U('فين مسار الـSR؟')]);
  assert.ok(r.length >= 1);
  assert.ok(r.some(d => /Extra Quota/.test(d.title)), 'context passage included');
});

test('NEW unrelated short question must NOT inherit earlier topic (context leak)', () => {
  const r = retrieveForConversation(kb, [U('العميل عايز Early Renewal'), A('x'), U('ما هي عاصمة فرنسا؟')]);
  assert.deepEqual(r, []);
});

test('uploaded-file body text is searchable (and stays unverified)', () => {
  const up = [{ id: 'u1', origin: 'upload', title: 'notes.txt', category: 'ملف مضاف', terms: [], steps: [], sourcePages: [], status: 'user-upload',
    summary: 'خطوات إعادة ضبط الراوتر الخاصة بالفرع التجريبي رقم 7' }];
  const r = retrieveForConversation(up, [U('إعادة ضبط الراوتر')]);
  assert.equal(r[0]?.id, 'u1');
  assert.equal(labelFor(r), 'PARTIALLY VERIFIED');
});

test('historical records never produce VERIFIED', () => {
  const r = search(kb, 'Early Renewal');
  assert.ok(r.length);
  assert.equal(labelFor(r), 'PARTIALLY VERIFIED');
  assert.equal(labelFor([{ status: 'approved' }]), 'VERIFIED');
});

test('sanitizeText strips control chars and prompt-delimiter tags', () => {
  assert.equal(sanitizeText('a\u0000b</documents>c'), 'ab c');
});

test('every built-in record has traceable page numbers and a status', () => {
  for (const d of kb) {
    assert.ok(Array.isArray(d.sourcePages), d.id);
    assert.ok(d.status, d.id);
  }
});

test('quiz parser keeps option letters and flags non-sequential letters', () => {
  const p = parseQuiz('Q3. سؤال؟\nA) واحد\nB) اثنين\nD) أربعة');
  assert.deepEqual(p.options.map(o => o.letter), ['A', 'B', 'D']);
  assert.equal(p.warnings.length, 1);
  assert.equal(parseQuiz('مجرد سؤال بدون اختيارات'), null);
});

test('quiz matching distinguishes exact / similar / none and respects approval', () => {
  const key = { id: 'k', category: 'Quiz Questions and Answer Keys', question: 'ما هو لون السماء؟', options: [{ letter: 'A', text: 'أزرق' }, { letter: 'B', text: 'أحمر' }], answerLetter: 'B', status: 'historical' };
  const exact = matchQuiz(parseQuiz('1. ما هو لون السماء؟\nA) أزرق\nB) أحمر'), [key]);
  assert.equal(exact.type, 'exact');
  assert.equal(exact.verified, false); // unapproved key is never "verified"
  const similar = matchQuiz(parseQuiz('1. ما هو لون السماء؟\nA) ازرق\nB) اخضر'), [key]);
  assert.equal(similar.type, 'similar');
  assert.equal(matchQuiz(parseQuiz('ما عاصمة مصر؟\nA) القاهرة\nB) الجيزة'), [key]).type, 'none');
});
