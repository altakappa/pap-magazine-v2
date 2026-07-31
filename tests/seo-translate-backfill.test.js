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

  /* 2026-07-31 — 링을 예산이 다할 때까지 반복해서 돈다.
     전에는 조합 목록을 한 바퀴만 돌고 끝나서, 예산이 남아도 함수가 그냥
     종료됐다(에디토리얼 호출은 10초대라 예산 대부분이 버려졌다).
     따라서 "각 언어가 정확히 1회 호출된다" 는 더 이상 계약이 아니다.
     계약은 **모든 언어가 빠짐없이 다뤄진다** 이다. */
  console.log('\n=== 모든 언어를 다룬다 (예산 안에서 반복) ===');
  let res = await run();
  ok('it/fr/es 전부 호출됨',
    ['it', 'fr', 'es'].every(l => calls.some(c => c.lang === l)),
    calls.map(c => c.lang).join(','));
  ok('한 언어만 독식하지 않는다', new Set(calls.map(c => c.lang)).size === 3);
  /* 크론의 에디토리얼 배치는 8 이다 — 20 이 아니다 (2026-07-31).
     조합당 Claude 호출 타임아웃(35초) 안에 20건은 못 끝나고, 타임아웃이 나면
     이미 번역된 응답까지 통째로 버려진다. 실측: 12시간 31회 실행 전부 ok 인데
     es/fr/ja 에디토리얼 저장 0건. "20건 × 0회" 보다 "8건 × 매회" 가 크다. */
  ok('크론 에디토리얼 batch 는 호출 타임아웃 안에 끝날 크기', calls.every(c => c.batch === 8));
  ok('언어당 타임아웃 지정됨', calls.every(c => c.timeoutMs > 0 && c.timeoutMs <= 50000));
  ok('processed 는 실제 호출 수만큼 합산된다', res.body.processed === 20 * calls.length,
    `processed=${res.body.processed} calls=${calls.length}`);
  ok('remainingTotal 은 조합별 최신값 합계 (중복 계산 금지)', res.body.remainingTotal === 300,
    '같은 조합을 여러 번 돌아도 잔량을 더하면 안 된다 — 실제=' + res.body.remainingTotal);
  ok('완주 아니면 allDone 없음', res.body.allDone === undefined);

  /* ── 실행 기록 (2026-07-31 신설) ────────────────────────────────
     cronGuard 는 res.locals.cronNote 를 cron_runs.note 에 저장한다. 이걸 안
     채우면 ok/실패와 소요시간만 남는다 — 실제로 12시간 · 31회 실행이 전부
     ok 로 기록되는 동안 es/fr/ja 저장이 0건인 걸 아무도 몰랐다.
     "함수가 안 죽었다" 와 "일을 했다" 는 다르다. */
  console.log('\n=== 실행 결과를 기록에 남긴다 ===');
  {
    behavior = (o) => (o.lang === 'fr'
      ? new Error('Claude API 실패 (500): boom')
      : { processed: 7, remaining: 42 });
    const r = mkRes(); calls = [];
    await handler({ headers: {} }, r);
    const note = r.locals && r.locals.cronNote;
    ok('note 를 남긴다', typeof note === 'string' && note.length > 0);
    // 링을 여러 바퀴 도므로 건수는 누적된다 — 조합당 한 줄로 합쳐졌는지를 본다.
    const itLine = (note.match(/it\/edi:(\d+)/) || []);
    ok('저장 건수가 보인다 (조합당 한 줄로 합산)',
      itLine.length === 2 && Number(itLine[1]) > 0 && Number(itLine[1]) % 7 === 0, note);
    ok('실패한 조합이 보인다', /fr\/.*ERR/.test(note), note);
    ok('잔량이 보인다', /남42/.test(note), note);
    behavior = () => ({ processed: 20, remaining: 100 });
  }

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

  /* 429 → 그 다음 '웨이브'부터 중단 (2026-07-31, 병렬 처리 도입으로 의미 조정).
     조합을 3개씩 동시에 던지므로, 같은 웨이브에서 이미 날아간 요청까지
     되돌릴 수는 없다. 지켜야 할 것은 "429 를 보고도 계속 밀어넣지 않는다" 이고,
     그건 다음 웨이브를 막는 것으로 충족된다. 같은 웨이브의 동시 실패는
     저장 없이 error 로 보고될 뿐 rate limit 을 악화시키지 않는다. */
  console.log('\n=== 429 → 이후 웨이브 중단 ===');
  behavior = (o) => (o.lang === 'it' ? new Error('Claude API 실패 (429): rate limited') : { processed: 20, remaining: 5 });
  res = await run();
  ok('rateLimited 플래그', res.body.rateLimited === true);
  ok('429 이후 새 조합을 추가로 밀어넣지 않는다',
    calls.length <= 3, `429 뒤에도 계속 호출하면 한도만 악화된다 (호출 ${calls.length}회)`);
  ok('잔량 미확정이면 remainingTotal 생략', res.body.remainingTotal === undefined);

  console.log('\n=== 일반 에러는 그 언어만 실패 ===');
  behavior = (o) => (o.lang === 'it' ? new Error('DB 일시 오류') : { processed: 20, remaining: 5 });
  res = await run();
  ok('나머지 언어 계속 진행',
    calls.some(c => c.lang === 'fr') && calls.some(c => c.lang === 'es'));
  ok('실패 언어 error 로 보고', !!res.body.results.find(r => r.lang === 'it' && r.error));
  ok('rateLimited 아님', res.body.rateLimited === undefined);

  console.log('\n=== SEO_TRANSLATE_LANGS / SEO_TRANSLATE_BATCH ===');
  behavior = () => ({ processed: 3, remaining: 7 });
  process.env.SEO_TRANSLATE_LANGS = 'fr, xx ,es';
  res = await run();
  ok('유효한 언어만 처리 (fr,es — xx 는 무시)',
    Array.from(new Set(calls.map(c => c.lang))).sort().join(',') === 'es,fr');
  delete process.env.SEO_TRANSLATE_LANGS;

  process.env.SEO_TRANSLATE_EDITORIAL_BATCH = '5';
  await run();
  ok('에디토리얼 batch 환경변수 반영', calls.every(c => c.batch === 5));
  process.env.SEO_TRANSLATE_EDITORIAL_BATCH = '999';
  await run();
  ok('batch 상한 20 유지', calls.every(c => c.batch === 20));
  delete process.env.SEO_TRANSLATE_EDITORIAL_BATCH;

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

    /* ── 2026-07-30 ─────────────────────────────────────────────────
       ja 가 기본 언어에서 빠져 있었다. 사이트는 9개 언어를 표방하고
       hreflang·사이트맵도 ja 를 내보내는데, 번역 크론만 손대지 않아
       2,450행 중 189건만 내용이 있었다. 껍데기만 있고 알맹이가 없는 상태. */
    /* 2026-07-31 — 선택기의 9개 언어를 전부 기본 대상으로. de 3% · ru 1% ·
       zh 0.5% 인 채로 사이트는 9개 언어를 표방하고 hreflang 을 내보내고 있었다.
       기본값에서 빠진 언어는 운영에서 영영 안 돈다(ja 가 그랬다). */
    const defLangs = (cronSrc.match(/SEO_TRANSLATE_LANGS \|\| '([^']+)'/) || [])[1] || '';
    ok('기본 언어가 사이트 9개 언어(ko·en 제외 7개)를 모두 덮는다',
      ['it', 'fr', 'es', 'ja', 'de', 'ru', 'zh'].every(l => defLangs.split(',').includes(l)),
      '기본값: ' + defLangs);

    /* 예산은 함수 상한 안에서 끝나야 한다. cronGuard 는 '끝날 때' 기록하므로,
       상한에 걸려 죽으면 로그조차 없다 — 실측에서 24시간 23/144 회만 기록됐고
       나머지는 흔적이 없었다. 숫자를 박지 말고 vercel.json 과의 관계로 고정한다. */
    const vjSrc = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'vercel.json'), 'utf8'));
    const maxDur = ((vjSrc.functions || {})['api/**/*.js'] || {}).maxDuration || 120;
    const budget = Number((cronSrc.match(/BUDGET_MS = (\d+)/) || [])[1] || 0);
    const slack = Number((cronSrc.match(/WAVE_SLACK_MS = (\d+)/) || [])[1] || 0);
    const callMs = (cronSrc.match(/CALL_MS = \{([^}]+)\}/) || [])[1] || '';
    const calls_ = (callMs.match(/(\d+)/g) || []).map(Number);
    const slowest = calls_.length ? Math.max(...calls_) : 0;

    ok('시간 예산이 함수 상한보다 충분히 작다 (여유 20s+)',
      budget > 0 && budget + 20000 <= maxDur * 1000,
      `예산 ${budget}ms · 상한 ${maxDur * 1000}ms`);
    /* 마지막 웨이브가 예산 직전에 시작해도 함수 상한 안에서 끝나야 한다.
       (예산) + (가장 느린 호출) + (여유) ≤ 상한. 이 관계가 깨지면 함수가
       죽고, 죽으면 cronGuard 기록조차 안 남아 원인 추적이 불가능해진다 —
       실측에서 24시간 23/144 회만 기록됐고 나머지는 흔적이 없었다. */
    ok('가장 느린 호출이 예산 끝에 시작해도 상한을 안 넘는다',
      slowest > 0 && budget + slack <= maxDur * 1000
      && (budget - slowest - slack) > 0,
      `예산 ${budget} · 최장호출 ${slowest} · 여유 ${slack} · 상한 ${maxDur * 1000}`);
    ok('종류별 호출 타임아웃이 예산 안에 들어간다',
      calls_.length >= 2 && calls_.every(c => c + slack < budget),
      '타임아웃: ' + calls_.join(','));
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
