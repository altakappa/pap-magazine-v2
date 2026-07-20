// PAP Magazine — 다국어 SEO 번역 백필 테스트
//
// Guards the 2026-07-21 change: 번역 백필 로직을 api/_lib/seoTranslateBackfill.js
// 로 추출하고, 10분 주기 크론(api/cron/backfill-translations.js)을 붙였다.
// 그전까지는 사람이 브라우저로 관리자 엔드포인트를 20건씩 수백 번 호출했다.
//
// 무엇을 지키나:
//   - 크론이 CRON_SECRET 없이 열리지 않을 것 (다른 크론과 동일 규약)
//   - 잔량 0이면 Claude 를 호출하지 않을 것 (완주 후 크론을 켜둬도 무해해야 함)
//   - 이미 번역된 항목을 다시 번역하지 않을 것 (돈이 나가는 회귀)
//   - 429 를 만나면 남은 언어까지 즉시 멈출 것 (rate limit 악화 방지)
//   - 일반 에러는 한 언어만 실패하고 나머지는 계속할 것
//   - batch 가 1~20 밖으로 새지 않을 것 (Claude 1콜 max_tokens 안전선)
//
// 실제 프로덕션 모듈을 로드하되, supabase 클라이언트와 헬퍼는 require.cache
// 주입으로 스텁을 끼운다 — 네트워크·DB·API 키 없이 로직만 검증한다.
//
// Run with `node tests/seo-translate-backfill.test.js` (wired into `npm test`).

'use strict';

const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const CRON = path.join(ROOT, 'api', 'cron', 'backfill-translations.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function inject(filePath, exports) {
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.loaded = true;
  m.exports = exports;
  require.cache[filePath] = m;
}

/* ------------------------------------------------------------------ */
/* Part 1 — 헬퍼 (supabase 스텁)                                        */
/* ------------------------------------------------------------------ */

let db = { seoRows: [], editorials: [], upserts: [] };
inject(SUPABASE, {
  supabaseAdmin: {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({
          data: table === 'seo_translations' ? db.seoRows : db.editorials,
          error: null,
        }),
        upsert: (row) => { db.upserts.push(row); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
});

const helper = require(HELPER);

async function testHelper() {
  console.log('\n=== normalizeBatch (1~20 클램프) ===');
  const nb = helper.normalizeBatch;
  ok('값 없으면 기본값', nb(undefined, 20) === 20);
  ok('20 초과는 20으로', nb('99', 20) === 20);
  ok('0 이하는 1로', nb('0', 20) === 1);
  ok('정상값 통과', nb('15', 20) === 15);
  ok('숫자 아니면 기본값', nb('abc', 20) === 20);

  console.log('\n=== 입력 검증 ===');
  try { await helper.runBackfillBatch({ lang: 'de' }); ok('지원 안 하는 lang 거부', false); }
  catch (e) { ok('지원 안 하는 lang → 400', e.statusCode === 400); }

  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try { await helper.runBackfillBatch({ lang: 'it' }); ok('API 키 없이 거부', false); }
  catch (e) { ok('ANTHROPIC_API_KEY 누락 → 503', e.statusCode === 503); }
  process.env.ANTHROPIC_API_KEY = 'test-key-not-used';

  console.log('\n=== 잔량 0 → Claude 호출 없이 no-op ===');
  db = { seoRows: [], editorials: [], upserts: [] };
  const r0 = await helper.runBackfillBatch({ lang: 'fr' });
  ok('remaining 0', r0.remaining === 0);
  ok('processed 0', r0.processed === 0);
  ok('DB 쓰기 없음', db.upserts.length === 0);

  console.log('\n=== 이미 번역된 항목은 재번역하지 않음 ===');
  db = {
    seoRows: [{ content_id: 'a' }],                       // a 는 이미 번역됨
    editorials: [
      { id: 'a', title: 'A', description_it: 'gia tradotto' },
      { id: 'b', title: 'B', description_it: 'ciao' },
    ],
    upserts: [],
  };
  const rIt = await helper.runBackfillBatch({ lang: 'it' });
  ok('it fast-path 진입 (description_it 재사용)', rIt.mode === 'fastpath-description_it');
  ok('미번역 b 만 저장', db.upserts.length === 1 && db.upserts[0].content_id === 'b');
  ok('저장 kind/lang 정확', db.upserts[0].kind === 'editorial' && db.upserts[0].lang === 'it');
  ok('remaining 반영', rIt.remaining === 0);

  console.log('\n=== 제목 없는 에디토리얼은 대상에서 제외 ===');
  db = { seoRows: [], editorials: [{ id: 'x', title: null, description_it: 'z' }], upserts: [] };
  const rNo = await helper.runBackfillBatch({ lang: 'it' });
  ok('title 없으면 pending 아님', rNo.remaining === 0 && db.upserts.length === 0);

  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
}

/* ------------------------------------------------------------------ */
/* Part 2 — 크론 핸들러 (헬퍼 스텁)                                     */
/* ------------------------------------------------------------------ */

let calls = [];
let behavior = () => ({ processed: 20, remaining: 100 });

async function testCron() {
  delete require.cache[CRON];
  inject(HELPER, {
    LANG_NAMES: { it: 'Italian', fr: 'French', es: 'Spanish' },
    normalizeBatch: helper.normalizeBatch,
    runBackfillBatch: async (o) => {
      calls.push(o);
      const r = behavior(o);
      if (r instanceof Error) throw r;
      return Object.assign({ lang: o.lang }, r);
    },
  });
  const handler = require(CRON);

  function mkRes() {
    const r = {
      code: null, body: null,
      status(c) { r.code = c; return r; },
      json(b) { r.body = b; return r; },
    };
    return r;
  }
  const run = async (headers) => { const res = mkRes(); calls = []; await handler({ headers: headers || {} }, res); return res; };

  process.env.ANTHROPIC_API_KEY = 'test-key-not-used';

  console.log('\n=== CRON_SECRET 보호 ===');
  process.env.CRON_SECRET = 'sekret';
  ok('시크릿 없는 요청 401', (await run({})).code === 401);
  ok('틀린 시크릿 401', (await run({ authorization: 'Bearer wrong' })).code === 401);
  ok('맞는 시크릿 200', (await run({ authorization: 'Bearer sekret' })).code === 200);
  delete process.env.CRON_SECRET;

  console.log('\n=== 3개 언어 순차 처리 ===');
  let res = await run();
  ok('it/fr/es 순서로 호출', calls.map(c => c.lang).join(',') === 'it,fr,es');
  ok('언어당 batch 20', calls.every(c => c.batch === 20));
  ok('언어당 타임아웃 지정됨', calls.every(c => c.timeoutMs > 0 && c.timeoutMs <= 50000));
  ok('processed 합산 (20*3)', res.body.processed === 60);
  ok('remainingTotal 합산 (100*3)', res.body.remainingTotal === 300);
  ok('완주 아니면 allDone 없음', res.body.allDone === undefined);

  console.log('\n=== 완주 감지 ===');
  behavior = () => ({ processed: 0, remaining: 0 });
  res = await run();
  ok('allDone true', res.body.allDone === true);
  ok('remainingTotal 0', res.body.remainingTotal === 0);

  console.log('\n=== ANTHROPIC_API_KEY 누락 ===');
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  ok('503 반환', (await run()).code === 503);
  process.env.ANTHROPIC_API_KEY = savedKey;

  console.log('\n=== 429 → 남은 언어까지 즉시 중단 ===');
  behavior = (o) => (o.lang === 'it' ? new Error('Claude API 실패 (429): rate limited') : { processed: 20, remaining: 5 });
  res = await run();
  ok('첫 언어에서 멈춤 (fr/es 호출 안 함)', calls.length === 1);
  ok('rateLimited 플래그', res.body.rateLimited === true);
  ok('남은 언어 skipped 기록', res.body.results.filter(r => r.skipped === 'rate-limited-earlier').length === 2);
  ok('잔량 미확정이면 remainingTotal 생략', res.body.remainingTotal === undefined);

  console.log('\n=== 일반 에러는 그 언어만 실패 ===');
  behavior = (o) => (o.lang === 'it' ? new Error('DB 일시 오류') : { processed: 20, remaining: 5 });
  res = await run();
  ok('나머지 언어 계속 진행', calls.length === 3);
  ok('실패 언어 error 로 보고', !!res.body.results.find(r => r.lang === 'it' && r.error));
  ok('rateLimited 아님', res.body.rateLimited === undefined);

  console.log('\n=== SEO_TRANSLATE_LANGS / SEO_TRANSLATE_BATCH ===');
  behavior = () => ({ processed: 3, remaining: 7 });
  process.env.SEO_TRANSLATE_LANGS = 'fr, xx ,es';
  res = await run();
  ok('유효한 언어만 처리 (fr,es)', calls.map(c => c.lang).join(',') === 'fr,es');
  delete process.env.SEO_TRANSLATE_LANGS;

  process.env.SEO_TRANSLATE_BATCH = '5';
  await run();
  ok('batch 환경변수 반영', calls.every(c => c.batch === 5));
  process.env.SEO_TRANSLATE_BATCH = '999';
  await run();
  ok('batch 상한 20 유지', calls.every(c => c.batch === 20));
  delete process.env.SEO_TRANSLATE_BATCH;
}

/* ------------------------------------------------------------------ */

(async () => {
  // 크론이 429/에러 경로에서 console.error 로 남기는 로그는 테스트 출력에서 숨긴다.
  const realError = console.error;
  console.error = () => {};
  try {
    await testHelper();
    await testCron();
  } finally {
    console.error = realError;
  }
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('✗ seo-translate-backfill tests FAILED'); process.exit(1); }
  console.log('✓ seo-translate-backfill tests passed');
})();
