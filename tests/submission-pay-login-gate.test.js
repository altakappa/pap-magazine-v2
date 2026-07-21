/**
 * 서브미션 결제 버튼 '로그인 필요' 오탐 (2026-07-21 QA 재발).
 *
 * payBaseFee 의 인증 게이트가 user.id 를 강제하면, 토큰은 있는데(로그인 상태)
 * pap-user 캐시나 /auth/me 복구가 일시적으로 비는 순간 '로그인 필요'로 잘못
 * 막힌다. 진짜 차단 기준은 로그인 여부(토큰=isLoggedIn)여야 한다. 이 테스트는
 * 게이트가 "로그인 상태면 유저 캐시가 비어도 막지 않는" 형태인지 소스로 감시한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'submission.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 서브미션 결제 로그인 오탐 게이트 (재발 방지) ===');
t('로그인 여부(토큰)를 별도로 확인한다', /_loggedIn\s*=\s*!!\([^)]*isLoggedIn\(\)\)/.test(html));
t('차단은 (유저 없음 && 비로그인) 일 때만', /if\(!\(user&&user\.id\)\s*&&\s*!_loggedIn\)\{/.test(html));
t('토큰만 있고 유저 캐시가 비어도 진행(user = user || {})', /user\s*=\s*user\s*\|\|\s*\{\}/.test(html));
t('refreshUser 복구 시도 유지', /PAP\.auth\.refreshUser/.test(html));
t('구(舊) 강제차단(if(!user||!user.id){ ...payLoginFirst )은 이 게이트에서 제거됨',
  !/\}\n\s*if\(!user\|\|!user\.id\)\{\n\s*if\(typeof PAP!=='undefined'\) PAP\.ui\.toast\(_payT\('payLoginFirst'\)/.test(html),
  '구 강제차단 블록이 남아 있으면 재발한다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-pay-login-gate tests FAILED'); process.exit(1); }
console.log('✅ submission-pay-login-gate tests passed');
