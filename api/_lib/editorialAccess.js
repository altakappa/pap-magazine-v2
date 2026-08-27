'use strict';
/**
 * 에디토리얼 열람 게이트 — '누가 어디까지 보는가'를 한 곳에서 정한다.
 *
 * 왜 만드나 (2026-08-21):
 *   구독 페이지가 파는 것과 코드가 잠그는 것이 달랐다. 페이지는 3단계를
 *   약속하는데 코드에는 열람 게이트가 아예 없어서 비회원도 2,301편을 전부
 *   봤다. €5.49를 내면 실제로 늘어나는 건 이미지 다운로드 하나뿐이었다.
 *   회원 1,010명 중 유료 7명(0.7%)의 이유다.
 *
 * 등급별 범위 (도메니코 결정):
 *   비회원       열람 불가. 단 목록·표지·제목은 보인다 —
 *                뭘 놓치는지 보여야 가입할 이유가 생긴다.
 *   FREE(로그인) 최신 10편
 *   STANDARD     현재 볼륨 + 직전 볼륨 2개
 *   PREMIUM      전체 아카이브
 *   admin/staff  전부
 *
 * 볼륨 = 분기(1~3 / 4~6 / 7~9 / 10~12월). 아직 안 닫힌 현재 볼륨을
 * 포함하므로 경계가 매 분기 1일에 저절로 한 칸 밀린다. 사람이 손댈 일이 없다.
 * (구독 페이지에는 '최신 6개월'로 적는다 — 설명이 짧아야 팔린다)
 *
 * 왜 issue(볼륨) 칸이 아니라 published_date 인가:
 *   사람이 매번 입력해야 도는 값에 게이트를 걸면 한 번 깜빡할 때 화보가
 *   조용히 잠긴다. 실측으로 2026-08 발행분 15편은 issue 칸이 전부 비어
 *   있었고 7월도 20편 중 19편이 비어 있었다. published_date 는 발행하면
 *   자동으로 찍히므로 깜빡할 수가 없다.
 */

const FREE_RECENT_COUNT = Number(process.env.EDITORIAL_FREE_RECENT || 10);

/* 이미지 미리보기 (2026-08-27 도메니코 결정) ────────────────────────────
 * 그동안 잠긴 화보는 이미지를 통째로 안 내려줬다(표지 1장). 그런데 실제로는
 * SSR 페이지에 게이트가 없어서 아무도 안 잠겨 있었다 — 비회원도 전부 봤다.
 *
 * 새 규칙은 하나다. **전체 이미지는 스탠다드부터. 그 아래는 언제나 앞 2장.**
 *   비회원      모든 화보 2장
 *   무료 회원   모든 화보 2장 (최신 10편 열람 권한은 그대로 두되 이미지는 2장)
 *   스탠다드    자기 창(현재+직전 2볼륨) 안은 전체, 밖은 2장
 *   프리미엄    전부
 *
 * 왜 열람 게이트(canView)와 따로 두나: canView 의 allowed 는 다운로드 버튼
 * 활성화에도 쓰인다. 거기에 이미지 규칙을 섞으면 한쪽을 고칠 때 다른 쪽이
 * 조용히 바뀐다. 이미지는 이미지대로 판정한다. */
const PREVIEW_IMAGES = Number(process.env.EDITORIAL_PREVIEW_IMAGES || 2);
const STANDARD_VOLUMES_BACK = 2;          // 현재 볼륨 + 직전 N개
const TIER_RANK = { anon: 0, free: 1, standard: 2, premium: 3, admin: 4 };

/** 그 날짜가 속한 볼륨(분기)의 첫날 */
function volumeStart(d) {
  const t = d instanceof Date ? d : new Date(d);
  const q = Math.floor(t.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(t.getUTCFullYear(), q, 1));
}

/** 스탠다드가 볼 수 있는 가장 오래된 날짜 (현재 볼륨 시작 − 2볼륨) */
function standardCutoff(now) {
  const s = volumeStart(now || new Date());
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 3 * STANDARD_VOLUMES_BACK, 1));
}

/** 'YYYY-MM-DD' 로 자른다 — published_date 가 date 타입이라 시각은 의미가 없다 */
function ymd(d) {
  if (!d) return '';
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? String(d).slice(0, 10) : t.toISOString().slice(0, 10);
}

/**
 * 로그인 사용자 + 프로필 → 등급.
 * 상태가 active/trialing 이 아니면 유료로 치지 않는다 (해지·미납 과다부여 방지).
 */
function tierOf(user, profile) {
  const role = String((user && user.role) || '').toLowerCase();
  if (role === 'admin' || role === 'staff') return 'admin';
  if (!user) return 'anon';
  const status = String((profile && profile.subscription_status) || '').toLowerCase();
  const plan = String((profile && profile.subscription_plan) || '').toLowerCase();
  const paid = status === 'active' || status === 'trialing';
  if (paid && /^premium/.test(plan)) return 'premium';
  if (paid && /^standard/.test(plan)) return 'standard';
  return 'free';
}

/**
 * 한 편을 그 등급이 열람할 수 있는가.
 * @param {string} tier
 * @param {{id?:string, published_date?:string}} row
 * @param {{freeIds?:Set<string>, now?:Date}} opts  freeIds = 최신 N편 id 집합
 * @returns {{allowed:boolean, requiredTier:string, reason:string}}
 */
function canView(tier, row, opts) {
  const o = opts || {};
  if (tier === 'admin') return { allowed: true, requiredTier: 'free', reason: 'admin' };
  if (tier === 'premium') return { allowed: true, requiredTier: 'premium', reason: 'premium' };

  const pd = ymd(row && row.published_date);
  const inStandard = !!pd && pd >= ymd(standardCutoff(o.now));
  const inFree = !!(o.freeIds && row && row.id && o.freeIds.has(String(row.id)));

  if (tier === 'standard') {
    if (inStandard) return { allowed: true, requiredTier: 'standard', reason: 'standard-window' };
    return { allowed: false, requiredTier: 'premium', reason: 'archive-premium-only' };
  }
  if (tier === 'free') {
    if (inFree) return { allowed: true, requiredTier: 'free', reason: 'free-recent' };
    return {
      allowed: false,
      requiredTier: inStandard ? 'standard' : 'premium',
      reason: 'free-limit',
    };
  }
  // 비회원 — 최신 10편도 열지 않는다. 로그인이 첫 관문이다.
  return {
    allowed: false,
    requiredTier: 'free',
    reason: 'login-required',
  };
}

/**
 * 이 등급이 이 화보의 이미지를 몇 장까지 보는가.
 * @returns {number|null} null = 제한 없음(전체)
 */
function galleryLimit(tier, row, opts) {
  const o = opts || {};
  if (tier === 'admin' || tier === 'premium') return null;
  if (tier === 'standard') {
    const pd = ymd(row && row.published_date);
    return (pd && pd >= ymd(standardCutoff(o.now))) ? null : PREVIEW_IMAGES;
  }
  return PREVIEW_IMAGES;   // anon, free
}

/** 전체 이미지를 보려면 어느 등급이 필요한가 (이미지 기준 — 열람 기준과 다르다). */
function requiredTierForImages(row, opts) {
  const o = opts || {};
  const pd = ymd(row && row.published_date);
  return (pd && pd >= ymd(standardCutoff(o.now))) ? 'standard' : 'premium';
}

/**
 * 행에 이미지 규칙을 적용한다. 잘린 경우에만 locked=true 가 붙는다.
 * 이미지가 애초에 2장 이하인 화보(실측 34편)는 잘릴 것이 없으므로 잠기지 않는다.
 */
function shapeGallery(row, tier, opts) {
  if (!row) return row;
  const total = Array.isArray(row.gallery) ? row.gallery.length : 0;
  const limit = galleryLimit(tier, row, opts);
  const out = Object.assign({}, row);
  out.gallery_count = total;
  if (limit === null || total <= limit) {
    out.locked = false;
    return out;
  }
  out.gallery = (Array.isArray(row.gallery) ? row.gallery : []).slice(0, limit);
  out.locked = true;
  out.preview_images = limit;
  out.required_tier = requiredTierForImages(row, opts);
  out.locked_reason = 'preview-only';
  return out;
}

/** 잠긴 행에서 이미지 세트를 떼어낸다. 표지·제목·크레딧은 남긴다(목록·SEO용). */
function stripLocked(row, verdict) {
  if (!row || (verdict && verdict.allowed)) return row;
  const total = Array.isArray(row.gallery) ? row.gallery.length : 0;
  const out = Object.assign({}, row);
  delete out.gallery;
  out.locked = true;
  out.locked_reason = (verdict && verdict.reason) || 'locked';
  out.required_tier = (verdict && verdict.requiredTier) || 'free';
  out.gallery_count = total;
  return out;
}

/**
 * 이 화보를 보려면 어느 등급이 필요한가 — **보는 사람과 무관하게** 행만 보고 정한다.
 * 공개 목록은 엣지 캐시(s-maxage=300)에 올라가므로 응답이 사람마다 달라지면
 * 프리미엄 응답이 비회원에게 그대로 캐시된다. 그래서 목록에는 이 값만 싣는다.
 */
function requiredTierFor(row, opts) {
  const o = opts || {};
  if (o.freeIds && row && row.id && o.freeIds.has(String(row.id))) return 'free';
  const pd = ymd(row && row.published_date);
  if (pd && pd >= ymd(standardCutoff(o.now))) return 'standard';
  return 'premium';
}

/** 공개 목록용 — 이미지 세트를 떼고 '몇 장인지'와 '어느 등급이 필요한지'만 남긴다. */
function slimForPublicList(row, opts) {
  if (!row) return row;
  const out = Object.assign({}, row);
  out.gallery_count = Array.isArray(row.gallery) ? row.gallery.length : 0;
  delete out.gallery;
  out.required_tier = requiredTierFor(row, opts);
  return out;
}

/** 최신 N편 id — FREE 등급의 '최신 10편'을 순위가 아닌 집합으로 확정한다. */
async function latestFreeIds(db, n) {
  const limit = Number(n || FREE_RECENT_COUNT);
  const { data, error } = await db.from('editorials')
    .select('id')
    .eq('status', 'published')
    .order('published_date', { ascending: false })
    .order('id', { ascending: false })      // 같은 날짜 동점 → 항상 같은 10편
    .limit(limit);
  if (error) return new Set();
  return new Set((data || []).map((r) => String(r.id)));
}

module.exports = {
  FREE_RECENT_COUNT, STANDARD_VOLUMES_BACK, TIER_RANK, PREVIEW_IMAGES,
  galleryLimit, requiredTierForImages, shapeGallery,
  volumeStart, standardCutoff, ymd, tierOf, canView, stripLocked, latestFreeIds,
  requiredTierFor, slimForPublicList,
};
