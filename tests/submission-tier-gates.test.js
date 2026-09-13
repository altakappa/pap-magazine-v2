/**
 * 서브미션 등급 혜택 게이트 (도메니코 2026-09-12 "셋 다 해줘")
 *   1) 심사 피드백은 스탠다드 이상만 (보완 요청 메모는 예외)
 *   2) 심사 대기 중 자기 수정은 프리미엄만 (보완 요청은 누구나)
 *   3) /subscribe 프리미엄 카드·비교표에 새 혜택 3줄 (9개 언어)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const G = require(path.join(ROOT, 'api', '_lib', 'submissionFeedbackGate'));
const FREE = { subscription_plan: 'free', subscription_status: 'inactive' };
const STD = { subscription_plan: 'standard', subscription_status: 'active' };
const PREM = { subscription_plan: 'premium', subscription_status: 'active' };
const LAPSED = { subscription_plan: 'premium', subscription_status: 'inactive' };

console.log('\n=== shapeForOwner: 피드백 ===');
let r = G.shapeForOwner({ status: 'rejected', admin_notes: '메모' }, FREE);
ok('무료 + 거절: 본문 비움, feedbackLocked=true', r.admin_notes === null && r.feedbackLocked === true);
r = G.shapeForOwner({ status: 'rejected', admin_notes: '메모' }, STD);
ok('스탠다드 + 거절: 본문 그대로', r.admin_notes === '메모' && r.feedbackLocked === false);
r = G.shapeForOwner({ status: 'rejected', admin_notes: '메모' }, LAPSED);
ok('만료된 프리미엄 = 무료 취급', r.admin_notes === null && r.feedbackLocked === true);
r = G.shapeForOwner({ status: 'revision', admin_notes: '이걸 고쳐라' }, FREE);
ok('보완 요청 메모는 무료도 본다 (지시문이라 숨기면 재제출 불가)', r.admin_notes === '이걸 고쳐라' && r.feedbackLocked === false);
r = G.shapeForOwner({ status: 'rejected', admin_notes: '' }, FREE);
ok('메모가 비어 있으면 잠금 표시도 없다', r.feedbackLocked === false);
ok('null 행은 그대로', G.shapeForOwner(null, FREE) === null);

console.log('\n=== shapeForOwner: 대기 중 자기 수정 ===');
ok('프리미엄 + pending → canSelfEdit', G.shapeForOwner({ status: 'pending' }, PREM).canSelfEdit === true);
r = G.shapeForOwner({ status: 'pending' }, STD);
ok('스탠다드 + pending → 불가, reason not_premium', r.canSelfEdit === false && r.selfEditBlockedReason === 'not_premium');
ok('무료 + revision → 가능 (관리자가 시킨 것)', G.shapeForOwner({ status: 'revision' }, FREE).canSelfEdit === true && G.shapeForOwner({ status: 'revision' }, FREE).selfEditBlockedReason === null);
ok('approved 는 누구도 불가', G.shapeForOwner({ status: 'approved' }, PREM).canSelfEdit === false);

console.log('\n=== 서버 배선 ===');
const mine = read('api/submissions/mine.js');
ok('mine.js: 등급 한 번 조회 후 모든 행을 shapeForOwner 로', /loadPlan\(supabaseAdmin, user\.id\)/.test(mine) && /\.\.\.shapeForOwner\(s, _plan\)/.test(mine));
const one = read('api/submissions/[id].js');
ok('[id].js GET: 본인(관리자 아님) 조회만 shapeForOwner', /\(isOwner && !isAdmin\) \? shapeForOwner\(submission, await loadPlan\(supabaseAdmin, user\.id\)\) : submission/.test(one));
ok('[id].js PUT: pending 이면 프리미엄만 (403 SELF_EDIT_PREMIUM_ONLY), revision 은 누구나', /if \(submission\.status === 'pending'\) \{[\s\S]{0,300}canSelfEditPending\(_planRow\)[\s\S]{0,200}'SELF_EDIT_PREMIUM_ONLY'/.test(one));
ok('[id].js PUT 의 기존 상태 가드(pending·revision 외 409)는 그대로', /submission\.status !== 'pending' && submission\.status !== 'revision'/.test(one));

console.log('\n=== 마이페이지 ===');
const mp = read('frontend/mypage.html');
ok('목록: pending + canSelfEdit 일 때만 수정 버튼', /if \(ds === 'pending' && s\.canSelfEdit\)/.test(mp));
ok('상세: feedbackLocked 면 본문 대신 스탠다드 안내 + /subscribe 링크', /if\(s\.feedbackLocked\)\{[\s\S]{0,400}utm_source=mypage_feedback/.test(mp));
ok('상세: pending 프리미엄은 수정 버튼, 아니면 프리미엄 안내', /if\(s\.canSelfEdit\)\{[\s\S]{0,600}selfEditBlockedReason === 'not_premium'[\s\S]{0,400}utm_source=mypage_selfedit/.test(mp));
ok('마이페이지 사전 v8 + 8개 언어 키', /content="mypage" data-v="[8-9]"/.test(mp) && ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].every((l) => { const d = JSON.parse(read('frontend/i18n/ui/mypage.' + l + '.json')); return d['심사 피드백은 스탠다드 회원부터 볼 수 있습니다.'] && d['심사 대기 중 제출 내용을 직접 수정하는 것은 프리미엄 회원만 가능합니다.'] && d['제출 내용 수정하기']; }));

console.log('\n=== 서브미션 폼 ===');
const sub = read('frontend/submission.html');
const cnt = (re) => (sub.match(re) || []).length;
ok('pending 자기 수정 배너 문구(selfEditBannerMode·Instruction) 9개 언어', cnt(/selfEditBannerMode:'(?:[^'\\]|\\.)*'/g) === 9 && cnt(/selfEditBannerInstruction:'(?:[^'\\]|\\.)*'/g) === 9 && /_t\(_selfEdit\?'selfEditBannerMode':'reviseBannerMode'/.test(sub));
ok('서버 403 SELF_EDIT_PREMIUM_ONLY → 언어별 문구', /code==='SELF_EDIT_PREMIUM_ONLY'/.test(sub) && /selfEditPremiumOnly:\{ko:'[^']+',en:'[^']+',de:'[^']+',it:'[^']+',fr:'[^']+',es:'[^']+',ja:'[^']+',zh:'[^']+',ru:'[^']+'\}/.test(sub));

console.log('\n=== /subscribe 혜택 문구 ===');
const sb = read('frontend/subscribe.html');
const rowsRe = /\['[^']*(공동작업자|collaborator|Collaborator|соавтор|collaboratore|collaborateur|colaborador|コラボレーター|合作者)[^']*',false,false,true\]/g;
ok('비교표: 공동작업자 자격 행 false/false/true — 9개 언어(+중복 ru 블록)', (sb.match(rowsRe) || []).length >= 9);
const featRe = /\{on:true, text:'[^']*(3회|3 times|3 раза|3× je|3 volte|3 fois|3 veces|3回|3 次)[^']*'\}/g;
ok('프리미엄 카드: 크레딧 수정 3회 줄 — 9개 언어', (sb.match(featRe) || []).length >= 9);
ok('프리미엄 카드: 심사 대기 중 수정 줄 — 9개 언어', (sb.match(/\{on:true, text:'[^']*(심사 대기 중|awaiting review|ожидания проверки|während der Prüfung|in attesa di revisione|en attente de révision|en revisión|審査待ち|审核等待)[^']*'\}/g) || []).length >= 9);

console.log('\n=== 피드백 신청 (도메니코: 신청한 회원에게만 써준다) ===');
const { DEFAULT_REJECTION_NOTE } = require(path.join(ROOT, 'api', '_lib', 'email'));
ok('hasRealFeedback: 빈값·자동 반려문은 거짓, 사람이 쓴 메모는 참', !G.hasRealFeedback('') && !G.hasRealFeedback(DEFAULT_REJECTION_NOTE) && G.hasRealFeedback('구도가 좋지만…'));
r = G.shapeForOwner({ status: 'rejected', admin_notes: DEFAULT_REJECTION_NOTE, description: '{}' }, STD);
ok('스탠다드 + 거절 + 자동 반려문만 → 피드백 없음으로 보이고 canRequestFeedback', r.admin_notes === null && r.feedbackWritten === false && r.canRequestFeedback === true);
r = G.shapeForOwner({ status: 'rejected', admin_notes: DEFAULT_REJECTION_NOTE, description: JSON.stringify({ feedbackRequestedAt: '2026-09-12T00:00:00Z' }) }, STD);
ok('이미 신청한 건은 다시 신청 불가 + 신청 시각 노출', r.canRequestFeedback === false && r.feedbackRequestedAt === '2026-09-12T00:00:00Z');
ok('사람이 쓴 피드백이 있으면 신청 버튼 없음', G.shapeForOwner({ status: 'rejected', admin_notes: '메모', description: '{}' }, STD).canRequestFeedback === false);
ok('무료 회원은 신청 불가, pending 은 신청 불가', G.shapeForOwner({ status: 'rejected', admin_notes: '', description: '{}' }, FREE).canRequestFeedback === false && G.shapeForOwner({ status: 'pending', admin_notes: '', description: '{}' }, STD).canRequestFeedback === false);
const fr = read('api/submissions/[id]/feedback-request.js');
ok('API: POST 만, 본인만, 스탠다드 이상(FEEDBACK_STANDARD_ONLY), 결정 난 상태만, 이미 쓰였으면 409, 신청 시각 저장 + 텔레그램 await', /req\.method !== 'POST'/.test(fr) && /sub\.user_id !== user\.id/.test(fr) && /FEEDBACK_STANDARD_ONLY/.test(fr) && /FEEDBACK_REQUESTABLE_STATUSES\.indexOf\(sub\.status\)/.test(fr) && /FEEDBACK_ALREADY_WRITTEN/.test(fr) && /desc\.feedbackRequestedAt = new Date\(\)\.toISOString\(\)/.test(fr) && /await sendTextToTelegramSafe\(/.test(fr));
ok('마이페이지: canRequestFeedback → 신청 버튼, 신청 후 안내, POST 배선', /if\(s\.canRequestFeedback\)\{/.test(mp) && /s\.feedbackRequestedAt && !note/.test(mp) && /\/feedback-request'/.test(mp) && /content="mypage" data-v="(?:8|9|[1-9][0-9])"/.test(mp));
ok('review.js: 유료 회원 반려 시 선제 알림(텔레그램 "피드백 작성 필요") 제거 — 주석만 남는다', !/sendTextToTelegramSafe\(\s*'💬 유료 회원 서브미션 반려/.test(read('api/submissions/[id]/review.js')));

console.log('\npassed: ' + passed + '   failed: ' + failed);
if (failed) { console.log('❌ submission-tier-gates FAILED'); process.exit(1); }
console.log('✅ submission-tier-gates passed');
