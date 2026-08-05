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
// 추가 회귀 (2026-08-04) — 선별 벽:
//   - '거른 뒤에 자른다' 순서를 지킬 것. 예전에는 SQL LIMIT 을 먼저 걸고
//     본문 길이로 걸렀다. 잔여 260건의 앞 12건이 전부 62~78자짜리 사진
//     게시물이었던 날, 매 실행이 빈손으로 돌아오면서도 ok=true 를 남겼고
//     뒤의 234건은 손도 못 댄 채 2주 가까이 방치됐다.
//   - 실행 요약(note)을 반드시 남길 것. 그 한 줄이 없으면 감시가 볼 게 없다.
//
// Run with `node tests/faq-backfill.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

function stub(rel, exports) {
  const p = path.join(__dirname, '..', 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });

const {
  normalizeBatch, toPlain, parseFaqResponse,
  selectWorkable, scanSpan, MIN_BODY_CHARS,
} = require('../api/_lib/faqBackfill');

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
section('selectWorkable — 거른 뒤에 자른다 (2026-08-04 회귀)');

const shortBody = '<p>' + 'ㄱ'.repeat(40) + '</p>';          // 40자 — 기준 미달
const longBody = '<p>' + '가'.repeat(300) + '</p>';          // 충분히 김

// 짧은 기사 12건이 앞줄을 막고 있고, 그 뒤에 멀쩡한 기사가 있는 상황.
const wall = [];
for (let i = 0; i < 12; i++) wall.push({ id: 's' + i, title: '사진 ' + i, content: shortBody });
for (let i = 0; i < 5; i++) wall.push({ id: 'L' + i, title: '기사 ' + i, content: longBody });

const picked = selectWorkable(wall, 10);
ok('앞의 짧은 기사에 막히지 않는다', picked.rows.length === 5);
ok('고른 건 전부 긴 기사', picked.rows.every(r => String(r.id)[0] === 'L'));
ok('짧아서 건너뛴 수를 센다', picked.tooShort === 12);

const capped = selectWorkable(
  Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, title: 't', content: longBody })), 10);
ok('요청한 배치 크기를 넘지 않는다', capped.rows.length === 10);

ok('제목 없는 행은 제외', selectWorkable([{ id: 'n', title: '', content: longBody }], 5).rows.length === 0);
ok('빈 입력도 안전', selectWorkable(null, 5).rows.length === 0);
ok('기준 길이는 80자', MIN_BODY_CHARS === 80);

/* 정확히 경계에 걸친 본문은 포함한다 — 경계에서 한 건씩 새면 잔여가 영영 안 준다. */
const exact = '<p>' + '가'.repeat(MIN_BODY_CHARS) + '</p>';
ok('정확히 80자는 대상', selectWorkable([{ id: 'e', title: 't', content: exact }], 5).rows.length === 1);

section('scanSpan — 한 페이지에 훑을 폭');
ok('배치의 8배', scanSpan(20) === 160);
ok('최소 60 보장', scanSpan(1) === 60);
ok('최대 200 제한', scanSpan(100) === 200);

/* ---------------------------------------------------------------- */
section('실행 요약(note) — 감시가 읽을 한 줄');

const faqSrc = fs.readFileSync(
  path.join(__dirname, '..', 'api', '_lib', 'faqBackfill.js'), 'utf8');
ok("생산 요약은 'FAQ p/b' 형식", /'FAQ ' \+ processed \+ '\/' \+ rows\.length/.test(faqSrc));
ok("완주는 'FAQ 0 · 완주'", faqSrc.indexOf("'FAQ 0 · 완주'") !== -1);
ok("막힘은 'FAQ 0 · 대상 없음'", faqSrc.indexOf("'FAQ 0 · 대상 없음") !== -1);
ok('페이지를 넘기며 훑는다(.range 사용)', /\.range\(from, from \+ span - 1\)/.test(faqSrc));
ok('LIMIT 먼저 걸던 옛 코드가 남아 있지 않다', faqSrc.indexOf('.limit(size)') === -1);

const cronSrc = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'cron', 'backfill-faq.js'), 'utf8');
ok('크론이 cronNote 를 남긴다', /res\.locals\.cronNote/.test(cronSrc));

/* 요약 문장이 감시(faqHealth)의 해석과 실제로 맞물리는지 — 둘이 어긋나면
   경보가 조용해진다. 문자열 규약을 한쪽만 고치는 사고를 여기서 막는다. */
const { parseFaqNote } = require('../api/_lib/faqHealth');
ok('감시가 생산 요약을 읽는다', parseFaqNote('FAQ 7/10 · 잔여 227').produced === 7);
ok('감시가 완주를 읽는다', parseFaqNote('FAQ 0 · 완주').kind === 'done');
ok('감시가 막힘을 읽는다',
  parseFaqNote('FAQ 0 · 대상 없음 — 앞 60건이 전부 본문 80자 미만 (잔여 234)').kind === 'wall');

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
