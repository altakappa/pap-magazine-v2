/**
 * 유료 전환 장치 5종 (도메니코 2026-09-13 확정)
 *   1 심사 우선권: 프리미엄 2영업일 / 그 외 최대 7영업일 (SLA 크론 + 접수 알림 + 문구 통일)
 *   3 인스타그램 피드 + 스토리 보장 (프리미엄, 릴스 제외) — 게재 시 운영자 알림 + 문구
 *   5 크리에이터 공개 프로필 강화 — 인증 배지 · 1편부터 · 활동 지역 · 전체 화보 · 연락 버튼
 *   6 연간 프리미엄 €380 1회 면제 — 제출 시 자동(payment_status='waived'), €790 제외
 *   8 승인 메일 프리미엄 업셀 — 비프리미엄에게만, 적용된 혜택만
 * + 9999a3d 회귀: contributorProfile.js 문자열 안 줄바꿈 → /contributors 500 (하루). 이제 실제로 require 한다.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

(async () => {
  console.log('\n=== 6. 연간 프리미엄 €380 면제 — premiumFeeWaiver ===');
  const W = require(path.join(ROOT, 'api', '_lib', 'premiumFeeWaiver'));
  ok('연간 프리미엄 활성 행 → true', W.isYearlyPremiumRow({ plan: 'premium_yearly', billing_cycle: 'yearly', status: 'active' }));
  ok('billing_cycle 없이 plan 만 *_yearly 여도 true', W.isYearlyPremiumRow({ plan: 'premium_yearly', status: 'active' }));
  ok('월간 프리미엄 → false', !W.isYearlyPremiumRow({ plan: 'premium_monthly', billing_cycle: 'monthly', status: 'active' }));
  ok('연간 스탠다드 → false', !W.isYearlyPremiumRow({ plan: 'standard_yearly', billing_cycle: 'yearly', status: 'active' }));
  ok('해지된 연간 프리미엄 → false', !W.isYearlyPremiumRow({ plan: 'premium_yearly', billing_cycle: 'yearly', status: 'canceled' }));
  ok('면제 대상 유형은 paid_few_looks(€380)만 — branded 는 아님', W.isWaivableType('paid_few_looks') && !W.isWaivableType('branded') && !W.isWaivableType('free'));

  function fakeDb(subs, waivedRows) {
    return { from: (t) => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: t === 'subscriptions' ? subs : [] }),
          eq: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: t === 'submissions' ? waivedRows : [] }) }) }) }),
        }),
      }),
    }) };
  }
  const yearly = { id: 's1', plan: 'premium_yearly', billing_cycle: 'yearly', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2027-09-01T00:00:00Z' };
  let c = await W.checkFeeWaiver(fakeDb([yearly], []), 'u1', 'paid_few_looks');
  ok('연간 프리미엄 + 미사용 + 소룩 → eligible', c.eligible === true && c.reason === 'ok' && c.periodEnd === yearly.current_period_end);
  c = await W.checkFeeWaiver(fakeDb([yearly], [{ id: 'x', created_at: '2026-09-05T00:00:00Z' }]), 'u1', 'paid_few_looks');
  ok('같은 구독 연도에 이미 씀 → already_used + usedAt', c.eligible === false && c.reason === 'already_used' && c.usedAt === '2026-09-05T00:00:00Z');
  c = await W.checkFeeWaiver(fakeDb([yearly], []), 'u1', 'branded');
  ok('브랜디드(€790) → type_not_waivable', c.eligible === false && c.reason === 'type_not_waivable');
  c = await W.checkFeeWaiver(fakeDb([{ plan: 'premium_monthly', billing_cycle: 'monthly', status: 'active' }], []), 'u1', 'paid_few_looks');
  ok('월간 프리미엄 → not_yearly_premium', c.eligible === false && c.reason === 'not_yearly_premium');
  c = await W.checkFeeWaiver(fakeDb([yearly], []), 'u1');
  ok('유형 없이 물으면 자격만(폼 안내용) → eligible', c.eligible === true);
  const rec = W.waiverRecord(c);
  ok('waiverRecord: plan·periodStart·amountCents 38000·at', rec.plan === 'premium_yearly' && rec.periodStart === yearly.current_period_start && rec.amountCents === 38000 && !!rec.at);

  console.log('\n=== 6. 서버 배선 ===');
  const idx = read('api/submissions/index.js');
  ok('POST: €380 유형일 때만 checkFeeWaiver, 자격 있으면 _feeWaiver', /if \(feeForType\(submissionType\) === 38000\) \{[\s\S]{0,200}checkFeeWaiver\(supabaseAdmin, user\.id, submissionType\)/.test(idx));
  ok('payment_status: 면제면 waived, 아니면 종전 규칙', /payment_status: _feeWaiver \? WAIVED_STATUS : \(feeForType\(submissionType\) \? 'awaiting_authorization' : 'none'\)/.test(idx));
  ok('description.feeWaiver 기록 + 응답 feeWaived + 텔레그램(await)', /feeWaiver: _feeWaiver \? waiverRecord\(_feeWaiver\) : null/.test(idx) && /json\(\{ submission, feeWaived: !!_feeWaiver \}\)/.test(idx) && /await sendTextToTelegramSafe\('🎁 연간 프리미엄 €380 면제 적용/.test(idx));
  ok('GET /api/submissions/fee-waiver 가 같은 lib 로 답한다', /checkFeeWaiver\(supabaseAdmin, user\.id\)/.test(read('api/submissions/fee-waiver.js')) && /requireAuth\(req, res\)/.test(read('api/submissions/fee-waiver.js')));
  const rv = read('api/submissions/[id]/review.js');
  ok('review.js: 승인 게이트는 awaiting_authorization 만 막는다(waived 통과)', /String\(prevPaymentStatus\) === 'awaiting_authorization'/.test(rv) && !/prevPaymentStatus\) === 'waived'/.test(rv));
  ok('review.js: waived 면 승인 메일에 결제 블록 없음(feeCents null)', /status === 'approved' && String\(submission\.payment_status \|\| ''\) !== 'waived'/.test(rv));
  ok('settleAuthorization: 승인 id 없으면 skip → waived 건에 청구 없음', /if \(!authId\) return \{ skipped: 'no_authorization' \}/.test(read('api/_lib/settleAuthorization.js')));
  ok('관리자 목록 필터는 waived 를 숨기지 않는다', /payment_status\.not\.in\.\(awaiting_authorization,awaiting_payment\)/.test(idx));

  console.log('\n=== 6. 프론트 ===');
  const sub = read('frontend/submission.html');
  ok('폼: 로그인 후 /api/submissions/fee-waiver 조회 → window._papFeeWaiver', /_loadFeeWaiver\(\);/.test(sub) && /fetch\('\/api\/submissions\/fee-waiver'/.test(sub));
  ok('폼: 서버가 feeWaived 면 PayPal 승인 건너뜀', /_created\.feeWaived === true \|\| \(_created\.submission && _created\.submission\.payment_status === 'waived'\)\)\) _needsAuth = false/.test(sub));
  const consent = read('frontend/pap-submission-fee-consent.js');
  ok('동의 모달: 소룩 + 자격 → 면제 모달(취소선 €380 → €0, 면제 동의문)', /waived = r\.submissionType === 'paid_few_looks' && !!\(window\._papFeeWaiver && window\._papFeeWaiver\.eligible\)/.test(consent) && /<s style="color:rgba\(255,255,255,\.4\)">' \+ esc\(fee\) \+ '<\/s> €0/.test(consent) && /waived \? t\('waivedAgree'\)/.test(consent));
  ok('동의 모달 문구 waivedTitle/Body/Agree 9개 언어', LANGS.every((l) => new RegExp('\\n    ' + l + ': \\{[\\s\\S]*?waivedTitle: \'[^\\n]+\',\\n      waivedBody: \'[^\\n]+\',\\n      waivedAgree: \'[^\\n]+\',').test(consent)));
  const fee = read('frontend/pap-submission-fee.js');
  ok('결제 모듈: waived → 면제 안내 박스(결제 버튼 없음), 9개 언어', /if\(paymentStatus==='waived'\)\{/.test(fee) && LANGS.every((l) => new RegExp('\\n  ' + l + ":\\{ payAuthorizedOk:'[^\\n]*payBaseWaived:'[^']+', payBaseWaivedHint:'[^']+'").test(fee)));
  const mp = read('frontend/mypage.html');
  ok('마이페이지: waived 는 payment_required 가 아니다', /s\.payment_status !== 'paid' && s\.payment_status !== 'waived'\) return 'payment_required'/.test(mp));
  const adm = read('frontend/pap-admin.js');
  ok('관리자: waived 배지 + 미결제 판정 4곳에서 waived 제외', /paymentStatus==='waived'/.test(adm) && (adm.match(/payment_status ?!== ?'waived'/g) || []).length >= 4);
  ok('캐시버스트: fee v9 · consent v5 · admin 158', /pap-submission-fee\.js\?v=9/.test(sub) && /pap-submission-fee\.js\?v=9/.test(mp) && /pap-submission-fee-consent\.js\?v=5/.test(sub) && /pap-admin\.js\?v=158/.test(read('frontend/admin.html')));

  console.log('\n=== 1. 심사 우선권 — premiumReviewSla ===');
  const S = require(path.join(ROOT, 'api', '_lib', 'premiumReviewSla'));
  ok('상수: 프리미엄 2 · 일반 7 영업일', S.PREMIUM_REVIEW_BUSINESS_DAYS === 2 && S.STANDARD_REVIEW_BUSINESS_DAYS === 7);
  const fri = '2026-09-11T10:00:00Z';   // 금요일
  ok('금→월 = 1영업일, 금→화 = 2, 금→수 = 3', S.businessDaysBetween(fri, '2026-09-14T09:00:00Z') === 1 && S.businessDaysBetween(fri, '2026-09-15T09:00:00Z') === 2 && S.businessDaysBetween(fri, '2026-09-16T09:00:00Z') === 3);
  ok('같은 날·주말 경과 → 0', S.businessDaysBetween(fri, fri) === 0 && S.businessDaysBetween(fri, '2026-09-13T23:00:00Z') === 0);
  ok('금요일 제출 → 2영업일 마감은 화요일', S.businessDeadline(fri, 2).toISOString().slice(0, 10) === '2026-09-15');
  ok('isPremiumOverdue: 화요일까지 아니오, 수요일부터 예', !S.isPremiumOverdue(fri, '2026-09-15T23:00:00Z') && S.isPremiumOverdue(fri, '2026-09-16T01:00:00Z'));
  const at = S.premiumSubmissionAlertText({ id: 'abc', title: 'T', created_at: fri }, 'Kate');
  ok('접수 알림 문구: ⭐ 프리미엄 · 마감일 · submission id', /⭐ 프리미엄 회원 서브미션/.test(at) && /결과 마감: 2026-09-15/.test(at) && /submission=abc/.test(at));
  ok('초과 목록 문구', /SLA 초과 1건/.test(S.overdueAlertText([{ id: 'a', title: 'T', created_at: fri }], '2026-09-17T00:00:00Z')) && S.overdueAlertText([], Date.now()) === '');
  ok('POST: 프리미엄 제출 시 우선 심사 텔레그램(await)', /if \(_isPremium\) \{[\s\S]{0,120}await sendTextToTelegramSafe\(premiumSubmissionAlertText\(submission/.test(idx));
  ok('접수 메일: 프리미엄은 2영업일 ETA', /templates\.submissionReceived\([\s\S]{0,120}\{ isPremium: _isPremium \}\)/.test(idx));

  console.log('\n=== 1. SLA 크론 ===');
  const Module = require('module'); const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (/\/supabase$/.test(req) || req === '@supabase/supabase-js') return { supabaseAdmin: {} };
    if (/\/telegram$/.test(req)) return { sendTextToTelegramSafe: async () => {} };
    return origLoad.call(this, req, ...rest);
  };
  let cron; try { cron = require(path.join(ROOT, 'api', 'cron', 'premium-review-sla')); } finally { Module._load = origLoad; }
  const now = Date.parse('2026-09-17T00:00:00Z');
  const rows = [
    { id: 'p1', user_id: 'prem', title: 'A', status: 'pending', payment_status: 'none', created_at: fri },
    { id: 'p2', user_id: 'prem', title: 'B', status: 'pending', payment_status: 'awaiting_authorization', created_at: fri },
    { id: 'p3', user_id: 'free', title: 'C', status: 'pending', payment_status: 'none', created_at: fri },
    { id: 'p4', user_id: 'prem', title: 'D', status: 'approved', payment_status: 'none', created_at: fri },
    { id: 'p5', user_id: 'prem', title: 'E', status: 'pending', payment_status: 'none', created_at: '2026-09-16T10:00:00Z' },
  ];
  const profs = { prem: { email: 'k@x', subscription_plan: 'premium', subscription_status: 'active' }, free: { subscription_plan: 'free', subscription_status: 'inactive' } };
  const od = cron.pickOverdue(rows, profs, now);
  ok('크론: 프리미엄 + pending + 결제 승인 대기 아님 + 2영업일 초과 → 1건(p1)', od.length === 1 && od[0].id === 'p1' && od[0].label === 'k@x');
  ok('vercel.json 에 매일 09:30 KST 크론', /"path": "\/api\/cron\/premium-review-sla",\n\s+"schedule": "30 0 \* \* \*"/.test(read('vercel.json')));
  ok('크론: CRON_SECRET safeEqual + withCronGuard + reportProduction', /withCronGuard\(CRON_NAME/.test(read('api/cron/premium-review-sla.js')) && /safeEqual\(got, expected\)/.test(read('api/cron/premium-review-sla.js')) && /reportProduction\(res/.test(read('api/cron/premium-review-sla.js')));

  console.log('\n=== 1. 문구 통일 (7영업일 / 프리미엄 2영업일) ===');
  ok('submission.html reviewNoteBlock 9개 언어에 "7" + "2"', (sub.match(/reviewNoteBlock:'[^']*7[^']*2[^']*'/g) || []).length === 9);
  ok('submission.html 에 옛 "1-3 business days" 없음', !/1-3 business days|영업일 기준 1-3일|1–3 business days/.test(sub));
  const land = read('frontend/submissions.html');
  ok('submissions 랜딩·JSON-LD·OG 에 옛 1–3 없음, 7영업일 + Premium 2', !/1–3 business days/.test(land) && /7 business days \(Premium/.test(land) && /심사는 최대 7영업일\(프리미엄 회원은 2영업일 이내\)/.test(land));
  ok('submissions 사전 8개 언어 키 갱신', ['en','de','it','fr','es','ja','zh','ru'].every((l) => Object.keys(JSON.parse(read('frontend/i18n/ui/submissions.' + l + '.json'))).some((k) => k.includes('심사는 최대 7영업일(프리미엄 회원은 2영업일 이내).'))) && /content="submissions" data-v="6"/.test(land));
  const em = read('api/_lib/email.js');
  ok('접수 메일 etaValue(최대 7) + etaValuePremium(2) 9개 언어', (em.match(/etaValuePremium: '/g) || []).length === 9 && !/etaValue: '1–3|etaValue: '영업일 1~3일'/.test(em));
  const E = require(path.join(ROOT, 'api', '_lib', 'email'));
  ok('submissionReceived(isPremium) → 2영업일 문구, 아니면 최대 7영업일', /2영업일 이내/.test(E.templates.submissionReceived({ name: 'A' }, { title: 'T' }, 'ko', { isPremium: true }).html) && /최대 7영업일/.test(E.templates.submissionReceived({ name: 'A' }, { title: 'T' }, 'ko').html));

  console.log('\n=== 3. 인스타그램 피드 + 스토리 보장 ===');
  const ed = read('api/editorials/[id].js');
  ok('첫 공개(becomingPublished) 시 프리미엄 제출자면 텔레그램(await) — hasActivePlan 판정', /if \(becomingPublished\) \{[\s\S]{0,1500}hasActivePlan\(_prof, 'premium'\)[\s\S]{0,200}await sendTextToTelegramSafe\(premiumPublishAlertText\(data, _prof\)\)/.test(ed));
  const PA = require(path.join(ROOT, 'api', '_lib', 'premiumPublishAlert'));
  const txt = PA.premiumPublishAlertText({ title: 'X', slug: 'x-y' }, { instagram: 'kate', display_name: 'Kate' });
  ok('알림 문구: 피드 + 스토리 · 릴스 제외 · 페이지 링크 · @핸들', /피드 \+ 스토리/.test(txt) && /릴스는 보장 대상 아님/.test(txt) && /\/editorial\/x-y/.test(txt) && /@kate/.test(txt));
  ok('가이드라인 절차: "모든 에디토리얼 IG 게시" → 프리미엄 보장/그 외 재량 (9개 언어)', !/모든 에디토리얼은 인스타그램에도 게시됩니다|Every editorial is also posted on Instagram/.test(sub) && (sub.match(/glProcBody:'(?:\\.|[^'])*?(피드 \+ 스토리|feed post \+ story|Feed-Post \+ Story|feed \+ storia|feed \+ story|feed \+ historia|フィード投稿＋ストーリーズ|动态＋快拍|ленте \+ сторис)/g) || []).length === 9);

  console.log('\n=== 5. 크리에이터 공개 프로필 ===');
  const CP = require(path.join(ROOT, 'api', '_lib', 'contributorProfile'));   // 9999a3d 회귀: 여기서 SyntaxError 면 실패
  ok('contributorProfile 모듈이 require 된다(9999a3d 줄바꿈 회귀)', typeof CP.pageShell === 'function' && /<script src="\/pap-profile-prompt\.js\?v=1" defer><\/script>/.test(CP.pageShell('t', 'd', 'https://x', {}, '')));
  ok('MIN_EDITORIALS 2 · 프리미엄 1', CP.MIN_EDITORIALS === 2 && CP.MIN_EDITORIALS_PREMIUM === 1);
  ok('locationLabel: 도시 + 국가 이름', CP.locationLabel({ activity_city: 'Hamburg', activity_country: 'DE' }) === 'Hamburg, Germany' && CP.locationLabel({}) === '');
  const ch = CP.contactHtml('kate');
  ok('연락 버튼 HTML: data-handle · 숨긴 안내 span 5개 · /api/contributors/contact POST · 로그인 없으면 /auth?next=', /data-handle="kate"/.test(ch) && (ch.match(/<span hidden id="pcT-/g) || []).length === 5 && /fetch\("\/api\/contributors\/contact",\{method:"POST"/.test(ch) && /\/auth\?next=/.test(ch));
  ok('배지 HTML 은 translate="no"', /class="pbadge" translate="no"/.test(CP.premiumBadgeHtml()));
  const hp = read('api/seo/contributor/[handle].js');
  ok('프로필 페이지: 프리미엄이면 관문 1편 · 배지 · 활동 지역 · 전체 화보 · 연락 버튼', /const minEds = premium \? MIN_EDITORIALS_PREMIUM : MIN_EDITORIALS/.test(hp) && /premium \? premiumBadgeHtml\(\) : ''/.test(hp) && /활동 지역 · ' \+ escText\(loc\)/.test(hp) && /const shown = premium \? eds : eds\.slice\(0, 30\)/.test(hp) && /premium \? contactHtml\(handle\) : ''/.test(hp));
  Module._load = function (req, ...rest) {
    if (/\/supabase$/.test(req) || req === '@supabase/supabase-js') return { supabaseAdmin: {} };
    return origLoad.call(this, req, ...rest);
  };
  let cl; try { cl = require(path.join(ROOT, 'api', 'seo', 'contributors')); } finally { Module._load = origLoad; }
  const merged = cl.mergeRows(
    [{ handle: 'a', count: 5, latest: '2026-01-01' }, { handle: 'b', count: 3, latest: '2026-02-01' }],
    { b: { activity_city: 'Milan', activity_country: 'IT' }, c: { activity_city: 'Seoul', activity_country: 'KR' } },
    [{ handle: 'c', count: 1, latest: '2026-03-01' }, { handle: 'd', count: 1, latest: '2026-03-01' }]);
  ok('목록 병합: 프리미엄(b, c) 맨 위(편수순) · 비프리미엄 1편(d)은 제외 · 위치 표시', merged.map((r) => r.handle).join(',') === 'b,c,a' && merged[0].premium && merged[0].location === 'Milan, Italy' && !merged[2].premium);
  ok('목록 페이지: contributor_counts RPC 로 프리미엄 1편 기여자 채움 + 배지', /rpc\('contributor_counts', \{ p_handles: missing \}\)/.test(read('api/seo/contributors.js')) && /pbadge-s/.test(read('api/seo/contributors.js')));
  const mig = read('supabase_migrations/155_contributor_premium_profile.sql');
  ok('마이그레이션 155: contributor_contacts 표 + contributor_counts 함수', /create table if not exists public\.contributor_contacts/.test(mig) && /create or replace function public\.contributor_counts\(p_handles text\[\]\)/.test(mig));
  Module._load = function (req, ...rest) {
    if (/\/supabase$/.test(req) || req === '@supabase/supabase-js') return { supabaseAdmin: {} };
    if (/\/telegram$/.test(req)) return { sendTextToTelegramSafe: async () => {} };
    if (/\/auth$/.test(req)) return { requireAuthStrict: async () => null, requireAuth: () => null };
    if (/\/rateLimit$/.test(req)) return { rateLimit: () => false, RATE_LIMITS: { api: {} } };   // setInterval 이 프로세스를 붙잡는다
    if (/\/email$/.test(req)) return { sendEmail: async () => ({ sent: true }), templates: {} };
    return origLoad.call(this, req, ...rest);
  };
  let CT; try { CT = require(path.join(ROOT, 'api', 'contributors', 'contact')); } finally { Module._load = origLoad; }
  ok('contact: 제어문자 제거 · 2000자 컷 · 하루 3건', CT.cleanMessage('a bc ') === 'abc' && CT.cleanMessage('x'.repeat(3000)).length === 2000 && CT.DAILY_LIMIT === 3);
  const cs = read('api/contributors/contact.js');
  ok('contact: requireAuthStrict · 프리미엄 크리에이터만(findPremiumCreator) · 자기 자신 금지 · 429 · 메일 await · 502 on fail', /requireAuthStrict\(req, res\)/.test(cs) && /findPremiumCreator\(supabaseAdmin, handle\)/.test(cs) && /creator\.id === user\.id/.test(cs) && /status\(429\)/.test(cs) && /await sendEmail\(creator\.email, tpl\)/.test(cs) && /status\(502\)/.test(cs));
  const ct = E.templates.contributorContact({ name: 'K' }, { name: 'Dom', email: 'd@x.com' }, 'kate', '<b>hi</b> there', 'en');
  ok('전달 메일: replyTo = 보낸 회원, 본문 이스케이프, 9개 언어 사전', ct.replyTo === 'd@x.com' && /&lt;b&gt;hi&lt;\/b&gt;/.test(ct.html) && (em.match(/^  (ko|en|it|fr|es|ja|zh|ru|de): \{ subject: '[^\n]*협업 문의|^  (ko|en|it|fr|es|ja|zh|ru|de): \{ subject: '[^\n]*(inquiry|collaborazione|collaboration|colaboración|コラボ|合作|сотрудничестве|Kooperationsanfrage)/gm) || []).length === 9);
  ok('sendEmail 이 template.replyTo 를 넘긴다', /template\.replyTo \? \{ replyTo: template\.replyTo \} : \{\}/.test(em));
  ok('contributors 사전 8개 언어에 새 키(연락하기·활동 지역 …)', ['en','de','it','fr','es','ja','zh','ru'].every((l) => { const d = JSON.parse(read('frontend/i18n/ui/contributors.' + l + '.json')); return ['연락하기','활동 지역 · {0}','메시지 보내기','로그인 후 보낼 수 있습니다.','PAP 프리미엄 크리에이터는 첫 화보부터 인증 배지와 함께 맨 위에 오른다.'].every((k) => !!d[k]); }) && /content="contributors" data-v="5"/.test(read('api/_lib/contributorProfile.js')));

  console.log('\n=== 8. 승인 메일 프리미엄 업셀 ===');
  const ap = E.templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'ko', 'approved', { isPremium: false }).html;
  ok('승인 + 비프리미엄 → 업셀 블록(utm premium_upsell) + 혜택 4줄', /utm_campaign=premium_upsell/.test(ap) && /우선 심사/.test(ap) && /피드 \+ 스토리/.test(ap) && /인증 크리에이터 프로필/.test(ap) && /€380/.test(ap));
  ok('미적용 장치(성과 숫자·재도전권·에디터스 픽)는 안 쓴다', !/성과|재도전|에디터스 픽|조회수/.test(ap));
  ok('프리미엄 수신자 · 거절 · 보완 메일에는 없음', !/premium_upsell/.test(E.templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'ko', 'approved', { isPremium: true }).html) && !/premium_upsell/.test(E.templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'ko', 'rejected', {}).html) && !/premium_upsell/.test(E.templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'ko', 'revision', {}).html));
  ok('업셀 문구 9개 언어(upTitle…upCta)', (em.match(/    upCta: '/g) || []).length === 9 && LANGS.every((l) => /premium_upsell/.test(E.templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, l, 'approved', {}).html)));
  ok('review.js 가 수신자 등급(hasActivePlan)을 isPremium 으로 넘긴다', /const _recipientPremium = hasActivePlan\(profile, 'premium'\)/.test(rv) && /isPremium: _recipientPremium/.test(rv));
  ok('편집기 재발송 경로도 isPremium 전달 + waived 는 결제 블록 없음', /isPremium: hasActivePlan\(profile, 'premium'\)/.test(ed) && /submission\.payment_status !== 'waived'/.test(ed));

  console.log('\n=== /subscribe · 가이드라인 문구 (9개 언어) ===');
  const sb = read('frontend/subscribe.html');
  ok('/subscribe 프리미엄 카드 4줄 × 10블록(ru 중복 포함)', (sb.match(/€380\)? ?1회 면제|\(€380\) waived|\(€380\) без оплаты|\(€380\) erlassen|\(€380\) esonerata|\(€380\) offerte|\(€380\) exenta|€380）1回免除|€380）/g) || []).length >= 10);
  ok('/subscribe 비교표: 심사 결과 · 인스타그램 게시 · 인증 프로필 · €380 면제 (ko)', /\['심사 결과','최대 7영업일','최대 7영업일','2영업일 이내'\]/.test(sb) && /\['인스타그램 게시','에디터 재량','에디터 재량','피드 \+ 스토리 보장'\]/.test(sb) && /\['PAP 인증 크리에이터 프로필',false,false,true\]/.test(sb) && /\['연간 결제 시 유료 서브미션\(€380\) 1회 면제',false,false,true\]/.test(sb));
  ok('가이드라인 혜택 섹션 glAddBody: 6줄 × 9개 언어', (sub.match(/glAddBody:'<ul>(?:<li>[^<]*<\/li>){6}<\/ul>'/g) || []).length === 9);
  ok('가이드라인·업셀에 "커버 이미지" 혜택은 안 쓴다(도메니코 9/12)', !/glAddBody:'[^']*(커버 이미지|cover image)/i.test(sub) && !/upB\d: '[^']*(커버|cover)/i.test(em));

  console.log('\npassed: ' + passed + '   failed: ' + failed);
  if (failed) { console.error('❌ premium-growth-devices tests FAILED'); process.exit(1); }
  console.log('✅ premium-growth-devices tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
