/**
 * PAP Magazine — 어필리에이트 목적지 URL 선택 (지역 스코프)
 *
 * 2026-07-26 신설. 원래 api/go/[id].js 안에 있던 pickAffiliateUrl 을 분리했다.
 * 순수 함수라 유닛 테스트가 가능해야 하는데, [id].js 는 최상단에서 supabase 클라이언트를
 * 생성하므로 (env 없으면 throw) 테스트에서 require 할 수 없기 때문이다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 2026-07-29 — 전제가 뒤집혔다. GLOBAL 게이트를 연다.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 【이전 규칙과 그 근거 — 기록용으로 남긴다】
 *   7/26 감사 때 "마이테레사 AU/Asia-Pacific(MID 43171)은 APAC 한정이라
 *   지역 밖 클릭은 수수료 0원"이라고 판단했다. 그래서 GLOBAL 트래픽은 korea
 *   링크로 폴백하지 않게 막았다 — 수수료도 못 받고 인스타그램 폴백까지
 *   잃는 것이 최악이라고 봤기 때문이다.
 *
 * 【그 전제가 틀렸다】
 *   2026-07-29 Mytheresa 마리나 그레지오(Junior Online Marketing Manager)
 *   확인: "You earn a commission regardless of where the order is shipped.
 *   For example, if an order goes through the APAC MID but is shipped to
 *   Italy, South Korea, or any other country, you still receive the
 *   commission." → MID 43171 은 배송지 무관 수수료 대상이다.
 *
 * 【그 사이의 손실 — 이 변경의 근거】
 *   최근 30일 /go 클릭 2,128건 중 어필리에이트 링크로 간 것은 2건(0.09%).
 *   나머지 2,126건은 전부 인스타그램 폴백으로 흘렀다. 브랜드 94개 전부
 *   affiliate_url_korea 에만 링크가 있고 affiliate_url_global 은 0개이므로,
 *   GLOBAL(전체의 99%)은 구조적으로 항상 null 이었다.
 *
 * ── 현재 규칙 ──────────────────────────────────────────────────────────
 *   · 수수료 제외 브랜드 → 항상 null (인스타그램 폴백)
 *       Adidas · Nike · New Balance · On — 마리나가 명시한 non-commissionable.
 *       수수료가 0이므로 어필리에이트 링크를 태울 이유가 없다. 인스타그램으로
 *       보내면 최소한 팔로워 유입이라도 남는다. (도메니코 승인 2026-07-29)
 *   · KR      → korea 우선, 없으면 global 폴백
 *   · GLOBAL  → global 우선, 없으면 **korea 링크로 폴백**한다.
 *               단, 링크 안의 목적지(murl)가 한국어 스토어프론트(/kr/ko/)면
 *               국제판(/int/en/)으로 바꾼다 — 트래킹은 id·mid 로 이뤄지므로
 *               murl 로케일 교체는 수수료에 영향이 없고, 미국·유럽 독자가
 *               한국어 페이지에 떨어지는 것만 막는다.
 *   · 둘 다 없으면 null → 호출부가 인스타그램 프로필 폴백으로 넘어간다.
 *
 * ── 남은 일 (도메니코) ─────────────────────────────────────────────────
 *   Rakuten 대시보드에서 신규 EU·US/CA MID 의 딥링크를 뽑아
 *   affiliate_url_global 에 채우면, 위 폴백 대신 지역 전용 링크가 쓰인다.
 *   그때까지는 43171 폴백이 수수료를 받는다.
 */

/**
 * 수수료가 발생하지 않는 브랜드. 정규화된 이름으로 **정확히** 비교한다.
 * (부분일치로 하면 'ON' 이 'ONITSUKA' 같은 이름에 잘못 걸린다.)
 */
const NON_COMMISSIONABLE = new Set([
  'ADIDAS',
  'NIKE',
  'NEWBALANCE',
  'ON',
  'ONRUNNING',
]);

/** 대문자화 + 영숫자만 남김. 'New Balance' / 'new_balance' → 'NEWBALANCE' */
function normalizeBrandName(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * @param {{display_name?: string, brand_id?: string}} brand
 * @returns {boolean} 수수료 제외 브랜드인가
 */
function isNonCommissionable(brand) {
  if (!brand) return false;
  return NON_COMMISSIONABLE.has(normalizeBrandName(brand.display_name)) ||
         NON_COMMISSIONABLE.has(normalizeBrandName(brand.brand_id));
}

/**
 * 마이테레사 딥링크의 murl(최종 목적지)을 국제판 로케일로 바꾼다.
 *
 * 저장된 링크는 `murl=https%3A%2F%2Fwww.mytheresa.com%2Fkr%2Fko%2F…` 형태로
 * 한국어 스토어프론트를 가리킨다. 한국 독자에겐 맞지만 GLOBAL 독자에게는
 * 읽을 수 없는 페이지다. `/kr/ko/` 는 `/int/en/` 과 경로 구조가 같아
 * (예: women/designers/prada) 로케일 세그먼트만 바꾸면 그대로 열린다.
 *
 * 트래킹 파라미터(id·mid·u1)는 건드리지 않는다 — 수수료 귀속은 그쪽에서 난다.
 * 마이테레사 링크가 아니거나 형태가 다르면 원본을 그대로 돌려준다(안전 우선).
 *
 * @param {string} url
 * @returns {string}
 */
function toInternationalStorefront(url) {
  const raw = String(url || '');
  if (!raw) return raw;
  if (!/mytheresa/i.test(raw)) return raw;

  // murl 은 URL 인코딩되어 들어있다: %2Fkr%2Fko%2F
  let out = raw.replace(/%2Fkr%2Fko%2F/gi, '%2Fint%2Fen%2F');
  // 인코딩되지 않은 형태도 대비 (링크를 손으로 넣은 경우)
  out = out.replace(/mytheresa\.com\/kr\/ko\//gi, 'mytheresa.com/int/en/');
  return out;
}

/**
 * @param {{display_name?: string, brand_id?: string, affiliate_url_korea?: string|null, affiliate_url_global?: string|null}} brand
 * @param {'KR'|'GLOBAL'} region
 * @returns {string|null}
 */
function pickAffiliateUrl(brand, region) {
  if (!brand) return null;

  // 수수료 0 → 어필리에이트로 보낼 이유가 없다. 인스타그램 폴백이 낫다.
  if (isNonCommissionable(brand)) return null;

  const kr = brand.affiliate_url_korea || null;
  const global = brand.affiliate_url_global || null;

  if (region === 'KR') return kr || global || null;

  // GLOBAL — 전용 링크가 있으면 그걸 쓰고, 없으면 43171 링크를 국제판으로.
  if (global) return global;
  if (kr) return toInternationalStorefront(kr);
  return null;
}

module.exports = {
  pickAffiliateUrl,
  isNonCommissionable,
  toInternationalStorefront,
  NON_COMMISSIONABLE,
};
