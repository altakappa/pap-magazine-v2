/**
 * 크리에이터 풀레터 소개 캠페인 (2026-08-26 신설 — 유료 구독자 늘리기 1탄-②)
 *
 * [근거 실측] 유료 활성 9명 전원이 크리에이터. 서브미션 제출자 121명 중
 * 무료가 119명 — 가장 가까운 전환 후보다. 이들에게만 풀레터 제도를
 * 소개하는 캠페인 타입 'creator-pullletter' 를 신설했다.
 *
 * 지키는 것:
 *  ① 발송기가 타입을 안다 — 모르는 타입은 throw 이므로 매핑 누락 = 발송 불가
 *  ② audience='submitters_free' 세그먼트가 있다 — 제출자 ∩ 무료만.
 *     유료 회원에게 구독 권유를 보내면 안 되고, 미제출자에게 "제출해
 *     주셔서" 라고 거짓말하면 안 된다
 *  ③ 모르는 audience 는 전체 발송으로 새지 않고 실패한다
 *  ④ 메일에 수신거부 링크·utm 이 있고, 약속은 실제 혜택만
 *     (풀레터 월 1건 — subscribe 페이지와 일치)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

console.log('creator-pullletter-campaign');

const CRON = R('api/cron/send-due-campaigns.js');
const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));

t('발송기가 creator-pullletter 타입을 templates.creatorPullletter 로 매핑한다', () => {
  assert.ok(/creator-pullletter/.test(CRON), '타입 매핑이 없다');
  assert.ok(/templates\.creatorPullletter/.test(CRON), '템플릿 참조가 없다');
});

t('submitters_free 세그먼트: 제출자 판정 + 무료 판정(hasActivePlan) 둘 다 본다', () => {
  assert.ok(/submitters_free/.test(CRON), 'audience 분기가 없다');
  assert.ok(/from\('submissions'\)/.test(CRON), '제출자 조회가 없다');
  assert.ok(/hasActivePlan\(r, 'standard'\)/.test(CRON), '유료 회원 제외가 없다');
  assert.ok(/subscription_plan, subscription_status/.test(CRON),
    'hasActivePlan 이 볼 컬럼(plan·status)을 select 하지 않는다');
});

t('모르는 audience 값은 전체 발송으로 새지 않고 throw 한다', () => {
  assert.ok(/Unknown campaign audience/.test(CRON), '가드가 없다');
});

t('템플릿(ko): 수신거부 토큰·utm·실제 혜택 문구가 렌더된다', () => {
  const out = templates.creatorPullletter(
    { subject: null, preheader: null, payload: {} },
    { language: 'ko', name: '테스트' },
    'TOKTEST'
  );
  assert.ok(out.subject && out.html, '렌더 실패');
  assert.ok(out.html.includes('unsubscribe?token=TOKTEST'), '수신거부 링크가 없다');
  assert.ok(out.html.includes('utm_source=creator_pullletter_campaign'), 'utm 이 없다');
  assert.ok(/월 1건/.test(out.html), '혜택이 subscribe 페이지 약속(월 1건)과 안 맞는다');
  assert.ok(/2개월/.test(out.html), '유효기간(2개월) 안내가 없다');
});

t('가입 유도가 전면에 나서지 않는다 — 주 CTA는 마이페이지, 멤버십은 각주 1회', () => {
  // 2026-08-26 도메니코 지시: "회원 가입하라는 의도가 적나라하게
  // 드러나지 않으면 좋겠어". 주 CTA는 실제 신청 위치(마이페이지 풀레터
  // 섹션)로 가고, subscribe 링크는 하단 각주에 정확히 1회만 존재한다.
  // 각주에는 프리미엄 요건이 명시돼 낚시가 되지 않는다.
  const out = templates.creatorPullletter({ payload: {} }, { language: 'ko' }, 'T');
  assert.ok(out.html.includes('/mypage?utm_source=creator_pullletter_campaign&utm_medium=email#mp-pullletters'),
    '주 CTA가 마이페이지 풀레터 섹션이 아니다');
  const subLinks = out.html.split('subscribe?utm_source=creator_pullletter_campaign').length - 1;
  assert.strictEqual(subLinks, 1, 'subscribe 링크가 ' + subLinks + '회 — 각주 1회여야 한다');
  assert.ok(/프리미엄 멤버십에 포함/.test(out.html), '각주에 프리미엄 요건 명시가 없다 (낚시 방지)');
});

t('템플릿(en + 비지원 언어 폴백): en 카피로 렌더된다', () => {
  const en = templates.creatorPullletter({}, { language: 'en' }, 'T1');
  assert.ok(/one request per month/.test(en.html), 'en 각주(월 1건) 문구가 없다');
  const ja = templates.creatorPullletter({}, { language: 'ja' }, 'T2');
  assert.ok(/one request per month/.test(ja.html), 'ja → en 폴백이 안 된다');
});

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
