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

  /* ── 2026-07-31 · 모델 응답 파싱 ────────────────────────────────────
   라이브 실측:
     es/edi:0 ERR 번역 응답 JSON 파싱 실패: ```json\n[{"i":0,"title":"The Mod…
     de/edi:0 ERR 번역 응답 JSON 파싱 실패: ```json\n[{"i":0,"title":"Form Do…
   같은 실행에서 fr·ja 는 통과했다. 프롬프트로 "코드 펜스 금지" 를 지시해도
   모델은 가끔 붙이고, 그때마다 배치 전체가 버려진다 — 번역은 다 됐는데
   저장은 0건. 형태를 열거하지 말고 '배열의 경계'만 쓰는지 확인한다. */
console.log('\n=== 모델이 뭘 덧붙여도 배열만 꺼낸다 ===');
{
  const P = helper.parseJsonArray;
  const want = [{ i: 0, title: 'A', description: 'B' }];
  const eq = (v) => JSON.stringify(v) === JSON.stringify(want);
  const body = '[{"i":0,"title":"A","description":"B"}]';

  ok('맨몸 JSON', eq(P(body)));
  ok('```json 코드 펜스 (라이브에서 실제로 터진 형태)', eq(P('```json\n' + body + '\n```')));
  ok('언어 없는 코드 펜스', eq(P('```\n' + body + '\n```')));
  ok('서두 설명문이 붙어도', eq(P('Here is the translation:\n' + body)));
  ok('후미 문구가 붙어도', eq(P(body + '\n\nLet me know if you need changes.')));
  ok('앞뒤 공백·개행', eq(P('\n\n  ' + body + '  \n')));

  let threw = false;
  try { P('죄송합니다, 번역할 수 없습니다.'); } catch (_) { threw = true; }
  ok('배열이 아예 없으면 조용히 넘어가지 않는다', threw,
    '빈 배열로 처리하면 그 배치가 영구히 완료로 잡힌다');

  threw = false;
  try { P('[{"i":0,"title":"잘린'); } catch (_) { threw = true; }
  ok('잘린 응답은 실패로 (부분 저장 금지)', threw);
}

/* ── 2026-08-03 Patch 4 · 잘린 응답 부분 복구 ──────────────────────
   Patch 3(독배치 해소) 배포 후에도 콜의 7.8%(153콜 중 12콜)가 버려졌다.
   이번 원인은 타임아웃이 아니라 응답 형태였다 — 닫는 ']' 가 없거나(응답
   절단), 설명문 안의 ']' 때문에 통째 파싱이 깨졌다. 어느 쪽이든 배치
   전체(최대 20건)를 버렸다: 19건이 멀쩡해도 마지막 한 건 때문에 함께.
   실측 실패 예: de 가 14:05~14:21 9회 연속, zh 가 14:33·14:35.
   여기서 지키는 것 — "온전한 건은 살리고, 잘린 마지막 조각만 버린다". */
console.log('\n=== 잘린 응답에서 온전한 건만 건진다 (Patch 4) ===');
{
  const P = helper.parseJsonArray;

  // 3건 중 2건은 온전, 3번째가 문장 중간에서 끊겼다 (닫는 ']' 없음).
  const cut = '[{"i":0,"title":"A","description":"AA"},' +
              '{"i":1,"title":"B","description":"BB"},' +
              '{"i":2,"title":"C","description":"CC 중간에서';
  const r1 = P(cut);
  ok('잘린 배열에서 온전한 2건을 건진다', Array.isArray(r1) && r1.length === 2);
  ok('건진 건의 내용이 온전하다', r1[1] && r1[1].i === 1 && r1[1].description === 'BB');

  // 코드 펜스 + 절단 조합 (라이브 실패 note 형태: ```json\n[{"i":0,"title":"…)
  const r2 = P('```json\n' + cut);
  ok('코드 펜스 + 절단 조합도 복구', Array.isArray(r2) && r2.length === 2);

  /* 설명문 안에 ']' 가 있으면 "첫 '[' ~ 마지막 ']'" 잘라내기가 오히려
     JSON 을 깨뜨린다 — 통째 파싱이 실패해도 건별 복구가 받아낸다. */
  const bracketInside = '[{"i":0,"title":"A ] B","description":"CC"},' +
                        '{"i":1,"title":"D';
  const r3 = P(bracketInside);
  ok("설명문 속 ']' 로 통째 파싱이 깨져도 앞 건은 살린다",
    Array.isArray(r3) && r3.length === 1 && r3[0].title === 'A ] B');

  // 이스케이프된 따옴표가 문자열 경계로 오인되지 않아야 한다.
  const escaped = '[{"i":0,"title":"He said \\"hi\\"","description":"ok"},{"i":1,"title":"X';
  const r4 = P(escaped);
  ok('이스케이프 따옴표를 문자열 끝으로 착각하지 않는다',
    Array.isArray(r4) && r4.length === 1 && r4[0].title === 'He said "hi"');

  // title 이 없는 조각은 저장해도 쓸모가 없다 — 건지지 않는다.
  const noTitle = '[{"i":0,"description":"제목 없음"},{"i":1,"title":"B"},{"i":2,"tit';
  const r5 = P(noTitle);
  ok('title 없는 조각은 버린다', Array.isArray(r5) && r5.length === 1 && r5[0].i === 1);

  // 정상 응답은 예전 경로 그대로 (복구 로직이 정상 경로를 바꾸지 않는다).
  const whole = '[{"i":0,"title":"A","description":"B"},{"i":1,"title":"C","description":"D"}]';
  const r6 = P(whole);
  ok('정상 배열은 그대로 전부 반환', Array.isArray(r6) && r6.length === 2);

  /* 한 건도 못 건지면 여전히 던진다 — 조용히 0건 성공으로 끝나면 안 된다.
     2026-08-08: 문구가 `복구 0건` → `파싱 실패[진단명]` 으로 바뀌었다.
     이유는 tests/translate-json-repair.test.js 머리말 참고 — 78회의 실패를
     보고도 원인을 못 갈라서, 진단명을 문구 맨 앞으로 뺐다.
     여기서 지키려는 것은 문구가 아니라 **던진다는 사실**이므로 그것만 본다
     (진단명 자체는 위 전용 테스트가 지킨다). */
  let threw = false, diagnosed = false;
  try { P('[{"i":0,"tit'); }
  catch (e) { threw = true; diagnosed = /파싱 실패\[[^\]]+\]/.test(String(e.message)); }
  ok('한 건도 못 건지면 실패로 던진다(조용한 0건 금지)', threw);
  ok('실패 문구에 진단명이 붙는다', diagnosed);
}

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
  /* 2026-08-03 회귀 방지 — 예전엔 charBudget === 0(무제한)이었다.
     실측: 큐 선두의 7,387자짜리 설명 한 건이 es·de·ja 를 영구히 막았다
     (배치 반감 재시도로도 못 피한다 — 배치 1이 곧 그 행이므로).
     ① 에디토리얼도 문자수 예산으로 자를 것
     ② 모델에 보내는 설명 길이에 상한이 있을 것 (저장은 어차피 2,000자 컷)
     ③ 예산 계산이 description 도 볼 것 (전에는 body 만 봐서 항상 0이었다) */
  ok('에디토리얼도 문자수 예산으로 자른다', helper.KINDS.editorial.charBudget > 0);
  {
    const long = 'x'.repeat(50000);
    const srcOut = helper.KINDS.editorial.src({ title: 't', description_en: long });
    ok('에디토리얼 원본 설명에 상한이 있다 (poison pill 방지)',
      srcOut.description.length > 0 && srcOut.description.length <= 2000);
    ok('상한이 저장 컷(2000자) 이하다', srcOut.description.length < long.length);
    ok('예산 계산이 description 을 본다',
      String(srcOut.body || srcOut.description || '').length === srcOut.description.length);
    const short = helper.KINDS.editorial.src({ title: 't', description_en: 'abc' });
    ok('짧은 설명은 그대로 통과', short.description === 'abc');
  }
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

/* 크론이 모듈 로드 시점에 참조를 잡으므로, 이 객체를 '갈아끼우지 말고 고쳐' 써야
   한다. 기본 3개 언어로 두는 이유: 여기에 언어를 늘리면 기본값 경로를 쓰는
   다른 검증들의 기대 개수가 통째로 흔들린다. CJK 검증에서만 잠시 추가한다. */
const STUB_LANGS = { it: 'Italian', fr: 'French', es: 'Spanish' };

async function testCron() {
  /* 2026-07-21 — 크론이 (lang × kind) 를 순회하도록 확장됐다.
     아래 검증들은 "언어 순차 처리" 계약을 보는 것이므로 kind 를 editorial
     하나로 고정하고, 회전도 꺼서 순서를 결정적으로 만든다.
     (kind 확장 자체는 아래 별도 케이스에서 본다) */
  process.env.SEO_TRANSLATE_KINDS = 'editorial';
  process.env.SEO_TRANSLATE_ROTATE = '0';

  delete require.cache[CRON];
  inject(HELPER, {
    LANG_NAMES: STUB_LANGS,
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
  /* 2026-09-04 보안감사 — 크론이 fail-closed 가 됐다(CRON_SECRET 없으면 500).
     예전 테스트는 시크릿 검사 뒤 env 를 지우고 무인증으로 기능 검사를 이어갔다.
     그건 "시크릿 없으면 열린다" 는 옛 동작에 기댄 것이었다. 이제 기능 검사는
     맞는 시크릿을 들고 돈다. 헤더 인자를 주면 그것을, 안 주면 맞는 시크릿을 쓴다. */
  const OK_HDR = { authorization: 'Bearer sekret' };
  const run = async (headers) => { const res = mkRes(); calls = []; await handler({ headers: headers || OK_HDR }, res); return res; };

  process.env.ANTHROPIC_API_KEY = 'test-key-not-used';

  console.log('\n=== CRON_SECRET 보호 ===');
  process.env.CRON_SECRET = 'sekret';
  ok('시크릿 없는 요청 401', (await run({})).code === 401);
  ok('틀린 시크릿 401', (await run({ authorization: 'Bearer wrong' })).code === 401);
  ok('맞는 시크릿 200', (await run({ authorization: 'Bearer sekret' })).code === 200);
  {
    const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
    ok('CRON_SECRET 미설정이면 500 (fail-closed, 2026-09-04)', (await run({})).code === 500);
    process.env.CRON_SECRET = saved;
  }

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
  /* 크론의 에디토리얼 배치는 작다 — 관리자 수동 실행(20)과 다르다.
     조합당 Claude 호출 타임아웃 안에 큰 배치는 못 끝나고, 타임아웃이 나면
     이미 번역된 응답까지 통째로 버려진다(저장 0건). 실측으로 두 번 내렸다:
     20 → 8 (es/fr/ja 가 12시간 동안 0건이던 원인) → 4 (동시 실행 5 에서
     배치 8 이 다시 타임아웃, 같은 실행의 배치 4 는 통과).
     숫자를 고정하지 않고 "관리자 기본값보다 확실히 작다"를 지킨다. */
  ok('크론 에디토리얼 batch 는 호출 타임아웃 안에 끝날 크기',
    calls.every(c => c.batch <= 5 && c.batch >= 1), calls.map(c => c.batch).join(','));
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
    await handler({ headers: OK_HDR }, r);
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

  /* 아티클 배치는 별도 상수라 env 대상이 아니다 — 에디토리얼 호출만 본다.
     (예전엔 calls 전체를 봤는데, 아티클이 섞이면서 깨졌다) */
  const ediBatches = () => calls.filter(c => c.kind === 'editorial').map(c => c.batch);
  process.env.SEO_TRANSLATE_EDITORIAL_BATCH = '5';
  await run();
  ok('에디토리얼 batch 환경변수 반영',
    ediBatches().length > 0 && ediBatches().every(b => b === 5), ediBatches().join(','));
  process.env.SEO_TRANSLATE_EDITORIAL_BATCH = '999';
  await run();
  ok('batch 상한 20 유지',
    ediBatches().length > 0 && ediBatches().every(b => b === 20), ediBatches().join(','));
  delete process.env.SEO_TRANSLATE_EDITORIAL_BATCH;

  /* 2026-08-02 · picked.map(runTask) 사고 재발 방지.
     map 은 콜백에 index 를 두 번째 인자로 넘긴다. runTask 가 2번째 인자를
     batchOverride 로 받게 되면서, 웨이브의 2번째 조합이 배치 1, 3번째가
     배치 2 로 돌았다 — 처리량이 조용히 무너지는 종류의 버그다. */
  await run();
  {
    const ed = calls.filter(c => c.kind === 'editorial').map(c => c.batch);
    ok('같은 종류면 언어와 무관하게 같은 배치를 쓴다',
      ed.length >= 2 && new Set(ed).size === 1, ed.join(','));
  }

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
    /* 2026-08-02 — 2 → 1. 배치 2 아티클은 8시간 실측 성공률 0~5% 였다.
       40s 안에 못 끝나 응답이 통째로 버려지고, 선택 순서가 고정이라 다음
       실행에서 같은 2건을 또 부른다. 배치 1 + 타임아웃 60s 로 바꿨다.
       이제 env(SEO_TRANSLATE_ARTICLE_BATCH)로 조정 가능 — 기본값을 고정한다. */
    ok('아티클 크론 배치는 1', !!art && art.batch === 1);

    /* ── 2026-07-31 · CJK 배치 축소 ──────────────────────────────────
       라이브 로그에서 ja 에디토리얼만 매번 타임아웃이었다(fr·es 는 같은
       배치로 통과). 일본어·중국어는 같은 내용도 출력 토큰이 2~3배다.
       타임아웃이 나면 이미 번역된 응답까지 통째로 버려지므로, 시간을 더
       주는 것보다 배치를 줄이는 쪽이 확실하다. */
    {
      STUB_LANGS.ja = 'Japanese';           // 이 블록에서만 (아래에서 되돌린다)
      process.env.SEO_TRANSLATE_LANGS = 'it,ja';
      await run();
      const jaEdi = calls.find(c => c.lang === 'ja' && c.kind === 'editorial');
      const itEdi = calls.find(c => c.lang === 'it' && c.kind === 'editorial');
      ok('ja 에디토리얼 배치가 라틴 언어보다 작다',
        !!jaEdi && !!itEdi && jaEdi.batch < itEdi.batch,
        `ja=${jaEdi && jaEdi.batch} it=${itEdi && itEdi.batch}`);
      const jaArt = calls.find(c => c.lang === 'ja' && c.kind === 'article');
      ok('ja 아티클도 최소 1건은 보장', !!jaArt && jaArt.batch >= 1);
      delete STUB_LANGS.ja;
      process.env.SEO_TRANSLATE_LANGS = 'it';
    }
    /* 위 검증들은 SEO_TRANSLATE_KINDS 를 명시로 넘기므로 "기본값"은 보호하지
       못한다(역검증에서 실제로 안 잡혔다). 기본값은 소스를 직접 확인한다 —
       기본에서 빠지면 운영에서 아티클이 영영 안 돈다. */
    const cronSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'api/cron/backfill-translations.js'), 'utf8');
    ok('크론 기본 대상에 article 이 포함된다',
      /SEO_TRANSLATE_KINDS \|\| 'editorial,article'/.test(cronSrc));

    /* ── 2026-08-05 — 에디토리얼을 뺐다가 같은 날 전부 되돌렸다 ─────
       뺀 이유: 번역본 클릭 0 (GSC 7/1~8/4).
       되돌린 이유 (두 번에 걸쳐):
         ① 번역 생성 — 사이트 안 언어 전환과 SSR 이 seo_translations 를
            읽어서, 번역이 없으면 비-ko/en 방문자가 /en 으로 302 된다
            (api/seo/editorial/[slug].js). PAP 는 9개 언어 커뮤니티가 목표다.
         ② 색인(noindex) — 그 '클릭 0' 은 판정 근거가 못 됐다. 에디토리얼
            번역의 최초 생성이 07-16 이라 30일 넘은 행이 0건이고, 사이트맵
            5,000행 버그(f74cf1c)로 측정 기간 대부분 색인 후보도 아니었다.
            결정적으로 한국어 **원본** 에디토리얼이 같은 증상을 더 크게
            보인다(/editorial/dark-girl 355노출 0클릭). 번역본만 빼는 건
            원인 진단이 아니다. → 6~8주 재측정 후 다시 판단한다.
       여기서 검증하는 건 두 가지: 번역이 계속 만들어지는가, 그리고
       색인 차단이 되살아나지 않았는가. */
    ok('크론 기본 대상에 editorial 이 다시 들어 있다 (사이트 언어 전환용)',
      /SEO_TRANSLATE_KINDS \|\| 'editorial,article'/.test(cronSrc));
    ok('에디토리얼 번역 noindex 가 되살아나지 않았다',
      !/const noindexTranslatedEditorial\s*=/.test(require('fs').readFileSync(
        require('path').join(__dirname, '..', 'api/_lib/seoRenderer.js'), 'utf8')));
    ok('관리자 수동 엔드포인트는 kind 를 직접 받는다 (에디토리얼 수동 실행 가능)',
      /kind/.test(require('fs').readFileSync(
        require('path').join(__dirname, '..', 'api/admin/backfill-translations.js'), 'utf8')));

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
    /* 2026-08-02 — 예산·호출 타임아웃이 env 로 빠졌다(envMs(이름, 기본, 하한, 상한)).
       숫자 리터럴만 찾던 정규식은 이제 0 을 돌려주고, 그러면 아래 검사 셋이
       "값을 못 읽어서" 실패한다 — 설계가 깨진 게 아닌데 빨간불이 켜진다.
       기본값(두 번째 인자)을 읽도록 고치되, 옛 형태도 계속 받는다. */
    const numOf = (re) => {
      const m = cronSrc.match(re);
      return m ? Number(m[1]) : 0;
    };
    const budget = numOf(/BUDGET_MS = envMs\('[^']*',\s*(\d+)/) ||
                   numOf(/BUDGET_MS = (\d+)/);
    const slack = numOf(/WAVE_SLACK_MS = envMs\('[^']*',\s*(\d+)/) ||
                  numOf(/WAVE_SLACK_MS = (\d+)/);
    const callMs = (cronSrc.match(/CALL_MS = \{([^}]+)\}/) || [])[1] || '';
    /* envMs 형태면 '기본값'만 뽑는다(하한·상한 리터럴을 호출 타임아웃으로
       착각하면 안 된다). 옛 형태면 예전처럼 숫자를 전부 본다. */
    const calls_ = /envMs\(/.test(callMs)
      ? (callMs.match(/envMs\('[^']*',\s*(\d+)/g) || [])
          .map(x => Number(x.match(/,\s*(\d+)$/)[1]))
      : (callMs.match(/(\d+)/g) || []).map(Number);
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

    /* ── 2026-07-31 · 무거운 쪽만 조인다 ────────────────────────────
       아티클 본문은 건당 출력 2,000토큰대다. 에디토리얼(설명 한 줄)과 같은
       동시 실행 수로 던지면 한 웨이브에서만 5만 토큰이 넘어가 분당 한도를
       건드린다. 가벼운 쪽 처리량을 희생하지 않으면서 무거운 쪽만 낮춘다. */
    // CALL_MS 도 같은 모양이라 이름으로 범위를 좁힌다.
    const concBlock = (cronSrc.split('CONCURRENCY_BY_KIND')[1] || '');
    const cKind = (concBlock.match(/\{ editorial: (\d+), article: (\d+) \}/) || []);
    ok('아티클 동시 실행이 에디토리얼보다 적다',
      cKind.length === 3 && Number(cKind[2]) < Number(cKind[1]),
      '동시 실행: ' + cKind.slice(1).join(' / '));

    /* 크론 주기가 최장 실행보다 짧으면 실행이 겹친다. 겹치면 같은 행을
       두 실행이 동시에 집어 같은 번역을 두 번 하거나, 함수 동시 실행 수만
       올라간다. 주기를 올릴 때 이 관계를 잊기 쉬워 숫자로 고정한다. */
    const cron = (vjSrc.crons || []).find(c => /backfill-translations/.test(c.path));
    const every = (cron && /^\*\/(\d+) /.test(cron.schedule))
      ? Number(cron.schedule.match(/^\*\/(\d+) /)[1]) * 60000
      : (cron && /^\d+-\d+\/(\d+) /.test(cron.schedule))
        ? Number(cron.schedule.match(/^\d+-\d+\/(\d+) /)[1]) * 60000 : 0;
    ok('크론 주기가 최장 실행보다 길다 (실행 겹침 방지)',
      every > 0 && every > budget + slack,
      `주기 ${every}ms · 최장 실행 ${budget + slack}ms`);
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
