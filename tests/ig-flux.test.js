/**
 * IG 이탈 계측 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "이탈자가 매일 100-200명인데 이탈하지 않게 하는 방법이 있을까?"
 *
 * [먼저 정직하게] API 는 누가 떠났는지·어느 게시물 때문인지 안 준다.
 * 코드가 할 수 있는 건 이탈 = gains(follower_count) − net(스냅샷)을 재고,
 * 급증한 날 그 직전에 올린 것을 나란히 보여주는 것까지다.
 * [계기의 필요] 스냅샷 마이너스 구간 합(이탈 하한)은 하루 1~47 — 도메니코가
 * 앱에서 보는 100~200 과 한참 다르다. 시간 안에서 유입·이탈이 상쇄되면
 * 스냅샷은 못 본다. 즉 지금 우리는 이탈을 못 재고 있었다.
 *
 * 지키는 것:
 *   1. API 응답 파싱 (end_time → 날짜, 빈 응답 안전)
 *   2. 이탈 산수 — 모르는 날은 null (0 이라고 지어내지 않는다)
 *   3. gains < net 이면 음수 이탈 대신 0 + 플래그 (측정 오차 정직 처리)
 *   4. 급증 판정 — 소표본이면 판정하지 않는다
 *   5. 크론 배선 — 하루 1회 가드, 실패해도 스냅샷 본체 유지
 *   6. 장부 렌더에 이탈 열이 붙는다 (flux 없으면 기존 표 그대로)
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }

const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './supabase') return { supabaseAdmin: {} };
  return orig.apply(this, arguments);
};
const { parseFollowerCountSeries, computeUnfollows, isSpike } = require(path.join(ROOT, 'api/_lib/igFlux.js'));
const { computeLedger, renderIgLedgerMd } = require(path.join(ROOT, 'api/_lib/igLedger.js'));
Module.prototype.require = orig;

console.log('\n=== 1. API 응답 파싱 ===');
{
  const json = { data: [{ name: 'follower_count', period: 'day', values: [
    { value: 320, end_time: '2026-08-21T07:00:00+0000' },
    { value: 280, end_time: '2026-08-22T07:00:00+0000' },
    { value: null, end_time: '2026-08-23T07:00:00+0000' },
  ] }] };
  const s = parseFollowerCountSeries(json);
  t('값 있는 날만 나온다 (null 제외)', s.length === 2, JSON.stringify(s));
  t('end_time(그날의 끝) → 그 전날 날짜', s[0].day === '2026-08-20' && s[1].day === '2026-08-21', JSON.stringify(s));
  t('빈 응답 → 빈 배열', parseFollowerCountSeries({}).length === 0 && parseFollowerCountSeries(null).length === 0);
  t('다른 지표가 섞여도 follower_count 만 집는다',
    parseFollowerCountSeries({ data: [{ name: 'reach', values: [{ value: 9, end_time: '2026-08-21T07:00:00+0000' }] }] }).length === 0);
}

console.log('\n=== 2. 이탈 산수 — 모르는 날은 모른다고 한다 ===');
{
  const days = [
    { day: '2026-08-20', delta: 111, carousels: 8, videos: 3, images: 0, attributed: 21, residual: 90 },
    { day: '2026-08-21', delta: 111, carousels: 9, videos: 4, images: 0, attributed: 37, residual: 74 },
  ];
  const flux = [{ day: '2026-08-20', gains: 260 }];
  const out = computeUnfollows(flux, days);
  t('gains 있는 날: 이탈 = 260-111 = 149', out[0].unfollows === 149, String(out[0].unfollows));
  t('gains 없는 날: 이탈 null (0 이라고 지어내지 않는다)', out[1].unfollows === null && out[1].gains === null);
  t('원래 장부 열이 보존된다', out[0].carousels === 8 && out[0].residual === 90);
}

console.log('\n=== 3. 측정 오차 정직 처리 ===');
{
  const out = computeUnfollows([{ day: 'd', gains: 50 }], [{ day: 'd', delta: 80 }]);
  t('gains < net (이론상 불가): 음수 대신 0', out[0].unfollows === 0);
  t('플래그로 표시한다 (조용히 넘기지 않는다)', out[0].fluxAnomaly === true);
}

console.log('\n=== 4. 급증 판정 ===');
{
  t('과거 7일뿐이면 판정 안 함', isSpike([100, 110, 120, 100, 90, 105, 115], 400, 2) === null);
  const hist = [100, 110, 120, 100, 90, 105, 115, 108];   // P50≈105, IQR 작음
  const v = isSpike(hist, 400, 2);
  t('평소 100 안팎에서 400 → spike', v && v.spike === true, JSON.stringify(v));
  const calm = isSpike(hist, 112, 2);
  t('평소 범위 112 → 조용', calm && calm.spike === false, JSON.stringify(calm));
  t('IQR 0 (전부 같은 값)이어도 0 나눗셈 없이 동작', (() => {
    const flat = isSpike([100, 100, 100, 100, 100, 100, 100, 100], 103, 2);
    return flat && typeof flat.threshold === 'number';
  })());
}

console.log('\n=== 5. 크론 배선 ===');
{
  const cron = fs.readFileSync(path.join(ROOT, 'api/cron/ig-snapshot.js'), 'utf8');
  t('flux 를 부른다', /captureFlux/.test(cron));
  t('하루 1회 가드가 있다', /fluxCapturedToday/.test(cron));
  t('실패해도 스냅샷 본체를 막지 않는다 (try/catch + 비치명 로그)',
    /flux 실패\(비치명\)/.test(cron));
  t('경보에 "누가·왜는 API 가 안 준다"를 명시한다', /API 가 안 준다/.test(cron));
  t('경보는 spike 일 때만 나간다', /verdict && verdict\.spike/.test(cron));
  const flux = fs.readFileSync(path.join(ROOT, 'api/_lib/igFlux.js'), 'utf8');
  t('표 없음(42P01)은 조용히 no_table (크론 안 붉어짐)', /42P01/.test(flux));
  t('미지원 응답을 로그로 남긴다 (조용한 사각지대 금지)', /미지원\/실패/.test(flux));
}

console.log('\n=== 6. 장부 렌더에 이탈 열 ===');
{
  const followers = Array.from({ length: 10 }, (_, i) => ({ day: '2026-08-' + String(i + 1).padStart(2, '0'), followers: 1000 + i * 100 }));
  const ledger = computeLedger(followers, []);
  ledger.days = computeUnfollows(
    ledger.days.map((d) => ({ day: d.day, gains: d.delta + 150 })), ledger.days);
  ledger.summary.totalUnfollows = 150 * ledger.days.length;
  ledger.summary.unfollowDays = ledger.days.length;
  ledger.summary.totalGains = ledger.days.reduce((s, d) => s + d.gains, 0);
  const md = renderIgLedgerMd(ledger);
  t('flux 있으면 신규·이탈 열이 붙는다', /신규 \| 이탈 \| 순증/.test(md), md.split('\n')[2]);
  t('합계 줄에 이탈이 실린다', /이탈\(9일 측정\)/.test(md) && /하루 평균 이탈 150/.test(md));
  const mdNo = renderIgLedgerMd(computeLedger(followers, []));
  t('flux 없으면 기존 표 그대로 (— 로 도배하지 않는다)', /날짜\(KST\) \| 증가 \|/.test(mdNo));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-flux tests FAILED'); process.exit(1); }
console.log('✅ ig-flux tests passed');
