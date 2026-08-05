/**
 * 번역 백필 — 구간별 소요시간 계측 (2026-08-05 2차, 신설).
 *
 * 왜 필요했나 — 오늘 오전의 실패:
 *   "호출마다 8.5MB 를 옮긴다" 는 실측을 근거로 큐 선별을 RPC 로 내렸다.
 *   전송은 실제로 사라졌다(RPC mean 72~156ms, pg_stat_statements 확인).
 *   그런데 결과는 **시간당 저장 61 → 43건, 평균 실행 69 → 80초.** 나빠졌다.
 *
 *   원인은 진단 방법이었다. 80초가 *어디에* 쓰이는지 한 번도 재보지 않고
 *   눈에 띄는 큰 숫자(8.5MB)를 원인이라고 결론냈다. 이 크론의 코드 주석은
 *   같은 방식의 튜닝이 반복된 기록이다 — 7/30 예산 105→75s, 7/31 75→85s,
 *   8/2 85→100s, 8/2 배치 2→1 … 전부 '재보고 고친' 게 아니라 '고쳐보고 봤다'.
 *
 * 그래서 이 커밋은 기능이 아니라 **계측**이다. 이 테스트가 지키는 것:
 *   ① 큐조회 / AI호출 / 저장을 각각 잰다 (합쳐 놓으면 아무것도 못 본다)
 *   ② 계측이 note 에 **반드시 남는다** — cronGuard 가 note 를 500자로 자르므로
 *      조합이 많은 실행에서 계측만 잘려나가면 정작 보려던 값이 사라진다
 *   ③ 계측은 공짜다 — 실패해도 본 작업을 막지 않고, 없어도 크론이 죽지 않는다
 *   ④ 응답 JSON 에도 같은 값이 실린다 (관리자 수동 호출로도 볼 수 있게)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const CRON = path.join(ROOT, 'api', 'cron', 'backfill-translations.js');
const GUARD = path.join(ROOT, 'api', '_lib', 'cronGuard.js');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

/* ── DB 스텁 ── RPC 는 의도적으로 느리게(30ms), 저장도 느리게(10ms) 만들어
   구간이 실제로 따로 잡히는지 본다. */
const db = { upserts: [] };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
inject(SUPABASE, {
  supabaseAdmin: {
    async rpc(name) {
      await sleep(30);
      if (name === 'seo_translate_counts') return { data: [{ remaining: 5, no_source: 0 }], error: null };
      return {
        data: [{ id: 'a1', title: 'T', title_en: 'T', src: 'x'.repeat(300), extra: null, src_len: 300 }],
        error: null,
      };
    },
    from() {
      const q = {
        select: () => q, eq: () => q, order: () => q,
        limit: () => Promise.resolve({ data: [], error: null }),
        upsert: async (row) => { await sleep(10); db.upserts.push(row); return { error: null }; },
      };
      return q;
    },
  },
});

const helper = require(HELPER);

/* Claude 스텁 — 40ms 걸리게 해서 AI 구간이 분리되는지 확인 */
global.fetch = async (_u, opt) => {
  await sleep(40);
  const prompt = JSON.parse(opt.body).messages[0].content;
  const src = JSON.parse(prompt.slice(prompt.indexOf('Input JSON:') + 'Input JSON:'.length));
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(src.map(s => ({ i: s.i, title: 'T', body: 'B' }))) }],
      stop_reason: 'end_turn',
    }),
  };
};
process.env.ANTHROPIC_API_KEY = 'test-key';

async function run() {
  console.log('\n=== ① 세 구간을 따로 잰다 ===');
  const r = await helper.runBackfillBatch({ lang: 'de', kind: 'article', batch: 1 });
  const T = r.timing;
  t('timing 이 반환된다', !!T, r);
  t('큐조회 시간이 잡힌다 (>=25ms)', T.queueMs >= 25, T);
  t('AI 호출 시간이 잡힌다 (>=35ms)', T.callMs >= 35, T);
  t('저장 시간이 잡힌다 (>=8ms)', T.saveMs >= 8, T);
  t('세 구간이 서로 섞이지 않는다 (각각 100ms 미만)',
    T.queueMs < 100 && T.callMs < 100 && T.saveMs < 100, T);
  t('호출·저장 횟수를 센다', T.calls === 1 && T.saves === 1, T);

  console.log('\n=== ③ 계측이 없어도 죽지 않는다 ===');
  const direct = helper.newTiming();
  t('newTiming 이 0으로 시작', direct.queueMs === 0 && direct.callMs === 0 && direct.saveMs === 0);

  console.log('\n=== ②·④ 크론이 note 와 응답에 싣는가 (소스 대조) ===');
  const cronSrc = fs.readFileSync(CRON, 'utf8');
  t('웨이브 결과에서 timing 을 합산한다', /T\.queueMs \+= t\.queueMs/.test(cronSrc));
  t('note 에 큐/AI/저장을 남긴다',
    /⏱큐/.test(cronSrc) && /AI/.test(cronSrc) && /저장/.test(cronSrc));
  t('웨이브 수와 남은 예산도 남긴다', /웨/.test(cronSrc) && /lastLeftMs/.test(cronSrc));
  t('응답 JSON 에도 timing 을 싣는다', /timing: \{ queueMs: T\.queueMs/.test(cronSrc));

  console.log('\n=== ② 500자로 잘려도 계측은 살아남는다 ===');
  const guardSrc = fs.readFileSync(GUARD, 'utf8');
  const cap = (guardSrc.match(/note \? String\(note\)\.slice\(0, (\d+)\)/) || [])[1];
  t('cronGuard 의 note 상한을 실제로 읽었다 (500)', cap === '500', cap);
  t('조합 문자열을 먼저 자르고 계측을 뒤에 붙인다',
    /comboNote\.slice\(0, 500 - timingNote\.length - 3\)/.test(cronSrc));
  // 상한이 바뀌면 이 테스트가 먼저 깨져야 한다 — 두 파일이 같은 숫자를 쓴다.
  t('크론이 쓰는 상한과 cronGuard 의 상한이 같다',
    new RegExp('slice\\(0, ' + cap + ' - timingNote').test(cronSrc), cap);

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) process.exit(1);
  console.log('✓ translate-timing-note tests passed');
}

run().catch(e => { console.error(e); process.exit(1); });
