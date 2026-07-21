/**
 * 서브미션 게재료 미결제 게이트 (2026-07-21 QA, 정책 A=경고).
 *
 * 배경: 관리자 서브미션 목록에서 유료/브랜디드(게재료 대상) 서브미션이
 * 결제(payment_status='paid') 없이도 '에디토리얼 편집' 버튼이 열려 있었다.
 * payment_status 기본값은 'none' 인데 뱃지 함수가 'paid'/'awaiting_payment'
 * 만 처리해 미결제 표시조차 안 떴다. 이 테스트는 그 게이트가 살아있는지
 * pap-admin.js 소스로 검증한다(경고 게이트 — 하드 차단 아님).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

console.log('\n=== 서브미션 게재료 미결제 게이트 (정책 A) ===');
t('_isFeeRequiredType 정의됨', src.includes('function _isFeeRequiredType'));
t('branded·few_looks 를 유료로 인식', src.includes("k==='branded'") && src.includes("k==='few_looks'"));
t('가드 함수 openEditorialEditorGuarded 정의됨', src.includes('function openEditorialEditorGuarded'));
t('가드가 confirm 경고를 띄운다', /openEditorialEditorGuarded\(editorialId\)\{[\s\S]{0,300}window\.confirm/.test(src));
t('가드 통과 시 openEditorialEditor 로 진행', /openEditorialEditorGuarded[\s\S]{0,300}openEditorialEditor\(editorialId\)/.test(src));
t('편집 버튼이 미결제 판정(_unpaidFee)과 가드를 연결', src.includes('_unpaidFee') && src.includes('openEditorialEditorGuarded'));
t('미결제 판정은 유료타입 && payment_status!==paid', /_isFeeRequiredType\(_submissionTypeOf\(s\)\)\s*&&\s*s\.payment_status\s*!==\s*'paid'/.test(src));
t('미결제 뱃지 라벨 노출', src.includes('미결제'));
t('무료 경로 유지(비가드 openEditorialEditor 직접 호출 존재)', /\} else \{[\s\S]{0,300}onclick="openEditorialEditor\(/.test(src));
t('무료(free) 는 게이트 대상 아님(feeRequired false)', !/k==='free'/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ submission-payment-gate tests FAILED'); process.exit(1); }
console.log('✅ submission-payment-gate tests passed');
