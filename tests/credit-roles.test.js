/**
 * 크레딧 역할 표준화 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 서브미션 제출 페이지와 관리자 에디토리얼 등록의 역할 명칭이 달라
 * 같은 역할이 'Photo' / 'Photographer' 로 갈라져 저장되던 문제.
 *
 * 이 테스트가 지키는 것 3가지:
 *   1. api/_lib/creditRoles.js(원본) ↔ frontend/pap-admin.js(복제본)
 *      목록이 정확히 일치 — 브라우저는 require 를 못 써서 복제가 불가피한데,
 *      한쪽만 고치면 다시 어긋난다. 사람 주의력 대신 이 테스트가 막는다.
 *   2. 서브미션 제출 화면의 고정 역할 8개가 전부 표준값 — 화면에 보이는
 *      것과 저장되는 것이 같아야 QA가 지적한 혼란이 사라진다.
 *   3. 별칭 매핑이 실제 DB에 쌓인 비표준 값들을 표준으로 바꾼다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const { CANONICAL_ROLES, normalizeRole, isCanonical } = require(path.join(ROOT, 'api/_lib/creditRoles'));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}
function eq(name, got, want) {
  t(name + ' → ' + want, got === want);
  if (got !== want) console.log('      실제:', JSON.stringify(got));
}

console.log('\n=== 1. 원본 ↔ 관리자 복제본 목록 일치 (드리프트 차단) ===');
const adminSrc = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const m = adminSrc.match(/var EDITORIAL_CREDIT_ROLES\s*=\s*\[([\s\S]*?)\];/);
t('pap-admin.js 에서 EDITORIAL_CREDIT_ROLES 를 찾았다', !!m);
if (m) {
  const adminRoles = (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  t('개수 일치 (' + adminRoles.length + ' vs ' + CANONICAL_ROLES.length + ')',
    adminRoles.length === CANONICAL_ROLES.length);
  const same = adminRoles.length === CANONICAL_ROLES.length &&
    adminRoles.every((r, i) => r === CANONICAL_ROLES[i]);
  t('순서·철자까지 완전 일치', same);
  if (!same) {
    const missing = CANONICAL_ROLES.filter((r) => adminRoles.indexOf(r) === -1);
    const extra = adminRoles.filter((r) => CANONICAL_ROLES.indexOf(r) === -1);
    if (missing.length) console.log('      관리자에 없음:', missing.join(', '));
    if (extra.length) console.log('      원본에 없음:', extra.join(', '));
  }
}

console.log('\n=== 2. 서브미션 제출 화면 고정 역할이 전부 표준값 ===');
const subSrc = fs.readFileSync(path.join(ROOT, 'frontend/submission.html'), 'utf8');
const labels = (subSrc.match(/<div class="team-role">([^<]+)<\/div>/g) || [])
  .map((s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
t('고정 역할 행을 찾았다 (' + labels.length + '개)', labels.length >= 8);
labels.forEach((l) => t('"' + l + '" 은 표준값', isCanonical(l)));
t('포토그래퍼 필수 크레딧 판정 regex 가 새 라벨도 매칭',
  /^photo(grapher)?$/i.test('Photographer') && /^photo(grapher)?$/i.test('Photo'));
t('구 라벨(PHOTO/MUAH)이 화면 문구에 남아있지 않다',
  !/\(PHOTO\)/.test(subSrc) && !/>MUAH</.test(subSrc));

console.log('\n=== 3. 별칭 매핑 — DB 실측 비표준 값 (2026-07-21) ===');
eq('Photo', normalizeRole('Photo'), 'Photographer');
eq('Photography', normalizeRole('Photography'), 'Photographer');
eq('Photo Assist', normalizeRole('Photo Assist'), 'Photographer assist');
eq('Styling', normalizeRole('Styling'), 'Stylist');
eq('Styling Asst.', normalizeRole('Styling Asst.'), 'Stylist assist');
eq('Styling Assist', normalizeRole('Styling Assist'), 'Stylist assist');
eq('Makeup', normalizeRole('Makeup'), 'Make Up');
eq('MUAH', normalizeRole('MUAH'), 'Make Up & Hair');
eq('HMUA', normalizeRole('HMUA'), 'Make Up & Hair');
eq('Makeup & Hair', normalizeRole('Makeup & Hair'), 'Make Up & Hair');
eq('Retouch', normalizeRole('Retouch'), 'Retouching');
eq('Production', normalizeRole('Production'), 'Producer');
eq('Art Dir.', normalizeRole('Art Dir.'), 'Art Director');
eq('Creative Direction', normalizeRole('Creative Direction'), 'Creative Director');
eq('Agency', normalizeRole('Agency'), 'Talent Agency');
eq('Hair Stylist', normalizeRole('Hair Stylist'), 'Hair');
eq('Set assistance', normalizeRole('Set assistance'), 'Set Design assist');

console.log('\n=== 4. 표기 흔들림 흡수 ===');
eq('대문자 PHOTOGRAPHER', normalizeRole('PHOTOGRAPHER'), 'Photographer');
eq('공백 포함 "Hair "', normalizeRole('Hair '), 'Hair');
eq('소문자 hair assist', normalizeRole('hair assist'), 'Hair assist');
eq('snake_case photo_assist', normalizeRole('photo_assist'), 'Photographer assist');
eq('이미 표준값은 그대로', normalizeRole('Photographer'), 'Photographer');

console.log('\n=== 5. 모르는 값은 건드리지 않는다 (크레딧 오기재 방지) ===');
eq('Assistant (무엇의 보조인지 불명)', normalizeRole('Assistant'), 'Assistant');
eq('Designer (무슨 디자이너인지 불명)', normalizeRole('Designer'), 'Designer');
eq('Nails', normalizeRole('Nails'), 'Nails');
eq('BTS', normalizeRole('BTS'), 'BTS');
eq('빈 문자열', normalizeRole(''), '');
eq('null', normalizeRole(null), '');

console.log('\n=== 6. 브랜드 크레딧은 역할 목록과 분리 유지 ===');
// 'Fashion by'(201건) / 'Beauty by'(27건) 는 brandExtract.js 가 인스타 캡션과
// /go/ 제휴 링크를 만드는 데 쓴다. 역할로 흡수되면 캡션·링크가 깨진다.
t('Fashion by 는 표준 역할 목록에 없다', !isCanonical('Fashion by'));
t('Beauty by 는 표준 역할 목록에 없다', !isCanonical('Beauty by'));
eq('Fashion by 는 변환되지 않고 보존', normalizeRole('Fashion by'), 'Fashion by');
eq('Beauty by 는 변환되지 않고 보존', normalizeRole('Beauty by'), 'Beauty by');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ credit-roles tests FAILED'); process.exit(1); }
console.log('✅ credit-roles tests passed');
