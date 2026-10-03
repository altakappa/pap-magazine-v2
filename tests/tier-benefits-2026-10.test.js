'use strict';
/**
 * 등급별 혜택 사다리 (2026-10-03, 도메니코 "각 구독에 대한 혜택을 전부 추가로 적용해줘")
 *  스탠다드: 통계+공유 링크 · 크레딧 수정 1회 · 캐스팅 콜 3일 · 기본 인증서
 *  프리미엄: 팀 티어시트 · (스탠다드 전부) · 크레딧 3회 · 간판에서 '연락 버튼' 내림, 풀레터 맨 아래
 *  연간: PAP Picks 후보 우선 · 이달의 에디토리얼 후보 표시 · 검증 코드 인증서
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

// 크레딧 수정 등급별
const ce = require('../api/_lib/creditEdit');
t('크레딧 수정 횟수: 무료 0 · 스탠다드 1 · 프리미엄 3', ce.maxCreditEditsFor({ subscription_plan: 'free' }) === 0 && ce.maxCreditEditsFor({ subscription_plan: 'standard', subscription_status: 'active' }) === 1 && ce.maxCreditEditsFor({ subscription_plan: 'premium_monthly', subscription_status: 'active' }) === 3 && ce.maxCreditEditsFor({ subscription_plan: 'premium', subscription_status: 'inactive' }) === 0);
t('credits API 와 mine.js 가 등급별 한도를 쓴다', /ce\.maxCreditEditsFor\(profile \|\| \{\}\)/.test(R('api/editorials/[id]/credits.js')) && /maxCreditEditsFor\(profile \|\| \{\}\)/.test(R('api/editorials/mine.js')) && !/ce\.MAX_CREDIT_EDITS/.test(R('api/editorials/[id]/credits.js')));

// 캐스팅 콜 사다리
const cc = R('api/_lib/castingCall.js');
t('캐스팅 콜: 연간 7일 · 월간 유료 3일 · 무료 공개 때', /PAID_EARLY_DAYS = 3/.test(cc) && /viewerYearly \|\| String\(r\.public_at\) <= nowIso \|\| \(viewerPaid && paidFrom\(r\) <= nowIso\)/.test(cc) && /earlyTier = loc\.early \? \(viewerYearly \? 'yearly' : 'paid'\) : null/.test(cc));
t('캐스팅 콜 API: 유료 판정은 서버(hasActivePlan standard)', /viewerPaid = hasActivePlan\(prof \|\| \{\}, 'standard'\)/.test(R('api/casting-calls/current.js')));
t('서브미션 페이지: 유료 배지 문구 9개 언어 + earlyTier 로 분기', (R('frontend/submission.html').match(/ccEarlyPaid:'/g) || []).length === 9 && /c\.earlyTier==='paid'/.test(R('frontend/submission.html')));

// 인증서 사다리
const cert = R('api/editorials/certificate.js');
t('인증서: 스탠다드·프리미엄 기본형(코드 없음) · 연간 검증 코드형', /const paid = hasActivePlan\(p \|\| \{\}, 'standard'\)/.test(cert) && /const code = yearly \? certCode\(owned\.ed\.id, user\.id\) : null/.test(cert) && /verified: !!code/.test(cert) && /verifyUrl: code \?/.test(cert));
t('마이페이지 인증서: 코드 없으면 Basic 표기 · 잠금 문구는 "스탠다드부터"', /Basic certificate \(no verification code\)/.test(R('frontend/mypage.html')) && (R('frontend/mypage.html').match(/certLocked:'/g) || []).length === 9 && /certLocked:'인증서 · 스탠다드부터'/.test(R('frontend/mypage.html')));

// 팀 티어시트
const chk = R('api/downloads/check.js');
t('팀 티어시트: 도장 받은 아이디 + 크레딧에 있음 + 제출자 활성 프리미엄, 그 화보만', /async function teamTearsheetAllowed\(userId, editorialId\)/.test(chk) && /me\.instagram_verified_at \? normIg\(me\.instagram\) : ''/.test(chk) && /credits\.some\(\(c\) => c && normIg\(c\.instagram\) === myHandle\)/.test(chk) && /return hasActivePremium\(owner \|\| \{\}\)/.test(chk) && /reason: 'team-premium'/.test(chk));
t('팀 티어시트는 유료 판정 뒤에만(스탠다드 이상은 원래 통과)', chk.indexOf("reason: 'subscriber'") < chk.indexOf("reason: 'team-premium'"));

// 내 화보 통계 + 공유 킷
const mine = R('api/editorials/mine.js');
t('mine.js: 통계(ig_post_latest 도달·좋아요·저장 + editorial_views)와 공유 킷은 유료만, 무료는 null', /const canStats = maxEdits > 0/.test(mine) && /from\('ig_post_latest'\)/.test(mine) && /from\('editorial_views'\)/.test(mine) && /stats: canStats \?/.test(mine) && /shareKit: canStats \?/.test(mine) && /pinterest\.com\/pin\//.test(mine));
const mp = R('frontend/mypage.html');
t('마이페이지: 인스타 도달이 앞(금색), 웹 조회는 작게 뒤 · 공유 링크 · 복사 · 무료는 잠금 링크', /fmt\(st\.igReach\)/.test(mp) && mp.indexOf('fmt(st.igReach)') < mp.indexOf('fmt(st.webViews)') && /function mpCopyShare/.test(mp) && /utm_source=mypage_stats/.test(mp) && ['statReach','statWeb','shareKit','statsLocked'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));

// 구독 페이지 표
const sb = R('frontend/subscribe.html');
const premLists = sb.match(/prem: \[\n[\s\S]*?\n    \]/g) || [];
const stdLists = sb.match(/std: \[\n[\s\S]*?\n    \]/g) || [];
t('구독 표: 프리미엄 9블록에 팀 티어시트 줄, 풀레터는 마지막 줄', premLists.length === 9 && premLists.every((x) => { const it = x.split('\n').slice(1, -1); return /Tearsheet|티어시트|ティアシート|刊登页/i.test(it[6]) && /Pull-?Letter|プルレター/i.test(it[it.length - 1]); }));
t('구독 표: 프리미엄 간판에서 "연락 버튼"을 내렸다 (0건 혜택을 팔지 않는다)', premLists.every((x) => !/연락 버튼|contact button|Kontakt-Button|pulsante contatto|bouton contact|botón de contacto|連絡ボタン|联系按钮|кнопк[аи] связи/i.test(x)));
t('구독 표: 스탠다드 9블록에 통계·크레딧 1회·캐스팅 콜 3일·기본 인증서', stdLists.length === 9 && stdLists.every((x) => /3/.test(x) && /(1회|once|einmal|una volta|une fois|una vez|1回|1 次|один раз)/i.test(x)));
t('구독 표: "탈락 피드백"은 간판에서 내렸다 (템플릿인 동안)', !/서브미션 탈락 시 피드백 제공|Feedback on rejected submissions/.test(sb));
t('구독 사전 버전 ≥8', (() => { const m = sb.match(/content="subscribe" data-v="(\d+)"/); return m && Number(m[1]) >= 8; })());

// 연간
t('연간: PAP Picks 후보 맨 앞 · 관리자 목록 _submitter_yearly · 이달의 에디토리얼 후보 정렬+표시', /yearlySubmitterEditorialIds\(supabaseAdmin, eds\)/.test(R('api/cron/weekly-news.js')) && /row\._submitter_yearly = ys\.has\(row\.id\)/.test(R('api/editorials/index.js')) && /b\._submitter_yearly\?1:0\) - \(a\._submitter_yearly\?1:0/.test(R('frontend/pap-admin.js')) && /연간 프리미엄 제출/.test(R('frontend/pap-admin.js')));
// 연간 2번째 유료 서브미션 50% (10/3 도메니코 "반값으로 추가")
{
  const spm = require('../api/_lib/submissionPayment');
  const sub = { description: JSON.stringify({ submissionType: 'paid_few_looks', feeDiscount: { pct: 50, reason: 'yearly_second' } }) };
  const plain = { description: JSON.stringify({ submissionType: 'paid_few_looks' }) };
  const branded = { description: JSON.stringify({ submissionType: 'branded', feeDiscount: { pct: 50, reason: 'yearly_second' } }) };
  t('반값: 저장된 할인이 있으면 €380 → €190, 없으면 €380, 유료 아니면 0', spm.effectiveFeeCents(sub) === 19000 && spm.effectiveFeeCents(plain) === 38000 && spm.effectiveFeeCents({ description: JSON.stringify({ submissionType: 'free' }) }) === 0 && spm.YEARLY_SECOND_DISCOUNT_PCT === 50);
  t('반값: 제출 때 서버가 판정(면제 already_used 일 때만) 하고 description.feeDiscount 로 굳힌다', /_fw\.reason === 'already_used'\) _feeDiscount = \{ pct: YEARLY_SECOND_DISCOUNT_PCT, reason: 'yearly_second'/.test(R('api/submissions/index.js')) && /feeDiscount: _feeDiscount,/.test(R('api/submissions/index.js')));
  t('반값: 주문·승인·정산·심사 메일·게재 메일이 전부 effectiveFeeCents 를 쓴다', /effectiveFeeCents\(sub\)/.test(R('api/_lib/paypalOrders.js')) && /effectiveFeeCents\(sub\)/.test(R('api/_lib/settleAuthorization.js')) && /effectiveFeeCents\(\{ description: _d \}\)/.test(R('api/submissions/[id]/review.js')) && /effectiveFeeCents\(\{ description: _d \}\)/.test(R('api/editorials/[id].js')));
  t('반값: 화면 버튼은 서버가 준 feeCents 를 보인다 (shapeForOwner → _baseFeeApprovalBlock 4번째 인자)', /out\.feeCents = require\('\.\/submissionPayment'\)\.effectiveFeeCents\(row\)/.test(R('api/_lib/submissionFeedbackGate.js')) && /function _baseFeeApprovalBlock\(submissionId, submissionType, paymentStatus, feeCents\)/.test(R('frontend/pap-submission-fee.js')) && /_baseFeeApprovalBlock\(id, _desc\.submissionType \|\| '', s\.payment_status \|\| '', s\.feeCents\)/.test(R('frontend/mypage.html')) && /pap-submission-fee\.js\?v=(1\d|[2-9]\d)/.test(R('frontend/mypage.html')));
  t('반값: 구독 표 연간 줄 9개 언어 (€380 → €190)', (sb.match(/y:true, text:'[^']*€380 → €190[^']*'/g) || []).length === 9);
}
t('테스트 스크립트 등록', /tier-benefits-2026-10\.test\.js/.test(R('package.json')));
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
