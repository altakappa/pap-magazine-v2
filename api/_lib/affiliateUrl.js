/**
 * PAP Magazine — 어필리에이트 목적지 URL 선택 (지역 스코프)
 *
 * 2026-07-26 신설. 원래 api/go/[id].js 안에 있던 pickAffiliateUrl 을 분리했다.
 * 순수 함수라 유닛 테스트가 가능해야 하는데, [id].js 는 최상단에서 supabase 클라이언트를
 * 생성하므로 (env 없으면 throw) 테스트에서 require 할 수 없기 때문이다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 * `affiliate_url_korea` 는 **한국 트래픽 전용 링크**로 취급한다.
 *
 * 어필리에이트 프로그램은 대부분 수수료 인정 지역이 정해져 있다:
 *   · 마이테레사 AU/Asia-Pacific (MID 43171) — APAC 한정
 *   · Myprotein APAC (MID 53951) — 한국·홍콩·대만·싱가포르 한정
 * 지역 밖 트래픽을 이 링크로 내보내면 **수수료는 0원인데 인스타그램 폴백까지 잃는다.**
 * (PAP `/go` 클릭의 99%가 GLOBAL — 2026-07 실측 GLOBAL 1,754 vs KR 17)
 *
 * 따라서:
 *   · KR      → korea 링크 우선, 없으면 global 로 폴백 (글로벌 프로그램은 통상 KR 포함)
 *   · GLOBAL  → global 링크만. **korea 로 폴백하지 않는다.**
 *               없으면 null → 호출부가 인스타그램 프로필 폴백으로 넘어간다.
 */

/**
 * @param {{affiliate_url_korea?: string|null, affiliate_url_global?: string|null}} brand
 * @param {'KR'|'GLOBAL'} region
 * @returns {string|null}
 */
function pickAffiliateUrl(brand, region) {
  if (!brand) return null;
  if (region === 'KR') return brand.affiliate_url_korea || brand.affiliate_url_global || null;
  return brand.affiliate_url_global || null;
}

module.exports = { pickAffiliateUrl };
