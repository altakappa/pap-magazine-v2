// PAP Magazine — 기사 FAQ 백필 테스트
//
// 지키는 회귀 (2026-07-21):
//   - 형식이 어긋난 생성 결과를 저장하지 않을 것 (빈/깨진 FAQ 는 구조화 데이터를
//     망가뜨려 오히려 감점이다 — 안 넣느니만 못하다)
//   - 요청하지 않은 id 를 만들어내면 버릴 것 (환각 방어)
//   - 배치가 1~20 밖으로 새지 않을 것 (Claude 1콜 토큰 안전선)
//   - 본문 평문화가 태그·엔티티를 제대로 걷어낼 것
//   - 크론이 CRON_SECRET 없이 열리지 않을 것
//
// Run with `node tests/faq-backfill.test.js` (wired into `npm test`).

'use strict';

const path = require('path');
const Module = require('module');

function stub(rel, exports) {
  const p = path.join(__dirname, '..', 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });

const { normalizeBatch, toPlain, parseFaqResponse } = require('../api/_lib/faqBackfill');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------------------------------------------------------- */
section('normalizeBatch — 토큰 안전선');

ok('기본값 사용', normalizeBatch(undefined, 10) === 10);
ok('상한 20 유지', normalizeBatch(999, 10) === 20);
ok('하한 1 유지', normalizeBatch(0, 10) === 1);
ok('음수도 1', normalizeBatch(-5, 10) === 1);
ok('문자열 파싱', normalizeBatch('7', 10) === 7);
ok('숫자 아님 → 기본값', normalizeBatch('abc', 10) === 10);

/* ---------------------------------------------------------------- */
section('toPlain — 본문 평문화');

ok('br 태그가 공백이 된다', toPlain('a<br>b') === 'a b');
ok('태그를 걷어낸다', toPlain('<p>안녕<strong>하세요</strong></p>') === '안녕 하세요');
ok('엔티티 복원', toPlain('A&amp;B') === 'A&B');
ok('연속 공백 축약', toPlain('a    b') === 'a b');
ok('길이 제한', toPlain('x'.repeat(2000)).length === 1200);
ok('null 방어', toPlain(null) === '');

/* ---------------------------------------------------------------- */
section('parseFaqResponse — 환각·형식오류 방어');

const IDS = ['a1', 'a2'];

const good = parseFaqResponse(JSON.stringify([
  { id: 'a1', faq: [{ q: '질문1', a: '답변1' }, { q: '질문2', a: '답변2' }] },
]), IDS);
ok('정상 파싱', good.a1 && good.a1.length === 2);

const fenced = parseFaqResponse('```json\n[{"id":"a1","faq":[{"q":"q","a":"a"}]}]\n```', IDS);
ok('코드펜스가 붙어도 파싱', !!fenced.a1);

const prose = parseFaqResponse('네, 만들었습니다:\n[{"id":"a1","faq":[{"q":"q","a":"a"}]}]', IDS);
ok('앞에 설명이 붙어도 배열을 찾아낸다', !!prose.a1);

const hallucinated = parseFaqResponse(JSON.stringify([
  { id: 'a1', faq: [{ q: 'q', a: 'a' }] },
  { id: 'ZZZ', faq: [{ q: 'q', a: 'a' }] }, // 요청하지 않은 id
]), IDS);
ok('요청하지 않은 id 는 버린다', !!hallucinated.a1 && !hallucinated.ZZZ);

const malformed = parseFaqResponse(JSON.stringify([
  { id: 'a1', faq: [{ q: '질문만' }, { a: '답변만' }, { q: 'ok', a: 'ok' }] },
]), IDS);
ok('q 나 a 가 빠진 항목은 버리고 온전한 것만 남긴다',
  malformed.a1 && malformed.a1.length === 1 && malformed.a1[0].q === 'ok');

const emptyFaq = parseFaqResponse(JSON.stringify([{ id: 'a1', faq: [] }]), IDS);
ok('FAQ 가 비면 아예 저장 대상에서 뺀다', !emptyFaq.a1);

const whitespace = parseFaqResponse(JSON.stringify([
  { id: 'a1', faq: [{ q: '   ', a: '   ' }] },
]), IDS);
ok('공백뿐인 q/a 도 버린다', !whitespace.a1);

ok('JSON 이 아니면 빈 객체', Object.keys(parseFaqResponse('완전 실패', IDS)).length === 0);
ok('배열이 아니면 빈 객체', Object.keys(parseFaqResponse('{"id":"a1"}', IDS)).length === 0);
ok('null 방어', Object.keys(parseFaqResponse(null, IDS)).length === 0);

const trimmed = parseFaqResponse(JSON.stringify([
  { id: 'a1', faq: [{ q: 'q'.repeat(300), a: 'a'.repeat(900) }] },
]), IDS);
ok('q 200자·a 600자로 자른다',
  trimmed.a1[0].q.length === 200 && trimmed.a1[0].a.length === 600);

const many = parseFaqResponse(JSON.stringify([
  { id: 'a1', faq: Array.from({ length: 9 }, (_, i) => ({ q: 'q' + i, a: 'a' + i })) },
]), IDS);
ok('최대 5개까지만', many.a1.length === 5);

/* ---------------------------------------------------------------- */
section('크론 보호');

stub('auth.js', { requireAdmin: async (_req, res) => { res.status(401); return null; } });
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
const cron = require('../api/cron/backfill-faq');
(async () => {
  let code = 0;
  const res = { status(c) { code = c; return this; }, json() { return this; } };
  delete process.env.CRON_SECRET;
  await cron({ headers: {}, query: {} }, res);
  ok('CRON_SECRET·관리자 없이 열리지 않는다', code === 401);

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.error('❌ faq-backfill tests failed'); process.exit(1); }
  console.log('✅ faq-backfill tests passed');
})();
