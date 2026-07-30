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

/* ────────────────────────────────────────────────────────────────
 * 2026-07-30 2차: 감시가 실제보다 좋게 말하던 문제.
 *
 * 구 successes 정의는 "이 창에서 시도됐고 지금 설명이 있음" 이었다. 직접 세는
 * 수단이 없었기 때문인데(백필은 updated_at 을 갱신하지 않는다), 그 결과
 * 24시간 창에서 699건 성공이라 말하면서 실제 커버리지는 +102 만 늘었다.
 * → description_filled_at 도장을 두고 filled 로 판정한다. 아래는 그 계약이다. */
console.log('=== 실제 생산량(filled) 기준 판정 ===');
(function () {
  // 도장이 있으면 filled/attemptsSinceStamp 로 판정 — successes 가 부풀어 있어도 속지 않는다
  const d = ok({ attempts: 877, successes: 699, filled: 12, attemptsSinceStamp: 120, everFilled: true, remaining: 1413 });
  t('successes 가 부풀어도 filled 로 판정한다', d.basis === 'filled' && d.rate === 10 && d.healthy === false,
    'basis=' + d.basis + ' rate=' + d.rate);
  t('구 지표도 결과에 남겨 비교 가능', d.successes === 699 && d.filled === 12);
})();
(function () {
  // 시도는 하는데 생산 0 — '저하' 가 아니라 '정지' 로 구분해야 문안이 맞다
  const d = ok({ attempts: 60, successes: 58, filled: 0, attemptsSinceStamp: 60, everFilled: true, remaining: 1400 });
  t('생산 0건은 no_output 으로 구분', d.healthy === false && d.kind === 'no_output');
  t('사유에 시도 건수 명시', /시도 60건 중 실제 생산 0건/.test(d.reason));
})();
(function () {
  // 전환기: 도장 도입 직전 시도들은 도장이 없다. 분모를 좁히지 않으면 오탐한다.
  const d = ok({ attempts: 120, successes: 118, filled: 0, attemptsSinceStamp: 0, everFilled: false, remaining: 1400 });
  t('도장 이전에는 구 지표로 판정 (전환기 오탐 방지)', d.basis !== 'filled' && d.healthy === true,
    'basis=' + d.basis + ' healthy=' + d.healthy);
})();
(function () {
  // 도장 이후 표본이 아직 적으면 판정 보류 — 분모는 attemptsSinceStamp 다
  const d = ok({ attempts: 200, successes: 190, filled: 4, attemptsSinceStamp: 4, everFilled: true, remaining: 1400 });
  t('filled 분모가 소표본이면 보류', d.healthy === true && /sample</.test(d.reason));
})();
(function () {
  // 정상 가동: 04~05시(UTC) 실측 — 시도 127건 중 124건 생산
  const d = ok({ attempts: 127, successes: 124, filled: 124, attemptsSinceStamp: 127, everFilled: true, remaining: 1413 });
  t('실측 정상값(97.6%)은 정상', d.healthy === true && d.rate > 95);
})();

console.log('=== 도장을 실제로 찍는가 (크론·RPC 결선) ===');
(function () {
  const c = R('api/cron/backfill-meta-desc.js');
  t('본문을 채울 때만 도장을 찍는다',
    /patch\.description = gen\.kr;[\s\S]{0,900}patch\.description_filled_at/.test(c),
    'seo_description 만 채운 경우까지 생산으로 세면 다시 과대평가가 된다');
  t('updated_at 은 건드리지 않는다 (사람 편집 시각 보존)', !/patch\.updated_at/.test(c));
  const w = R('api/cron/pipeline-watch.js');
  t('감시가 filled·everFilled 를 넘긴다',
    /filled: row\.filled/.test(w) && /everFilled: row\.ever_filled/.test(w) && /attemptsSinceStamp: row\.attempts_since_stamp/.test(w));
})();

console.log('=== 알림 문안 ===');
(function () {
  const a = buildBackfillAlert(ok({ attempts: 88, successes: 22, remaining: 1526 }));
  t('제목에 성공률 노출', /25%/.test(a.title));
  t('원인 후보를 함께 적는다', a.lines.some(l => /크레딧/.test(l)) && a.lines.some(l => /이미지 URL/.test(l)),
    '알림만 받고 어디를 볼지 모르면 무용지물이다');
  const b = buildBackfillAlert(diagnoseBackfill({ attempts: 0, successes: 0, remaining: 1500, lastAttemptAgoMs: 9 * HOUR }));
  t('정지 알림은 확인 위치를 알려준다', /cron_runs|CRON_SECRET/.test(b.lines.join(' ')));
  const c = buildBackfillAlert(ok({ attempts: 60, successes: 58, filled: 0, attemptsSinceStamp: 60, everFilled: true, remaining: 1400 }));
  t('생산 0건 알림은 크레딧·키를 먼저 보라고 한다',
    /생산 0건/.test(c.title) && /크레딧/.test(c.lines.join(' ')) && /ANTHROPIC_API_KEY/.test(c.lines.join(' ')));
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
