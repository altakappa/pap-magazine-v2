/**
 * CJK 완료 문턱 + 실패 가시화 (2026-08-08 신설).
 *
 * ── 실제 사고 ①: ja 가 한 건에 944건이 막혀 있었다 ──────────────────
 * cron_runs note, 08-08 00:45~01:06 KST, 10회 연속 똑같았다:
 *
 *     ja/art:1/남944/긴글4 · de/art:1/남304/긴글4 · ru/art:0/남706/긴글4
 *
 * de 는 남304 → 313 → … 매 실행 1씩 준다. **ja 는 1건씩 처리하는데 남944 가
 * 한 번도 안 움직인다.** DB 를 보니 매 실행 같은 행 하나를 다시 쓰고 있었다:
 *
 *     article 5520e65c…(원문 155자) → ja 본문 80자, updated_at 이 2분마다 갱신
 *     같은 기사의 다른 언어: de 168 · es 180 · fr 170 · it 177 · ru 153
 *
 * MIN_TRANSLATED.body = 100 이라 80자는 '완료'로 안 센다. 큐는
 * published_date DESC 고정이라 다음 실행에서 또 맨 앞에 온다 — poison pill.
 *
 * 원인은 번역 품질이 아니라 **글자 수 세는 법**이다. 같은 내용을 한자·가나로
 * 쓰면 알파벳의 절반도 안 된다. 실측 평균 본문 길이:
 *     de 1,435 · fr 1,418 · es 1,393 · it 1,386 · ru 1,277 | ja 625 · zh 414
 *
 * ── 실제 사고 ②: 실패가 note 에 안 보였다 ───────────────────────────
 * ru 는 7시간째 처리 0인데 note 에 ERR 이 없었다. 크론이 보던 건 `r.error`
 * 하나뿐인데 그건 runTask 가 **예외를 던졌을 때만** 채워진다. 정작 흔한
 * 실패(배치 호출 실패·저장 실패·불량 제외)는 응답의 `errors[]` 와
 * `skipped_failed` 에 조용히 담겨 화면에 안 나왔다.
 *
 * 그래서 08-07 에 나는 원인을 **틀리게** 짚었다 — "검증이 막고 있다" 고
 * 추정해 `/재시도N` 을 붙였는데, 배포 후 6회 실행에서 재시도는 0이었다.
 * 계측 구멍이 있으면 추측하게 된다. 이 테스트는 그 구멍을 막아 둔다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① ja·zh 아티클 본문 문턱은 40, 나머지 언어는 100
 *   ② 에디토리얼 description 문턱은 **아무 언어도 안 낮춘다** (일부러)
 *   ③ 문턱은 한 곳에서만 정한다 — RPC 경로·폴백 경로가 같은 값을 쓸 것
 *   ④ 크론 note 가 errors[] 와 skipped_failed 를 보여줄 것
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const CRON = path.join(ROOT, 'api', 'cron', 'backfill-translations.js');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* supabase 스텁 — rpc 인자를 기록한다. */
const calls = [];
let nextResult = { data: [{ remaining: 0 }], error: null };
const m = new Module(SUPABASE, null);
m.filename = SUPABASE; m.loaded = true;
m.exports = {
  supabaseAdmin: {
    from() { throw new Error('from() 을 부르면 안 된다'); },
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve(nextResult); },
  },
};
require.cache[SUPABASE] = m;

const { minDoneFor, remainingFor, MIN_TRANSLATED } = require(HELPER);

(async () => {
  console.log('\n=== ① 아티클 본문 문턱 ===');
  t('ja 는 40 (실측 평균 625자 · 라틴의 0.44배)', minDoneFor('body', 'ja') === 40, minDoneFor('body', 'ja'));
  t('zh 는 40 (실측 평균 414자)', minDoneFor('body', 'zh') === 40, minDoneFor('body', 'zh'));
  t('de 는 그대로 100', minDoneFor('body', 'de') === 100);
  t('ru 는 그대로 100 (키릴은 안 짧다 — 실측 1,277자)', minDoneFor('body', 'ru') === 100);
  for (const l of ['en', 'it', 'fr', 'es']) {
    t(l + ' 는 그대로 100', minDoneFor('body', l) === 100);
  }

  /* 막고 있던 실제 행. 이 값들이 통과/차단되는지가 이 수정의 전부다. */
  console.log('\n=== ① 실제로 막고 있던 행 (5520e65c, 원문 155자) ===');
  t('ja 본문 80자가 이제 완료로 인정된다', 80 >= minDoneFor('body', 'ja'));
  t('예전 문턱 100 에서는 인정되지 않았다 (사고 재현)', !(80 >= 100));
  t('같은 기사 de 168자는 전에도 지금도 완료', 168 >= minDoneFor('body', 'de'));

  console.log('\n=== ② 에디토리얼 description 은 손대지 않는다 ===');
  /* ja 에디토리얼에는 16~39자 행이 178건 있다. 여기까지 낮추면 그게 통째로
     '완료' 가 된다 — 정상인지 잘린 것인지 안 재봤으므로 건드리지 않는다. */
  for (const l of ['ja', 'zh', 'de', 'ru', 'it']) {
    t(l + ' description 은 40 그대로', minDoneFor('description', l) === 40, minDoneFor('description', l));
  }
  t('기준값 자체는 안 바뀌었다', MIN_TRANSLATED.body === 100 && MIN_TRANSLATED.description === 40);
  t('모르는 필드는 40 으로 떨어진다', minDoneFor('nope', 'ja') === 40);

  console.log('\n=== ③ 문턱이 한 곳에서만 정해진다 ===');
  calls.length = 0;
  await remainingFor('article', 'ja');
  t('잔량 조회가 ja 에 40 을 넘긴다', calls[0] && calls[0].args.p_min_done === 40, calls[0] && calls[0].args);
  calls.length = 0;
  await remainingFor('article', 'de');
  t('잔량 조회가 de 에 100 을 넘긴다', calls[0] && calls[0].args.p_min_done === 100, calls[0] && calls[0].args);
  calls.length = 0;
  await remainingFor('editorial', 'ja');
  t('에디토리얼 ja 는 40 (안 낮췄다)', calls[0] && calls[0].args.p_min_done === 40, calls[0] && calls[0].args);

  const helper = fs.readFileSync(HELPER, 'utf8');
  t('큐 RPC 경로도 minDoneFor 를 쓴다',
    /const minDone = minDoneFor\(cfg\.doneField, lang\)/.test(helper));
  t('폴백 경로도 minDoneFor 를 쓴다',
    /const minLen = minDoneFor\(doneCol, lang\)/.test(helper));
  t('MIN_TRANSLATED 를 직접 읽는 곳이 minDoneFor 안에만 남았다',
    (helper.match(/MIN_TRANSLATED\[/g) || []).length === 1,
    (helper.match(/MIN_TRANSLATED\[/g) || []).length);

  /* ── ④ 실패가 note 에 보인다 ── */
  console.log('\n=== ④ 크론 note 가 조용한 실패를 보여준다 ===');
  const cron = fs.readFileSync(CRON, 'utf8');
  t('skipped_failed 를 집계한다', /cur\.failed \+= r\.skipped_failed \|\| 0/.test(cron));
  t('note 에 /불량N 으로 남긴다', /'\/불량' \+ v\.failed/.test(cron));
  t('0 이면 안 붙인다', /v\.failed \? '\/불량'/.test(cron));
  t('errors\\[\\] 의 첫 건도 ERR 로 올린다',
    /Array\.isArray\(r\.errors\) && r\.errors\.length/.test(cron));
  t('예외(r.error)가 있으면 그쪽이 우선이다',
    cron.indexOf('if (r.error && !cur.err)') < cron.indexOf('Array.isArray(r.errors)'));
  t('perCombo 씨앗에 failed 가 있다', /failed: 0[,}]/.test(cron));

  /* runOnQueue 가 실제로 그 두 값을 응답에 담고 있어야 위 배선이 의미가 있다. */
  t('헬퍼가 errors 를 응답에 담는다', /errors: errors\.length \? errors : undefined/.test(helper));
  t('헬퍼가 skipped_failed 를 응답에 담는다',
    /skipped_failed: failedIds\.size \|\| undefined/.test(helper));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) process.exit(1);
  console.log('✓ translate-cjk-done-threshold tests passed');
})();
