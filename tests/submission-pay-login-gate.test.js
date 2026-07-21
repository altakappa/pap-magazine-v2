/**
 * 서브미션 결제 버튼 '로그인 필요' 오탐 — 근본수정 (2026-07-21 QA 재발).
 *
 * [근본 원인] 서버(api/_lib/auth.js verifyToken)는 Bearer 토큰 '또는' pap_auth
 * httpOnly 쿠키로 인증한다. 반면 클라이언트 로그인 판정(isLoggedIn/getUser/
 * refreshUser)은 오직 localStorage 'pap-token' 만 본다. 그래서 '쿠키 전용 세션'
 * (유효한 pap_auth 쿠키 O · localStorage 토큰 X — OAuth 쿠키→토큰 교환 실패,
 * Safari ITP 로 localStorage 유실, 401 로 토큰만 삭제된 경우 등)에서 서브미션은
 * 정상 로딩되지만 결제 게이트만 '로그인 필요'로 잘못 막혔다.
 *
 * [수정] 결제 게이트를 '서버 진실'로 통일한다. _resolvePayUser() 가
 * 로컬 캐시 → refreshUser(Bearer) → /api/auth/me(credentials:same-origin 쿠키)
 * 순으로 확인하고, 서버가 인증하면(쿠키만 있어도) 결제를 진행한다.
 * 이 테스트는 그 계약을 소스로 감시한다(회귀 방지).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'submission.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 서브미션 결제 로그인 오탐 근본수정 (재발 방지) ===');

// 1) 서버-진실 헬퍼 존재
t('_resolvePayUser 헬퍼가 async 로 정의됨', /async\s+function\s+_resolvePayUser\s*\(/.test(html));

// 2) 헬퍼가 3단계(로컬 캐시 → refreshUser → 쿠키 /auth/me)를 모두 시도
const helper = (html.match(/async\s+function\s+_resolvePayUser\s*\([\s\S]*?\n\}/) || [''])[0];
t('1단계: getUser 로컬 캐시 확인', /PAP\.auth\.getUser/.test(helper));
t('2단계: refreshUser(Bearer) 복구 시도', /PAP\.auth\.refreshUser/.test(helper));
t('3단계: /api/auth/me 를 쿠키로 확인(credentials:same-origin)',
  /fetch\(\s*'\/api\/auth\/me'[\s\S]*?credentials\s*:\s*'same-origin'/.test(helper),
  '쿠키 전용 세션 복구의 핵심 — 이 raw fetch 가 없으면 재발한다');
t('서버가 user 를 주면 반환', /return\s+j\.user/.test(helper) || /j&&j\.user&&j\.user\.id/.test(helper));

// 3) 두 결제 함수 모두 서버-진실 게이트로 판정
const base = (html.match(/async\s+function\s+payBaseFee\s*\([\s\S]*?\n\}\n/) || [''])[0];
const addon = (html.match(/async\s+function\s+payAddonFee\s*\([\s\S]*?\n\}\n/) || [''])[0];
t('payBaseFee 가 _resolvePayUser 로 판정', /var\s+user\s*=\s*await\s+_resolvePayUser\(\)/.test(base));
t('payAddonFee 가 _resolvePayUser 로 판정', /var\s+user\s*=\s*await\s+_resolvePayUser\(\)/.test(addon));
t('payBaseFee: 서버도 부정할 때만 차단(if(!user))', /if\(!user\)\{[\s\S]*?payLoginFirst/.test(base));
t('payAddonFee: 서버도 부정할 때만 차단(if(!user))', /if\(!user\)\{[\s\S]*?payLoginFirst/.test(addon));

// 4) 재발 원인이던 'localStorage 토큰만 보는 게이트'가 제거됨
t('구(舊) 토큰전용 게이트(_loggedIn = isLoggedIn())가 결제부에서 제거됨',
  !/_loggedIn2?\s*=\s*!!\([^)]*isLoggedIn\(\)\)/.test(html),
  'localStorage 토큰 유무만 보는 게이트가 남아 있으면 쿠키 전용 세션에서 재발한다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-pay-login-gate tests FAILED'); process.exit(1); }
console.log('✅ submission-pay-login-gate tests passed');
