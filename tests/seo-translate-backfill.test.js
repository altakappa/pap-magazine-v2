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
  /* 2026-07-21 — de 는 이제 지원 언어다(9개 언어 확장). 진짜 미지원 코드로 검사한다. */
  try { await helper.runBackfillBatch({ lang: 'xx' }); ok('지원 안 하는 lang 거부', false); }
  catch (e) { ok('지원 안 하는 lang → 400', e.statusCode === 400); }
  ok('9개 언어 지원 (it fr es ja zh ru de)',
    ['it','fr','es','ja','zh','ru','de'].every(l => !!helper.LANG_NAMES[l])
    && Object.keys(helper.LANG_NAMES).length === 7);
  ok('kind 는 editorial|article', 
    !!helper.KINDS && !!helper.KINDS.editorial && !!helper.KINDS.article);
  ok('아티클만 본문을 번역한다',
    helper.KINDS.article.translateBody === true && helper.KINDS.editorial.translateBody === false);
  ok('아티클 배치가 더 작다 (본문 길이 때문)',
    helper.KINDS.article.defaultBatch < helper.KINDS.editorial.defaultBatch);
  /* 파일럿(2026-07-21)에서 발견: 개수만으로 묶으면 긴 글이 몰린 배치가
     max_tokens 안에서 잘려 통째로 실패한다. 실측 분포는 486건 중 465건이
     2,000자 이하인데 최대 12,963자가 있어 편차가 크다. */
  ok('아티클은 문자수 예산으로도 자른다', helper.KINDS.article.charBudget > 0);
  ok('에디토리얼은 예산 불필요 (설명 평균 15자)', helper.KINDS.editorial.charBudget === 0);
  ok('아티클 max_tokens 가 더 크다 (본문 번역)',
    helper.KINDS.article.maxTokens > helper.KINDS.editorial.maxTokens);
  ok('최장 아티클(12,963자)도 단독 배치로 처리 가능',
    helper.KINDS.article.maxTokens >= 16000);
  try { await helper.runBackfillBatch({ lang: 'it', kind: 'nope' }); ok('잘못된 kind 거부', false); }
  catch (e) { ok('잘못된 kind → 400', e.statusCode === 400); }

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
  /* 2026-07-30 — 픽스처를 고쳤다. 예전엔 seoRows: [{content_id:'a'}] 처럼
     '행만 있으면 완료' 를 전제했는데, 그 전제가 바로 오늘 고친 버그다.
     실측: ja 2,450행 중 실제 내용이 있는 건 105건(4%)뿐인데도 잔여 0 으로
     보고됐다. 이제 '내용까지 있어야 완료' 이므로 픽스처도 내용을 갖는다. */
  db = {
    seoRows: [{ content_id: 'a', description: 'Una traduzione italiana完 già presente e sufficientemente lunga.' }],
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

  /* ── 2026-07-30 신설: '빈 껍데기' 를 완료로 세지 않는다 ──────────────
     원본 설명이 없던 시절에 빈 값으로 저장된 행이 영구히 '완료' 로 잡혀
     재시도되지 않았다(ja 2,345건 · fr 442 · es 315 · it 305).
     행의 존재가 아니라 내용의 길이로 판정해야 그 행들이 되살아난다. */
  console.log('\n=== 빈 껍데기 번역행은 재시도 대상 ===');
  db = {
    seoRows: [
      { content_id: 'a', description: '' },      // 빈 행 — 완료가 아니다
      { content_id: 'b', description: '짧음' },   // 너무 짧아도 완료가 아니다
    ],
    editorials: [
      { id: 'a', title: 'A', description_it: 'testo italiano esistente' },
      { id: 'b', title: 'B', description_it: 'altro testo italiano' },
    ],
    upserts: [],
  };
  const rEmpty = await helper.runBackfillBatch({ lang: 'it' });
  ok('빈 행·짧은 행 모두 다시 처리한다', db.upserts.length === 2,
    '실제=' + db.upserts.length);
  ok('처리 건수에 반영', rEmpty.processed === 2);

  /* ── 2026-07-30 신설: 원본이 없으면 아예 시도하지 않는다 ─────────────
     번역할 게 없는데 호출하면 빈 값이 저장되고, 그 행이 다시 '완료' 로
     잡혀 영구 제외된다 — 위의 2,345건이 정확히 그렇게 만들어졌다.
     서술문 백필이 원본을 채우면 자연히 대상에 들어온다. */
  console.log('\n=== 원본 없는 행은 대상에서 제외 (빈 번역 재생산 금지) ===');
  db = {
    seoRows: [],
    editorials: [
      { id: 'a', title: 'A', description: '' },                 // 원본 없음
      { id: 'b', title: 'B', description: '짧다' },              // 30자 미만
    ],
    upserts: [],
  };
  const rNoSrc = await helper.runBackfillBatch({ lang: 'fr' });
  ok('원본 없는 행은 저장하지 않는다', db.upserts.length === 0);
  ok('그 사실을 숫자로 보고한다 (완주로 착각 금지)', rNoSrc.skipped_no_source === 2,
    '실제=' + rNoSrc.skipped_no_source);
  ok('메시지로도 구분된다', /원본\(설명\) 없는/.test(rNoSrc.message || ''));

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
  /* 2026-07-21 — 크론이 (lang × kind) 를 순회하도록 확장됐다.
     아래 검증들은 "언어 순차 처리" 계약을 보는 것이므로 kind 를 editorial
     하나로 고정하고, 회전도 꺼서 순서를 결정적으로 만든다.
     (kind 확장 자체는 아래 별도 케이스에서 본다) */
  process.env.SEO_TRANSLATE_KINDS = 'editorial';
  process.env.SEO_TRANSLATE_ROTATE = '0';

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

  /* ── kind 확장 (2026-07-21) ─────────────────────────────────────
     아티클 본문 번역이 크론에도 들어왔다. 확인할 것:
       · (lang × kind) 조합을 모두 순회하는가
       · 아티클 배치가 작은가 (본문 1건당 15~20초라 예산을 넘기면 안 된다) */
  {
    process.env.SEO_TRANSLATE_KINDS = 'editorial,article';
    process.env.SEO_TRANSLATE_LANGS = 'it';   // 스텁 LANG_NAMES 에 있는 언어라야 통과한다
    behavior = () => ({ processed: 1, remaining: 0 });
    await run();
    const seen = calls.slice();
    ok('it × (editorial, article) 두 조합 모두 호출',
      seen.length === 2 && seen.some(x => x.kind === 'editorial') && seen.some(x => x.kind === 'article'));
    const art = seen.find(x => x.kind === 'article');
    const edi = seen.find(x => x.kind === 'editorial');
    ok('아티클 배치가 크론에서 더 작다', !!art && !!edi && art.batch < edi.batch);
    ok('아티클 크론 배치는 2', !!art && art.batch === 2);
    /* 위 검증들은 SEO_TRANSLATE_KINDS 를 명시로 넘기므로 "기본값"은 보호하지
       못한다(역검증에서 실제로 안 잡혔다). 기본값이 article 을 포함하는지는
       소스를 직접 확인한다 — 기본에서 빠지면 운영에서 아티클이 영영 안 돈다. */
    const cronSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'api/cron/backfill-translations.js'), 'utf8');
    ok('크론 기본 대상에 article 이 포함된다',
      /SEO_TRANSLATE_KINDS \|\| 'editorial,article'/.test(cronSrc));
    process.env.SEO_TRANSLATE_KINDS = 'editorial';
    process.env.SEO_TRANSLATE_LANGS = 'it,fr,es';
  }
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
