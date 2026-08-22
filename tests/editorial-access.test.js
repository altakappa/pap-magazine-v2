/**
 * 에디토리얼 열람 게이트 — 2026-08-21 도메니코 결정을 코드로 못 박는다.
 *
 * 이 테스트가 지키는 것
 *   ① 비회원은 최신 화보라도 못 본다 (로그인이 첫 관문)
 *   ② FREE 는 딱 최신 10편
 *   ③ STANDARD 는 현재 볼륨 + 직전 2볼륨, 경계가 분기마다 저절로 밀린다
 *   ④ 해지·미납은 유료로 치지 않는다
 *   ⑤ 잠긴 응답에는 gallery 가 절대 실리지 않는다
 */
const assert = require('assert');
const A = require('../api/_lib/editorialAccess');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const NOW = new Date('2026-08-21T00:00:00Z');
const freeIds = new Set(['a1', 'a2']);            // '최신 10편' 대역
const 최신 = { id: 'a1', published_date: '2026-08-19', gallery: ['1.jpg', '2.jpg', '3.jpg'] };
const 올해초 = { id: 'b1', published_date: '2026-02-10', gallery: ['1.jpg'] };
const 작년 = { id: 'c1', published_date: '2025-06-10', gallery: ['1.jpg'] };
const 옛날 = { id: 'd1', published_date: '2019-08-22', gallery: ['1.jpg'] };

console.log('에디토리얼 열람 게이트');

t('볼륨 경계는 분기 시작 − 2볼륨 (오늘 = 2026-01-01)', () => {
  assert.strictEqual(A.ymd(A.standardCutoff(NOW)), '2026-01-01');
});

t('경계는 분기 1일에 저절로 밀린다 (사람 손 필요 없음)', () => {
  assert.strictEqual(A.ymd(A.standardCutoff(new Date('2026-09-30'))), '2026-01-01');
  assert.strictEqual(A.ymd(A.standardCutoff(new Date('2026-10-01'))), '2026-04-01');
  assert.strictEqual(A.ymd(A.standardCutoff(new Date('2027-01-01'))), '2026-07-01');
});

t('비회원은 최신 화보도 못 본다', () => {
  const v = A.canView('anon', 최신, { freeIds, now: NOW });
  assert.strictEqual(v.allowed, false, '비회원에게 열렸다');
  assert.strictEqual(v.reason, 'login-required');
  assert.strictEqual(v.requiredTier, 'free', '비회원에게 유료를 요구하면 가입 동선이 끊긴다');
});

t('FREE 는 최신 10편만 — 그 밖은 잠긴다', () => {
  assert.strictEqual(A.canView('free', 최신, { freeIds, now: NOW }).allowed, true);
  const v = A.canView('free', 올해초, { freeIds, now: NOW });
  assert.strictEqual(v.allowed, false);
  assert.strictEqual(v.requiredTier, 'standard', '스탠다드 구간이면 스탠다드를 요구해야 한다');
});

t('STANDARD 는 현재+직전 2볼륨, 그 이전은 프리미엄', () => {
  assert.strictEqual(A.canView('standard', 최신, { freeIds, now: NOW }).allowed, true);
  assert.strictEqual(A.canView('standard', 올해초, { freeIds, now: NOW }).allowed, true);
  const v = A.canView('standard', 작년, { freeIds, now: NOW });
  assert.strictEqual(v.allowed, false, '작년 화보가 스탠다드에게 열렸다');
  assert.strictEqual(v.requiredTier, 'premium');
});

t('PREMIUM 은 2019년 것까지 전부', () => {
  assert.strictEqual(A.canView('premium', 옛날, { freeIds, now: NOW }).allowed, true);
});

t('admin/staff 는 전부 통과', () => {
  assert.strictEqual(A.tierOf({ role: 'admin' }), 'admin');
  assert.strictEqual(A.tierOf({ role: 'staff' }), 'admin');
  assert.strictEqual(A.canView('admin', 옛날, { freeIds, now: NOW }).allowed, true);
});

t('해지·미납은 유료로 치지 않는다', () => {
  const u = { id: 'u', role: 'user' };
  assert.strictEqual(A.tierOf(u, { subscription_plan: 'premium', subscription_status: 'canceled' }), 'free');
  assert.strictEqual(A.tierOf(u, { subscription_plan: 'premium', subscription_status: 'inactive' }), 'free');
  assert.strictEqual(A.tierOf(u, { subscription_plan: 'standard', subscription_status: 'past_due' }), 'free');
  assert.strictEqual(A.tierOf(u, { subscription_plan: 'premium', subscription_status: 'active' }), 'premium');
  assert.strictEqual(A.tierOf(u, { subscription_plan: 'standard', subscription_status: 'trialing' }), 'standard');
});

t('로그인 안 한 사람은 프로필이 뭐든 비회원', () => {
  assert.strictEqual(A.tierOf(null, { subscription_plan: 'premium', subscription_status: 'active' }), 'anon');
});

t('잠긴 응답에는 gallery 가 실리지 않는다', () => {
  const v = A.canView('anon', 최신, { freeIds, now: NOW });
  const out = A.stripLocked(최신, v);
  assert.strictEqual(out.gallery, undefined, 'gallery 가 그대로 나갔다 — 게이트가 무의미해진다');
  assert.strictEqual(out.locked, true);
  assert.strictEqual(out.gallery_count, 3, '몇 장인지는 알려줘야 구독 이유가 보인다');
  assert.ok(out.cover_image === undefined || out.cover_image !== null);
  assert.strictEqual(최신.gallery.length, 3, '원본 행을 훼손하면 안 된다');
});

t('열람 가능한 행은 손대지 않는다', () => {
  const v = A.canView('premium', 최신, { freeIds, now: NOW });
  const out = A.stripLocked(최신, v);
  assert.deepStrictEqual(out.gallery, ['1.jpg', '2.jpg', '3.jpg']);
  assert.ok(!out.locked);
});

t('published_date 가 없으면 열지 않는다 (모르면 잠근다)', () => {
  const v = A.canView('standard', { id: 'x', published_date: null }, { freeIds, now: NOW });
  assert.strictEqual(v.allowed, false);
});

/* ── 광고 없는 콘텐츠 (2026-08-21) ────────────────────────────────
 * 구독 페이지가 파는 혜택인데 등급만 보고 상태를 안 봐서 해지·미납 회원도
 * 계속 광고 없이 보고 있었다. 그리고 게이트가 생기면서 '광고 보고 →
 * 잠금화면' 이라는 동선이 새로 생겼다. 둘 다 여기서 막는다. */
const fs = require('fs');
const path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
const SUBJS = read('frontend/pap-subscription.js');
const EDJS = read('frontend/pap-content-editorial.js');
const SYNC = read('frontend/pap-content-api-sync.js');

t('광고 면제는 등급만이 아니라 상태도 본다', () => {
  assert.ok(/function _papSubActive/.test(SUBJS), '상태 판정 함수가 없다');
  const prem = SUBJS.slice(SUBJS.indexOf('function isPremium('), SUBJS.indexOf('function isStandardOrAbove('));
  assert.ok(/_papSubActive\(user\)/.test(prem), 'isPremium 이 상태를 안 본다 — 해지 회원이 계속 면제된다');
  const std = SUBJS.slice(SUBJS.indexOf('function isStandardOrAbove('));
  assert.ok(/_papSubActive\(user\)/.test(std.slice(0, 400)), 'isStandardOrAbove 가 상태를 안 본다');
});

t('상태 필드가 없는 옛 세션은 광고를 띄우지 않는다', () => {
  // 멀쩡한 유료회원에게 갑자기 광고가 뜨는 쪽이 더 나쁘다
  assert.ok(/st === undefined \|\| st === null \|\| st === ''\) return true/.test(SUBJS),
    '상태 미상일 때 광고를 띄우는 쪽으로 기울어 있다');
});

t('잠길 화보에는 광고를 붙이지 않는다', () => {
  assert.ok(/function _papWillLock/.test(SUBJS), '잠금 예측 함수가 없다');
  assert.ok(/_papWillLock/.test(EDJS), '에디토리얼 진입에서 쓰지 않는다');
  assert.ok(/!_edWillLock && !isStandardOrAbove\(\)/.test(EDJS),
    '광고 조건에 잠금 여부가 안 걸려 있다 — 광고 보고 잠금화면이 뜬다');
});

t('비회원은 항상 잠김으로 본다 (광고 대신 가입 안내)', () => {
  assert.ok(/!isLoggedIn\(\)\) return true/.test(SUBJS), '비회원 판정이 없다');
});

t('목록의 required_tier 가 카탈로그까지 전달된다', () => {
  assert.ok(/required_tier/.test(SYNC), '목록 응답의 required_tier 를 안 읽는다');
  assert.ok(/requiredTier/.test(SYNC) && /galleryCount/.test(SYNC), '카탈로그에 안 실린다');
});

t('표지 1장짜리 카탈로그도 상세를 다시 부른다', () => {
  // 목록이 gallery 를 안 실으면서 images 가 '표지 1장'으로 채워진다.
  // '0장일 때만' 이면 하이드레이트가 안 돌아 표지 한 장짜리 화보가 된다.
  assert.ok(/_imgs <= 1/.test(EDJS), '이미지 1장 이하를 하이드레이트 대상으로 안 본다');
  assert.ok(/_galCount > _imgs/.test(EDJS), 'gallery_count 와 비교하지 않는다');
});

/* 같은 혜택이 세 곳에서 다른 숫자를 말하고 있었다 (2026-08-21)
 *   구독 페이지 '최신 6개월' / 마이페이지 '최근 100개' / 코드 178편
 * 표기는 '6개월' 로 통일했다. 한 곳만 고치면 또 갈라지므로 여기서 못박는다. */

t('스탠다드 열람 범위 표기가 두 화면에서 어긋나지 않는다', () => {
  const MY = read('frontend/mypage.html');
  const SUB = read('frontend/subscribe.html');
  assert.ok(!/perkArchive100:\s*['"][^'"]*100/.test(MY),
    '마이페이지가 아직 100개라고 말한다 — 구독 페이지(6개월)·코드(178편)와 어긋난다');
  assert.ok(/최신 6개월 에디토리얼 열람/.test(MY), '마이페이지 ko 표기가 6개월이 아니다');
  assert.ok(/최신 6개월 에디토리얼 열람/.test(SUB), '구독 페이지 ko 표기가 6개월이 아니다');
});

t('낡을 고정 숫자를 혜택 문구에 박지 않는다', () => {
  const MY = read('frontend/mypage.html');
  // '86 이슈' 는 실측과 이미 어긋나 있었다 (이슈 라벨 94 · 볼륨 31 · 에디토리얼 2,301).
  // 새 숫자로 바꾸면 또 낡는다. 안 낡는 사실(2019년부터)로 둔다.
  assert.ok(!/perkArchiveFull:\s*['"][^'"]*\d{2,}\s*(이슈|issues|numeri|números|numéros|号|期|выпусков|Ausgaben)/.test(MY),
    '전체 아카이브 문구에 고정 개수가 다시 박혔다');
});

console.log(`\n${n}개 테스트 통과`);
