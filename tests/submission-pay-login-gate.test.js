/**
 * 서브미션 결제 버튼 '로그인 필요' 오탐 — 근본원인 확정 수정 (2026-07-21, 라이브 실측).
 *
 * [진짜 근본원인] pap-api.js 는 네임스페이스를 `const PAP = (function(){..})()` 로
 * 선언한다. 클래식 스크립트에서 최상위 const/let 은 window 속성이 되지 않으므로
 * window.PAP 는 '항상' undefined 다(맨이름 PAP 는 정상 동작). 결제 함수들이
 * `window.PAP && PAP.auth && ...` 로 가드했기에 이 조건이 늘 거짓 → 토큰·캐시·세션이
 * 전부 정상인 로그인 사용자도 "결제하려면 먼저 로그인해 주세요"로 막혔다.
 * (쿠키 전용 세션·토큰 만료·PG 문제가 아니었다.)
 *
 * [수정] 결제 인증 판정에서 window.PAP 대신 '맨이름 PAP'를 typeof 가드로 참조한다
 * (_resolvePayUser 의 _P). 추가 방어로 서버 쿠키 확인(/auth/me)도 유지.
 * 이 테스트는 결제 함수/헬퍼에 window.PAP&& 가드가 다시 생기지 않도록 감시한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'submission.html'), 'utf8');
// 2026-07-22 구조개편 Phase 2 — 기본료 결제 로직(_resolvePayUser/payBaseFee/_PAY_I18N 등)이
// frontend/pap-submission-fee.js 공용 모듈로 추출됨. payAddonFee 는 submission.html 에 남음.
// 이 게이트 테스트의 불변식(window.PAP&& 금지·서버진실 판정)은 그대로 — 소스만 합쳐서 검사한다.
const mod = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-submission-fee.js'), 'utf8');
const src = html + '\n' + mod;

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 서브미션 결제 로그인 오탐 근본수정 (window.PAP → 맨이름 PAP) ===');

const helper = (src.match(/async\s+function\s+_resolvePayUser\s*\([\s\S]*?\n\}/) || [''])[0];
const base   = (src.match(/async\s+function\s+payBaseFee\s*\([\s\S]*?\n\}\n/) || [''])[0];
const addon  = (src.match(/async\s+function\s+payAddonFee\s*\([\s\S]*?\n\}\n/) || [''])[0];

// 1) 헬퍼 존재 + 맨이름 PAP 를 typeof 가드로 캡처
t('_resolvePayUser 헬퍼 존재', /async\s+function\s+_resolvePayUser\s*\(/.test(src));
t('맨이름 PAP 를 typeof 가드로 참조(_P)', /var\s+_P\s*=\s*\(typeof\s+PAP\s*!==\s*'undefined'/.test(helper));
t('로컬 캐시 getUser 시도(_P 경유)', /_P&&_P\.auth\.getUser/.test(helper));
t('refreshUser 복구 시도(_P 경유)', /_P\.auth\.refreshUser/.test(helper));
t('쿠키 세션 방어: /api/auth/me + credentials:same-origin',
  /fetch\(\s*'\/api\/auth\/me'[\s\S]*?credentials\s*:\s*'same-origin'/.test(helper));

// 2) 회귀 방지의 핵심 — 결제 인증 코드에 window.PAP&& 가드가 없어야 한다
t('_resolvePayUser 에 window.PAP&& 가드 없음', !/window\.PAP&&/.test(helper),
  'window.PAP 는 const 라 항상 undefined → 이 가드가 있으면 재발한다');
t('payBaseFee 에 window.PAP&& 가드 없음', !/window\.PAP&&/.test(base));
t('payAddonFee 에 window.PAP&& 가드 없음', !/window\.PAP&&/.test(addon));

// 3) 두 결제 함수가 서버-진실 헬퍼로 판정하고 !user 일 때만 차단
t('payBaseFee 가 _resolvePayUser 로 판정', /var\s+user\s*=\s*await\s+_resolvePayUser\(\)/.test(base));
t('payAddonFee 가 _resolvePayUser 로 판정', /var\s+user\s*=\s*await\s+_resolvePayUser\(\)/.test(addon));
t('payBaseFee: !user 일 때만 차단', /if\(!user\)\{[\s\S]*?payLoginFirst/.test(base));
t('payAddonFee: !user 일 때만 차단', /if\(!user\)\{[\s\S]*?payLoginFirst/.test(addon));

// 4) 구(舊) 토큰전용 게이트(_loggedIn=isLoggedIn())가 없어야 한다
t('구 토큰전용 게이트(_loggedIn) 제거됨', !/_loggedIn2?\s*=\s*!!\(/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-pay-login-gate tests FAILED'); process.exit(1); }
console.log('✅ submission-pay-login-gate tests passed');
