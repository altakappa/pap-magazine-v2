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
t('해지 실패 시 탈퇴를 중단한다(409)',
  /if\s*\(\s*!cancelRes\.ok\s*\)[\s\S]{0,600}?status\(409\)/.test(withdraw));
t('관리자 계정은 셀프 탈퇴 불가', /admin_cannot_self_delete/.test(withdraw));

console.log('\n=== 셀프 탈퇴 — 남은 기간이 있으면 즉시 삭제하지 않는다 ===');
// 도메니코 확정 (2026-08-10):
//   "탈퇴해도 서비스가 바로 끊기는 게 아니라 한 달치는 이용할 수 있는 거임"
// 이 한 줄이 이 파일에서 제일 중요한 규칙이다. 다시 즉시 삭제로 되돌아가면 여기서 막힌다.
const wIdxPeriod    = withdraw.indexOf('current_period_end');
const wIdxHardDel   = withdraw.indexOf('await hardDelete(');
const wIdxScheduled = withdraw.search(/hasPaidTimeLeft\s*&&\s*mode\s*!==\s*'now'/);
t('남은 기간(current_period_end)을 구독 해지 전에 먼저 읽는다',
  wIdxPeriod !== -1 && wIdxPeriod < wIdxCancel,
  '해지한 뒤에 읽으면 값이 흔들려 남은 기간을 잃을 수 있다');
t('해지 호출이 실제 삭제보다 먼저다',
  wIdxCancel !== -1 && wIdxHardDel !== -1 && wIdxCancel < wIdxHardDel,
  'cancel=' + wIdxCancel + ' hardDelete=' + wIdxHardDel);
t('남은 기간이 있으면 삭제하지 않고 예약한다',
  wIdxScheduled !== -1 && wIdxScheduled < wIdxHardDel,
  '이 분기가 사라지면 회원이 낸 돈만큼의 기간을 빼앗는다');
const schedBlock = wIdxScheduled === -1 ? '' : withdraw.slice(wIdxScheduled, wIdxHardDel);
t('예약 분기가 삭제 전에 return 으로 빠져나간다', /return\s+res\.status\(200\)/.test(schedBlock));
t('예약 시 삭제일(withdraw_delete_after)을 기록한다', /withdraw_delete_after:\s*periodEnd/.test(schedBlock));
t('예약 시 등급·구독상태를 건드리지 않는다 — 그대로 쓴다',
  !/subscription_plan|subscription_status/.test(schedBlock),
  '여기서 등급을 내리면 돈 낸 기간에 서비스가 끊긴다');
t('즉시 삭제는 본인이 명시할 때만(mode=now)', /body\.mode\s*===\s*'now'/.test(withdraw));
t('탈퇴 경로가 환불을 호출하지 않는다',
  !/\/refund|\brefund\(/i.test(withdraw),
  '이미 낸 한 달치는 환불하지 않는다');

console.log('\n=== 예약된 삭제를 실제로 실행하는 크론 ===');
// 예약만 걸어두고 실행기가 없으면 계정이 영원히 안 지워진다.
const purgePath = p('api','cron','withdraw-purge.js');
t('withdraw-purge 크론 파일이 존재한다', fs.existsSync(purgePath));
const purge = fs.existsSync(purgePath) ? fs.readFileSync(purgePath, 'utf8') : '';
t('CRON_SECRET 으로 보호된다', /CRON_SECRET/.test(purge));
t('삭제일이 지난 계정만 고른다', /withdraw_delete_after/.test(purge) && /\.lt\(/.test(purge));
t('한 번에 처리할 건수 상한이 있다', /MAX_PER_RUN/.test(purge));
const vercelJson = fs.readFileSync(p('vercel.json'), 'utf8');
t('vercel.json crons 에 등록되어 있다', /\/api\/cron\/withdraw-purge/.test(vercelJson),
  '등록하지 않으면 예약이 영영 실행되지 않는다');

console.log('\n=== 프론트 안내 문구 ===');
const mypage = fs.readFileSync(p('frontend','mypage.html'), 'utf8');
t('탈퇴 링크가 마운트된다', /mpMountWithdrawLink/.test(mypage));
t('확인창이 환불 없음을 알린다', /환불되지 않습니다/.test(mypage));
t('확인창이 남은 기간을 그대로 쓸 수 있다고 알린다', /남은 이용 기간은 그대로 사용/.test(mypage),
  '"바로 끊긴다" 로 잘못 안내하면 쓸 수 있는 기간을 포기하게 만든다');
t('2단 확인', /_mpWdT\('c1'\)[\s\S]{0,200}_mpWdT\('c2'\)/.test(mypage));
t('서버의 scheduled 응답을 화면이 처리한다', /\.scheduled/.test(mypage));
t('예약 안내에 삭제일을 넣는다', /_mpWdT\('scheduled'\)[\s\S]{0,80}replace\('\{d\}'/.test(mypage));
t('즉시 삭제는 별도 확인 뒤에만 보낸다',
  /_mpWdT\('nowAsk'\)[\s\S]{0,400}_mpWdPost\('now'\)/.test(mypage),
  '기본값이 즉시 삭제가 되면 정책 위반');
t('9개 언어 모두 예약 문구를 갖는다',
  (mypage.match(/scheduled:'/g) || mypage.match(/scheduled:"/g) || []).length >= 9);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ account-delete-cancels-subscription tests FAILED'); process.exit(1); }
console.log('✅ account-delete-cancels-subscription tests passed');
