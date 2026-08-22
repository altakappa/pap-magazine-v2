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

console.log(`\n${n}개 테스트 통과`);
