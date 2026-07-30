/**
 * 발행 페이스 판정 회귀 (2026-07-30 신설).
 *
 * 왜 필요했나 — 도메니코 지적:
 *   "필름이나 에디토리얼은 서브미션이 없으면 안 올리는 거라 안 올려도 괜찮다."
 *   그런데 감사는 고정 주간 할당량만 보고 films_pace 를 매일 fail(긴급)로 띄웠다.
 *   정상 운영 상태가 매일 '긴급 1' 로 표시되면, 사람은 결국 대시보드 전체를
 *   안 믿게 된다. 참여지표에서 이미 같은 실수를 했었다(2026-07-25 MIN_WOW).
 *
 * 여기서 지키는 것:
 *   ① 공급(대기 소재)이 없으면 미발행은 정상 — 오탐 금지
 *   ② 공급이 있는데 못 나갔으면 그건 진짜 문제 — 놓치지 않기
 *   ③ 자동 공급 채널(기사=IG 자동수입)은 종전대로 목표만 본다
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service';
const { judgePace } = require('../api/_lib/growthAudit');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== 공급이 없으면 미발행은 정상 (오탐 제거) ===');
(function () {
  // 2026-07-30 실제 상황: 필름 주 0건, 목표 1, 대기 소재 0
  const d = judgePace({ last7: 0, prev7: 2, weeklyTarget: 1, waiting: 0 });
  t('필름 0건 + 대기 0 → 정상', d.status === 'ok', 'status=' + d.status);
  t('사유를 문구로 설명한다', /공급이 없으면 미발행이 정상/.test(d.note));
  t('수치는 그대로 노출 (정보 손실 없음)', /이번 주 0 vs 지난주 2/.test(d.note));
})();
(function () {
  const d = judgePace({ last7: 2, prev7: 6, weeklyTarget: 5, waiting: 0 });
  t('에디토리얼도 같은 규칙', d.status === 'ok');
})();

console.log('=== 공급이 있는데 못 나갔으면 문제 (놓치지 않기) ===');
(function () {
  const d = judgePace({ last7: 0, prev7: 2, weeklyTarget: 1, waiting: 3 });
  t('대기 3건인데 0 발행 → fail', d.status === 'fail');
  t('대기 건수를 문구에 넣는다', /대기 소재 3건이 있는데 못 나갔다/.test(d.note),
    '몇 건이 막혀 있는지 알아야 사람이 바로 움직인다');
})();
(function () {
  // 목표 5, 발행 3 = 절반 이상이라 warn (기존 등급 규칙 유지)
  const d = judgePace({ last7: 3, prev7: 6, weeklyTarget: 5, waiting: 4 });
  t('절반 이상이면 warn (등급 규칙 보존)', d.status === 'warn');
})();

console.log('=== 자동 공급 채널은 종전대로 ===');
(function () {
  // 기사 = IG 자동수입. waiting 개념이 없으므로 null → 목표만으로 판정
  const d = judgePace({ last7: 1, prev7: 41, weeklyTarget: 5, waiting: null });
  t('기사 급감은 그대로 fail', d.status === 'fail');
  t('공급 문구를 붙이지 않는다', !/대기/.test(d.note));
})();

console.log('=== 목표 달성은 공급과 무관하게 정상 ===');
(function () {
  const a = judgePace({ last7: 6, prev7: 3, weeklyTarget: 5, waiting: 0 });
  const b = judgePace({ last7: 6, prev7: 3, weeklyTarget: 5, waiting: 9 });
  t('달성했으면 대기 유무와 무관하게 ok', a.status === 'ok' && b.status === 'ok');
  t('달성 시엔 공급 문구 없음', !/대기/.test(a.note));
})();

console.log('=== 결선 (감사 본체) ===');
(function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'growthAudit.js'), 'utf8');
  t('필름·에디토리얼에 공급 조회를 연결', /pace\('editorials'[^)]*waitingSupply/.test(src) && /pace\('films'[^)]*waitingSupply/.test(src));
  t('기사에는 연결하지 않는다 (자동 수입)', /pace\('articles', '기사 주간 발행', 5\)/.test(src));
  t('대기 소재 = 미발행 draft + 처리 대기 서브미션',
    /neq\('status', 'published'\)/.test(src) && /\['pending', 'revision'\]/.test(src));
  t('공급 조회는 목표 미달일 때만 (정상일 때 쿼리 낭비 금지)',
    /last7 < weeklyTarget\) \? await supplyFn\(\)/.test(src));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ growth-pace-supply tests FAILED'); process.exit(1); }
console.log('✅ growth-pace-supply tests passed');
