/**
 * 회원을 지우기 전에 결제사 구독을 반드시 먼저 끊는다 (2026-08-10).
 *
 * [무엇이 문제였나]
 * api/admin/member-delete.js 는 회원을 지우면서 구독을 끊지 않았다.
 * 결제사(PayPal·Paddle)는 우리 DB 를 모른다 — 회원이 사라져도 구독은 살아서
 * 매달 계속 청구된다. 서비스는 못 쓰는데 돈만 나가고, 웹훅이 와도 회원이 없어
 * 매칭에 실패해 조용히 지나간다. 지급거절(chargeback)로 직행하는 경로였다.
 * Paddle 시절엔 고객이 Paddle 포털에서 직접 끊을 수 있어 덜 위험했지만
 * PayPal 에는 그 안전망이 없다.
 *
 * [정책 — 도메니코 확정]
 * "이미 낸 한 달치는 환불하지 않는다. 구독 기간이 끝난 뒤로 재결제만 막는다."
 * 따라서 이 경로는 절대 환불을 호출해서는 안 된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const p = (...a) => path.join(__dirname, '..', ...a);

const helper   = fs.readFileSync(p('api','_lib','cancelProviderSubscription.js'), 'utf8');
const adminDel = fs.readFileSync(p('api','admin','member-delete.js'), 'utf8');
const withdraw = fs.readFileSync(p('api','auth','withdraw.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 삭제 전 구독 해지 (공용 헬퍼) ===');
t('헬퍼가 존재하고 export 된다', /module\.exports\s*=\s*\{\s*cancelProviderSubscription/.test(helper));
t('PayPal 구독 해지 API 를 호출한다', /billing\/subscriptions\/\$\{[^}]*\}\/cancel/.test(helper));
t('Paddle 은 기간 말 종료(next_billing_period)', /next_billing_period/.test(helper),
  '즉시 종료하면 이미 낸 기간을 빼앗는 셈이 된다');
t('환불 API 를 호출하지 않는다',
  !/\/refund|payments\/captures\/[^/]*\/refund|\brefund\(/i.test(helper),
  '탈퇴는 환불 사유가 아니다 — 정책 위반');
t('실패를 ok:false 로 알린다', /ok:\s*false/.test(helper));

console.log('\n=== 관리자 삭제 ===');
t('헬퍼를 불러온다', /require\('\.\.\/_lib\/cancelProviderSubscription'\)/.test(adminDel));
const dIdxCancel = adminDel.indexOf('cancelProviderSubscription(');
const dIdxDelete = adminDel.indexOf(".from('profiles')\n        .delete()");
t('해지 호출이 profiles 삭제보다 먼저다',
  dIdxCancel !== -1 && dIdxDelete !== -1 && dIdxCancel < dIdxDelete,
  'cancel=' + dIdxCancel + ' delete=' + dIdxDelete);
t('해지 실패 시 삭제를 중단한다(409)',
  /if\s*\(\s*!cancelRes\.ok\s*\)[\s\S]{0,400}?status\(409\)/.test(adminDel),
  '돈이 계속 나가는 것보다 삭제가 안 되는 편이 낫다');

console.log('\n=== 셀프 탈퇴 ===');
t('withdraw 엔드포인트 존재', /module\.exports\s*=\s*async function handler/.test(withdraw));
t('strict 인증(토큰 무효화 검증)을 쓴다', /requireAuthStrict/.test(withdraw));
t('명시적 confirm 을 요구한다', /confirm\s*!==\s*'DELETE'/.test(withdraw));
const wIdxCancel = withdraw.indexOf('cancelProviderSubscription(');
const wIdxDelete = withdraw.indexOf(".from('profiles').delete()");
t('해지 호출이 계정 삭제보다 먼저다',
  wIdxCancel !== -1 && wIdxDelete !== -1 && wIdxCancel < wIdxDelete,
  'cancel=' + wIdxCancel + ' delete=' + wIdxDelete);
t('해지 실패 시 탈퇴를 중단한다(409)',
  /if\s*\(\s*!cancelRes\.ok\s*\)[\s\S]{0,600}?status\(409\)/.test(withdraw));
t('관리자 계정은 셀프 탈퇴 불가', /admin_cannot_self_delete/.test(withdraw));

console.log('\n=== 프론트 안내 문구 ===');
const mypage = fs.readFileSync(p('frontend','mypage.html'), 'utf8');
t('탈퇴 링크가 마운트된다', /mpMountWithdrawLink/.test(mypage));
t('확인창이 환불 없음을 알린다', /환불되지 않으며/.test(mypage));
t('확인창이 구독 해지 대안을 안내한다', /구독 해지\]를 이용해/.test(mypage),
  '남은 기간을 쓰고 싶은 사람에게 더 싼 선택지를 먼저 알려야 분쟁이 안 난다');
t('2단 확인', /_mpWdT\('c1'\)[\s\S]{0,200}_mpWdT\('c2'\)/.test(mypage));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ account-delete-cancels-subscription tests FAILED'); process.exit(1); }
console.log('✅ account-delete-cancels-subscription tests passed');
