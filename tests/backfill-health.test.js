/**
 * 서술문 백필 건강도 감시 회귀 (2026-07-30 신설).
 *
 * 왜 필요했나 — 두 달간 조용히 새고 있었다:
 *   backfill-meta-desc 는 개별 항목 실패를 catch 로 삼키고 크론 전체는 ok=true 로
 *   기록한다. 이미지 URL 형태 문제(드라이브 리다이렉트 링크)로 성공률이 20% 까지
 *   떨어졌는데 아무 알림이 없었고, 사람이 우연히 커버리지를 들여다볼 때까지 몰랐다.
 *   → "크론이 돌았는가" 가 아니라 "실제로 텍스트가 생산되는가" 를 봐야 한다.
 *
 * 여기서 지키는 것: 알림이 울려야 할 때 울리고, 울리면 안 될 때(표본 부족·완주)
 * 침묵한다. 오탐은 알림 신뢰를 깎아 결국 아무도 안 보게 만든다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { diagnoseBackfill, buildBackfillAlert } = require('../api/_lib/backfillHealth');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const HOUR = 3600000;
const ok = (o) => diagnoseBackfill(Object.assign({ lastAttemptAgoMs: 5 * 60000 }, o));

console.log('\n=== 이상 감지 ===');
(function () {
  // 2026-07-30 실제 상황 재현: 시도 88건 중 22건만 성공(25%)
  const d = ok({ attempts: 88, successes: 22, remaining: 1526 });
  t('성공률 저하를 잡는다 (실제 사고값 25%)', d.healthy === false && d.kind === 'low_rate');
  t('성공률을 소수 1자리로 보고', d.rate === 25);
})();
(function () {
  const d = diagnoseBackfill({ attempts: 0, successes: 0, remaining: 1500, lastAttemptAgoMs: 5 * HOUR });
  t('시도 자체가 끊기면 정지로 잡는다', d.healthy === false && d.kind === 'stalled');
  t('정지 사유에 경과 시간 명시', /시간째 시도 없음/.test(d.reason));
})();
(function () {
  const d = diagnoseBackfill({ attempts: 30, successes: 30, remaining: 1500, lastAttemptAgoMs: null });
  t('시도 기록이 아예 없어도 정지로 잡는다', d.healthy === false && d.kind === 'stalled');
})();

console.log('=== 오탐 방지 ===');
(function () {
  // 백필이 끝났으면 알림이 오면 안 된다 — 완주 후 매 30분 알림은 재앙이다
  const d = diagnoseBackfill({ attempts: 0, successes: 0, remaining: 0, lastAttemptAgoMs: 99 * HOUR });
  t('남은 작업 0이면 항상 정상', d.healthy === true && d.reason === 'done');
})();
(function () {
  // 표본 3건 중 1건 실패로 알림이 오면 신뢰를 잃는다
  const d = ok({ attempts: 3, successes: 1, remaining: 800 });
  t('표본이 적으면 판정 보류', d.healthy === true && /sample</.test(d.reason));
})();
(function () {
  const d = ok({ attempts: 20, successes: 14, remaining: 900 });
  t('70% 는 정상 (정상 가동 범위)', d.healthy === true && d.rate === 70);
  const d2 = ok({ attempts: 20, successes: 10, remaining: 900 });
  t('정확히 기준선(50%)은 정상', d2.healthy === true, 'rate=' + d2.rate);
  const d3 = ok({ attempts: 20, successes: 9, remaining: 900 });
  t('기준선 미만(45%)은 이상', d3.healthy === false);
})();
(function () {
  // 수정 직후 실측: 7시도 7성공 → 표본은 적지만 정상으로 읽혀야 한다
  const d = ok({ attempts: 7, successes: 7, remaining: 1526 });
  t('수정 직후 100% 소표본도 정상', d.healthy === true);
})();

console.log('=== 알림 문안 ===');
(function () {
  const a = buildBackfillAlert(ok({ attempts: 88, successes: 22, remaining: 1526 }));
  t('제목에 성공률 노출', /25%/.test(a.title));
  t('원인 후보를 함께 적는다', a.lines.some(l => /크레딧/.test(l)) && a.lines.some(l => /이미지 URL/.test(l)),
    '알림만 받고 어디를 볼지 모르면 무용지물이다');
  const b = buildBackfillAlert(diagnoseBackfill({ attempts: 0, successes: 0, remaining: 1500, lastAttemptAgoMs: 9 * HOUR }));
  t('정지 알림은 확인 위치를 알려준다', /cron_runs|CRON_SECRET/.test(b.lines.join(' ')));
})();

console.log('=== 크론 결선 ===');
(function () {
  const w = R('api/cron/pipeline-watch.js');
  t('pipeline-watch 가 백필 감시를 호출', /checkBackfill\(/.test(w) && /diagnoseBackfill/.test(w));
  t('알림 키를 IG 파이프라인과 분리', /BACKFILL_ALERT_KEY\s*=\s*'editorial-backfill-health'/.test(w),
    '한쪽 쿨다운이 다른 쪽 알림을 삼키면 안 된다');
  t('복구 알림은 쿨다운을 무시', /쿨다운 무시|쿨다운을 무시/.test(w));
  t('감시 실패가 본 크론을 죽이지 않는다', /backfill health 실패/.test(w) && /catch \(e\)/.test(w));
  t('dry 진단 모드 지원', /opts && opts\.dry/.test(w));
  t('집계는 RPC 로 (전체 행 스캔 회피)', /rpc\('backfill_health_stats'/.test(w));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ backfill-health tests FAILED'); process.exit(1); }
console.log('✅ backfill-health tests passed');
