'use strict';
/**
 * 모든 회원 메일은 받는 사람 언어 하나로 (2026-09-25, 도메니코 "각자의 언어로 전달되야 하는건 알고있찌?").
 * 전수 점검에서 나온 것:
 *   · 모든 메일 바닥: "FOLLOW @PAP_MAGAZINE" · "All rights reserved." · "PAP Magazine — Instagram" (9개 언어 전부 영어)
 *   · 주간 에디토리얼: THIS WEEK'S EDITORIALS · VIEW MORE ON PAP
 *   · 풀레터 소개 캠페인: ko·en 만 있어 나머지 7개 언어는 메일 전체가 영어
 *   · 월간 크리에이터 소식: FOR CREATIVE TEAMS · (5개 언어) Creator News
 *   · 본문의 사이트 메뉴 이름이 영어(MY SUBMISSIONS · PULL-LETTERS · My Page) → 사이트 화면 글자와 달라 못 찾는다
 *   · 한국어 메일의 "Pull-Letter" (사이트 표기는 풀레터)
 *   · 인증번호 메일: 한국어·영어 병기
 * 24개 템플릿 × 9개 언어를 실제로 그려서 확인한다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 400) : '')); } }

const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));
const { MAIL_CHROME } = require(path.join(ROOT, 'api/_lib/weeklyNewsCopy.js'));
const user = { id: 'u1', name: 'Mina', display_name: 'Mina', email: 'a@b.c', username: 'mina', subscription_plan: 'standard' };
const sub = { id: 's1', title: 'Sample Story', category: 'fashion', status: 'approved', slug: 'sample-story' };
const camp = { name: 'c1', type: 'x', subject: 'S', preheader: 'P', hero_headline: 'H', hero_body: 'B', scheduled_at: '2026-09-27T23:00:00Z', payload: { newsItems: [] } };
const U = (l) => Object.assign({}, user, { language: l });
const CALLS = {
  welcome: (l) => templates.welcome(user, l),
  submissionReceived: (l) => templates.submissionReceived(user, sub, l, {}),
  submissionReviewComplete: (l) => templates.submissionReviewComplete(user, sub, l, 'approved', {}),
  submissionApproved: (l) => templates.submissionApproved(user, sub, '', l, {}),
  submissionRejected: (l) => templates.submissionRejected(user, sub, '', l, {}),
  submissionRevision: (l) => templates.submissionRevision(user, sub, 'note', l, {}),
  pullletterReceived: (l) => templates.pullletterReceived(user, l),
  pullletterAccepted: (l) => templates.pullletterAccepted(user, 'note', l),
  pullletterRejected: (l) => templates.pullletterRejected(user, 'note', l),
  pullletterIssued: (l) => templates.pullletterIssued(user, 'note', l, {}),
  contributorContact: (l) => templates.contributorContact(user, { name: 'Sender', email: 's@x.y' }, 'handle', 'hello', l),
  pullletterEditorialReminder: (l) => templates.pullletterEditorialReminder(user, l),
  pullletterRevision: (l) => templates.pullletterRevision(user, 'note', l),
  pullletterTeamNotice: (l) => templates.pullletterTeamNotice(user, { requester: 'Jin', title: 'Blue', role: 'stylist', id: 'x' }, l),
  editorialLive: (l) => templates.editorialLive(user, { title: 'Blue', url: 'https://www.pap-magazine.com/editorial/blue' }, l),
  subscriptionConfirmed: (l) => templates.subscriptionConfirmed(user, 'standard', l),
  trialEndingSoon: (l) => templates.trialEndingSoon(user, { lang: l, language: l, endsAt: '2026-10-01' }),
  weeklyEditorial: (l) => templates.weeklyEditorial(camp, U(l), 'tok'),
  weeklyNews: (l) => templates.weeklyNews(camp, U(l), 'tok'),
  newsletterConfirm: (l) => templates.newsletterConfirm({ lang: l, confirmUrl: 'https://x/c' }),
  newsletterWelcome: (l) => templates.newsletterWelcome({ lang: l, unsubUrl: 'https://x/u' }),
  creatorMonthly: (l) => templates.creatorMonthly(camp, U(l), 'tok'),
  creatorPullletter: (l) => templates.creatorPullletter(camp, U(l), 'tok'),
  creatorReportCard: (l) => templates.creatorReportCard({ title: 'Sample Story', name: 'Mina', date: '2026-09-20', ig: { reach: 1200, likes: 80, saves: 10, shares: 5 } }, l),
};
const vis = (h) => String(h || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&middot;/g, '·').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');
// 영어 틀 문구 (en 이 아닌 메일에 나오면 섞인 것)
const BANNED = ['FOLLOW @', 'All rights reserved', 'PAP Magazine — Instagram', "THIS WEEK'S EDITORIALS", 'VIEW MORE', 'FOR CREATIVE TEAMS',
  'HOW IT WORKS', 'Creator News', 'MY SUBMISSIONS', 'My Page', 'PULL-LETTERS', 'THIS WEEK ON PAP', 'TREND BRIEFING', 'ART · FASHION'];
const KO_BANNED = ['Pull-Letter', 'Pull Letter'];

console.log('=== 1. 템플릿 22개 × 9개 언어 ===');
t('템플릿 목록이 전부 검사 대상 (새 템플릿이 생기면 여기 추가)', Object.keys(templates).every((k) => CALLS[k]), Object.keys(templates).filter((k) => !CALLS[k]).join(','));
const errs = [], mixed = [];
for (const [k, fn] of Object.entries(CALLS)) {
  for (const l of LANGS) {
    let r;
    try { r = fn(l); } catch (e) { errs.push(k + '/' + l + ': ' + e.message); continue; }
    const txt = vis(r.subject) + ' || ' + vis(r.html);
    if (l === 'en') continue;
    BANNED.forEach((b) => { if (txt.includes(b)) mixed.push(k + '/' + l + ': ' + b); });
    if (l === 'ko') KO_BANNED.forEach((b) => { if (txt.includes(b)) mixed.push(k + '/ko: ' + b); });
  }
}
t('216개 조합 모두 그려진다 (에러 0)', errs.length === 0, errs.join(' | '));
t('en 이 아닌 192개 메일에 영어 틀 문구 0개', mixed.length === 0, mixed.slice(0, 20).join(' | '));
{
  const ko = CALLS.subscriptionConfirmed('ko');
  t('공통 바닥 (ko): 인스타 팔로우 · 저작권 줄이 한국어', vis(ko.html).includes('@PAP_MAGAZINE 팔로우') && vis(ko.html).includes('모든 권리 보유.') && vis(ko.html).includes('PAP 매거진 인스타그램'));
  const en = CALLS.subscriptionConfirmed('en');
  t('영어 메일은 영어 그대로', vis(en.html).includes('FOLLOW @PAP_MAGAZINE') && vis(en.html).includes('All rights reserved.'));
  const pl = LANGS.map((l) => CALLS.creatorPullletter(l).subject);
  t('풀레터 소개: 9개 언어가 모두 다른 제목 (영어 폴백 없음)', new Set(pl).size === 9, pl.join(' | '));
  t('풀레터 소개 (ko): 풀레터 · 진행 방식', vis(CALLS.creatorPullletter('ko').html).includes('PAP 공식 풀레터를 소개합니다') && vis(CALLS.creatorPullletter('ko').html).includes('진행 방식'));
  const mo = LANGS.map((l) => CALLS.creatorMonthly(l).subject);
  t('월간 크리에이터 소식: en 만 Creator News', mo.filter((s) => /Creator News/.test(s)).length === 1 && /Creator News/.test(CALLS.creatorMonthly('en').subject), mo.join(' | '));
}

console.log('\n=== 2. 사이트 메뉴 이름이 사이트 화면과 같다 ===');
{
  const sub = R('frontend/submission.html'), my = R('frontend/mypage.html');
  const mySubs = [...sub.matchAll(/mySubsTitle:'([^']+)'/g)].map((m) => m[1]);
  const tabs = [...my.matchAll(/navSubmissions:'([^']+)'/g)].map((m) => m[1]);
  const pages = [...R('frontend/pap-auth.js').matchAll(/mypage:'([^']+)'/g)].map((m) => m[1].toLowerCase());   // 사이트 상단 메뉴
  t('메일의 "내 서브미션" 이름 9개 = 서브미션 화면 mySubsTitle', LANGS.every((l) => mySubs.includes(MAIL_CHROME[l].mySubs)), LANGS.filter((l) => !mySubs.includes(MAIL_CHROME[l].mySubs)).join(','));
  t('메일의 업로드 탭 이름 = 마이페이지 navSubmissions', LANGS.every((l) => tabs.includes(MAIL_CHROME[l].subsTab)));
  t('메일의 마이페이지 이름 = 마이페이지 제목 (대소문자 무시)', LANGS.every((l) => pages.includes(MAIL_CHROME[l].myPage.toLowerCase())), LANGS.filter((l) => !pages.includes(MAIL_CHROME[l].myPage.toLowerCase())).join(','));
  t('한국어 풀레터 탭 = 사이트 "풀레터"', /navPullletters:'풀레터'/.test(my) && MAIL_CHROME.ko.plTab === '풀레터');
  const koApproved = vis(CALLS.submissionApproved('ko').html);
  t('승인 메일 (ko): "내 서브미션에서 확인"', koApproved.includes('내 서브미션'));
  t('4주 알림 (it): La mia pagina → PULL-LETTER', vis(CALLS.pullletterEditorialReminder('it').html).includes('La mia pagina → PULL-LETTER'));
}

console.log('\n=== 3. 인증번호 메일 ===');
{
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test';
  const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
  stub('api/_lib/rateLimit.js', { rateLimitStrict: async () => false, rateLimitAccount: async () => false, RATE_LIMITS: { auth: {} } });
  const sc = require(path.join(ROOT, 'api/auth/send-code.js'));
  t('9개 언어 문구', LANGS.every((l) => sc.CODE_COPY[l] && sc.CODE_COPY[l].subject && sc.CODE_COPY[l].expiry));
  t('언어 고르기: 화면 lang → Accept-Language → 영어', sc.pickCodeLang('ko') === 'ko' && sc.pickCodeLang(undefined, 'it-IT,it;q=0.9') === 'it' && sc.pickCodeLang('xx', 'zz') === 'en' && sc.pickCodeLang('JA-jp') === 'ja');
  const ko = sc.buildVerificationEmail('123456', 'ko'), de = sc.buildVerificationEmail('123456', 'de');
  t('한국어 메일에 영어 문장 없음 · 독일어 메일에 한국어 없음', !/Verification|Please enter|expires|All rights/.test(vis(ko.html) + ko.subject) && !/[가-힣]/.test(vis(de.html) + de.subject));
  t('코드는 그대로 보인다', vis(ko.html).includes('123456'));
  t('가입 화면이 화면 언어를 보낸다 (두 곳: 첫 발송 · 재발송)', (R('frontend/auth.html').match(/JSON\.stringify\(\{ email: email, lang: lang \}\)/g) || []).length === 2);
  t('핸들러가 lang 을 써서 만든다', /buildVerificationEmail\(code, codeLang\), \{ transactional: true \}/.test(R('api/auth/send-code.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
