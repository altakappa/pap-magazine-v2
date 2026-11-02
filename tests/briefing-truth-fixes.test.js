/**
 * 주간 브리핑 거짓 결론 3건의 뿌리 수리 (2026-11-02)
 *   ① trendContext 가 5,000행에서 잘려 "ChatGPT 유입 0명(계측 장애)" 라고 적었다 → 페이지 나눠 끝까지 읽는다
 *   ② 발행 장부가 X 실패 시도까지 '발행' 으로 셌다 → ok=true · magazine 만
 *   ③ X 지출 한도 소진이 10일간 무경보 → 403 spend-cap 이면 개인방 알림(12시간 쿨다운, PAP 계정만)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

// supabase 스텁 — trendContext 가 최상단에서 require 한다
for (const rel of ['api/_lib/supabase.js']) {
  const abs = path.join(ROOT, rel);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: { supabaseAdmin: { from: () => ({}) }, supabase: {} } };
}

(async () => {
  console.log('\n[1] trendContext 는 서버가 잘라도 끝까지 읽는다');
  {
    const { readAll, PAGE, ROW_CAP } = require(path.join(ROOT, 'api', '_lib', 'trendContext.js'));
    const ALL = Array.from({ length: 6500 }, (_, i) => ({ i }));
    const SERVER_MAX = 5000;   // PostgREST 기본 max-rows
    const calls = [];
    const build = () => ({ range: async (a, b) => { calls.push([a, b]); const end = Math.min(b + 1, a + SERVER_MAX); return { data: ALL.slice(a, end), error: null }; } });
    const r = await readAll(build);
    t('6,500행 전부 읽음 (예전엔 5,000에서 끊김)', r.data.length === 6500, r.data.length);
    t('중복·누락 없음', r.data.every((row, k) => row.i === k));
    t('페이지 크기 ≤ 서버 상한', PAGE <= SERVER_MAX && calls.every(([a, b]) => b - a + 1 <= PAGE));
    t('마지막 페이지에서 멈춘다', calls.length === Math.ceil(6500 / PAGE), calls.length);
    const errBuild = () => ({ range: async () => ({ data: null, error: new Error('boom') }) });
    const e = await readAll(errBuild);
    t('에러는 숨기지 않고 돌려준다', e.error && e.error.message === 'boom');
    const big = Array.from({ length: ROW_CAP + 500 }, (_, i) => i);
    const capBuild = () => ({ range: async (a, b) => ({ data: big.slice(a, b + 1), error: null }) });
    const c = await readAll(capBuild);
    t('ROW_CAP 에서 멈춤 (capped 판정 가능)', c.data.length === ROW_CAP, c.data.length);
    const src = R('api/_lib/trendContext.js');
    t('세 조회 모두 readAll + 정렬', (src.match(/readAll\(\(\) => supabaseAdmin/g) || []).length === 3 && (src.match(/\.order\('/g) || []).length >= 3);
    t('.limit(ROW_CAP) 한 방 조회가 남지 않았다', !/\.limit\(ROW_CAP\)/.test(src));
  }

  console.log('\n[2] 발행 장부 X = 성공한 PAP 글만');
  {
    const src = R('api/_lib/publishLedger.js');
    t('ok=true · account=magazine 필터', /countTwoWeeks\('X', 'x_posts', 'created_at', \(q\) => q\.eq\('ok', true\)\.eq\('account', 'magazine'\)\)/.test(src));
  }

  console.log('\n[3] X 지출 한도 감시');
  {
    const W = require(path.join(ROOT, 'api', '_lib', 'xSpendWatch.js'));
    const real = '{"detail":"Your monthly spend cap has been reached.","status":403,"title":"Forbidden","type":"https://api.x.com/2/problems/spend-cap-reached"}';
    t('실제 응답(10/23~11/02)을 한도 소진으로 판정', W.isSpendCap(403, real));
    t('다른 403 은 아니다', !W.isSpendCap(403, '{"detail":"You are not permitted"}'));
    t('429 는 아니다', !W.isSpendCap(429, real));
    const old = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
    const r1 = await W.reportXFailure({ status: 403, detail: real, account: 'pepperit' });
    t('페퍼릿은 알리지 않는다', r1.spendCap === true && r1.alerted === false);
    const r2 = await W.reportXFailure({ status: 403, detail: real, account: 'magazine' });
    t('env 없으면 조용히 넘어간다 (throw 없음)', r2.alerted === false);
    if (old !== undefined) process.env.SUPABASE_URL = old;
    t('쿨다운 12시간', W.COOLDOWN_H === 12);
    const ws = R('api/_lib/xSpendWatch.js');
    t('개인방으로만 (personalOnly)', /personalOnly: true/.test(ws));
    t('supabase 는 늦게 불러온다', !/^const .*require\('\.\/supabase'\)/m.test(ws));
    const xp = R('api/_lib/xPost.js');
    t('postTweet 실패 갈래에 연결', /if \(!r\.ok\) \{[\s\S]{0,400}require\('\.\/xSpendWatch'\)\.reportXFailure\(\{ status: r\.status, detail, account: base\.account \}\)/.test(xp));
    t('감시 실패가 게시 경로를 안 죽인다 (try/catch)', /try \{ await require\('\.\/xSpendWatch'\)/.test(xp));
  }

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ briefing-truth-fixes tests FAILED'); process.exit(1); }
  console.log('✅ briefing-truth-fixes tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
