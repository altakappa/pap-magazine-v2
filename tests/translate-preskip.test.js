/**
 * 끝난 조합 사전 걸러내기 (2026-08-08 신설).
 *
 * ── 실제 사고 ────────────────────────────────────────────────────────
 * 08-08 00:07~00:13, 크론 note 가 4회 연속 똑같았다:
 *
 *   ru/art:0/남706 · zh/art:1/남1478 · it/art:0/남0 · skip(time-budget)
 *   · ⏱큐1.6/AI82.8/저장0.2s·콜3·웨1·남19.5s·컷없음
 *
 * `it/art` 는 **이미 완주한 조합(남0)** 인데 매 실행 3자리 중 하나를 먹었다.
 * 동시 실행이 3이라 자리가 셋뿐인데, 그중 하나가 늘 헛자리였던 것이다.
 * 그 결과 ja(잔여 944) · de(536) 는 차례를 못 받았고,
 * 3시간 90회 실행에 저장 82건 — 실행당 1건이 안 됐다.
 * 실제로 최근 3시간 저장 75건 중 67건이 de 하나였다(회전이 우연히 닿은 회차).
 *
 * ── 왜 기존 방어가 안 먹었나 ────────────────────────────────────────
 * 크론에는 이미 `finished` Set 이 있다. 그런데 채우는 조건이
 *     if (r.remaining === 0) finished.add(key(task))
 * 라서 **한 번 호출해 봐야** 끝난 걸 안다. 게다가 실행이 끝나면 그 기억도
 * 사라져 다음 실행이 또 같은 자리를 태운다. 즉 실행 내 중복만 막고
 * 실행 간 낭비는 못 막는 설계였다.
 *
 * ── 고친 방법 ───────────────────────────────────────────────────────
 * 웨이브를 돌기 전에 counts RPC 만 따로 부른다(큐 조회는 안 한다).
 * 잔량 0 인 조합은 링에서 빼고, 그 수를 note 에 `·완주N` 으로 남긴다.
 * 실측 66.9ms/콜 · 전 조합 병렬 → 100초 예산의 1% 미만.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 잔량 0 조합만 빠질 것 (0 이 아니거나 모르면 살려 둘 것)
 *   ② 조회 실패는 fail-open — 이 최적화 때문에 일이 사라지지 않을 것
 *   ③ 임계값을 크론이 다시 적지 않을 것 (단일 출처)
 *   ④ 큐 조회(무거움)는 하지 않고 개수만 셀 것
 *   ⑤ 크론이 웨이브 전에 부르고, 결과를 note 에 남길 것
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

/* supabase 스텁 — rpc 호출을 기록하고 원하는 값을 돌려준다. */
const calls = [];
let nextResult = { data: [{ remaining: 0, no_source: 0, too_long: 0 }], error: null };
const m = new Module(SUPABASE, null);
m.filename = SUPABASE; m.loaded = true;
m.exports = {
  supabaseAdmin: {
    from() { throw new Error('from() 을 부르면 안 된다 — 개수만 세야 한다'); },
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve(nextResult); },
  },
};
require.cache[SUPABASE] = m;

const { remainingFor } = require(HELPER);

(async () => {
  console.log('\n=== ①④ 개수만 센다 ===');
  calls.length = 0;
  nextResult = { data: [{ remaining: 0 }], error: null };
  const zero = await remainingFor('article', 'it', { since: null, maxSrcChars: 6000 });
  t('잔량 0 을 0 으로 돌려준다', zero === 0);
  t('counts RPC 하나만 부른다', calls.length === 1, calls.map(c => c.name));
  t('부른 것이 seo_translate_counts 다', calls[0] && calls[0].name === 'seo_translate_counts');
  t('큐 RPC 는 부르지 않는다 (무거운 조회 회피)',
    !calls.some(c => /queue/.test(c.name)), calls.map(c => c.name));

  console.log('\n=== ③ 임계값이 단일 출처다 ===');
  const a = calls[0].args;
  t('아티클 min_done 은 100 (MIN_TRANSLATED.body)', a.p_min_done === 100, a);
  t('아티클 min_src 는 80 (MIN_SOURCE.article)', a.p_min_src === 80, a);
  t('maxSrcChars 를 그대로 넘긴다', a.p_max_src === 6000, a);
  t('since 를 그대로 넘긴다 (null 이면 제한 없음)', a.p_since === null, a);

  calls.length = 0;
  nextResult = { data: [{ remaining: 5 }], error: null };
  await remainingFor('editorial', 'ja', { since: '2026-05-10' });
  const e = calls[0].args;
  t('에디토리얼 min_done 은 40 (MIN_TRANSLATED.description)', e.p_min_done === 40, e);
  t('에디토리얼 min_src 는 30 (MIN_SOURCE.editorial)', e.p_min_src === 30, e);
  t('kind 를 그대로 넘긴다', e.p_kind === 'editorial' && e.p_lang === 'ja', e);
  t('since 문자열도 그대로 넘어간다', e.p_since === '2026-05-10', e);

  console.log('\n=== ① 잔량이 있으면 살린다 ===');
  nextResult = { data: [{ remaining: 706 }], error: null };
  t('706 을 그대로 돌려준다', (await remainingFor('article', 'ru')) === 706);
  nextResult = { data: [{ remaining: 1 }], error: null };
  t('1 건이라도 있으면 0 이 아니다', (await remainingFor('article', 'zh')) === 1);

  console.log('\n=== ② 실패는 fail-open (null) ===');
  nextResult = { data: null, error: { message: 'function does not exist' } };
  t('RPC 오류면 null — 조합을 살려 둔다', (await remainingFor('article', 'de')) === null);
  nextResult = { data: [], error: null };
  t('빈 응답도 0 으로 떨어진다(안전)', (await remainingFor('article', 'de')) === 0);
  t('모르는 kind 는 null', (await remainingFor('nope', 'de')) === null);

  /* ── ⑤ 크론이 실제로 물고 있는가 ── */
  console.log('\n=== ⑤ 크론 배선 ===');
  const cron = fs.readFileSync(CRON, 'utf8');
  t('remainingFor 를 import 한다', /require\('\.\.\/_lib\/seoTranslateBackfill'\)/.test(cron)
    && /\bremainingFor\b/.test(cron));
  t('전 조합을 병렬로 물어본다',
    /await Promise\.all\(\s*ordered\.map\(t => remainingFor\(/.test(cron), cron.slice(0, 0));
  t('잔량 0 인 조합만 finished 에 넣는다',
    /if \(counts\[i\] === 0\) \{ finished\.add\(key\(t\)\); preskipped\+\+; \}/.test(cron));
  t('조회 실패(null)는 걸러내지 않는다 — === 0 비교라 null 은 통과',
    /counts\[i\] === 0/.test(cron) && !/counts\[i\] == 0/.test(cron));
  t('개별 실패도 삼킨다 (.catch → null)', /\.catch\(\(\) => null\)/.test(cron));
  t('웨이브 루프보다 먼저 돈다',
    cron.indexOf('remainingFor(') < cron.indexOf('for (let wave = 0'));
  t('사전 조회 시간을 큐 계측에 넣는다', /T\.queueMs \+= Date\.now\(\) - t0/.test(cron));
  t('note 에 완주 조합 수를 남긴다', /'·완주' \+ preskipped/.test(cron));
  t('preskipped 가 0 이면 note 에 안 붙인다', /preskipped \? '·완주'/.test(cron));

  /* 기존 실행-내 finished 는 그대로 살아 있어야 한다 (두 겹 방어). */
  t('실행 내 finished 도 유지된다',
    /if \(r\.remaining === 0\) finished\.add\(key\(task\)\)/.test(cron));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) process.exit(1);
  console.log('✓ translate-preskip tests passed');
})();
