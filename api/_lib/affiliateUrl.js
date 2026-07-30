/**
 * PAP Magazine — 어필리에이트 목적지 URL 선택 (지역 라우팅)
 *
 * 2026-07-26 신설. 원래 api/go/[id].js 안에 있던 pickAffiliateUrl 을 분리했다.
 * 순수 함수라 유닛 테스트가 가능해야 하는데, [id].js 는 최상단에서 supabase 클라이언트를
 * 생성하므로 (env 없으면 throw) 테스트에서 require 할 수 없기 때문이다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 규칙이 두 번 바뀌었다. 이력을 지우지 말 것.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 【1차 2026-07-26 — GLOBAL 차단】
 *   "마이테레사 MID 43171 은 APAC 한정이라 지역 밖 클릭은 수수료 0원"이라고 판단해
 *   GLOBAL 트래픽이 korea 링크로 폴백하지 못하게 막았다.
 *
 * 【2차 2026-07-29 — 전제가 틀렸다, 차단 해제】
 *   Mytheresa 마리나 그레지오 확인: "You earn a commission regardless of where
 *   the order is shipped... if an order goes through the APAC MID but is shipped
 *   to Italy, South Korea, or any other country, you still receive the commission."
 *   그 사이 손실: 30일 /go 클릭 2,128건 중 어필리에이트 도달 2건(0.09%).
 *   브랜드 94개 전부 korea 링크만 보유해 GLOBAL(99%)은 구조적으로 항상 null 이었다.
 *
 * 【3차 2026-07-30 — MID 3개로 지역 라우팅】
 *   US/CA·EU/UK/ME 프로그램 제휴가 성립했다. 이제 지역별로 맞는 MID 로 보낸다.
 *
 * ── MID 지도 (2026-07-30 실측 검증) ────────────────────────────────────
 *   | 지역        | MID   | 스토어프론트 | 요율 | 검증                     |
 *   |-------------|-------|-------------|-----|--------------------------|
 *   | APAC/KR     | 43171 | /kr/ko/     | 4%  | 공용 베이스라인만 적용      |
 *   | US/CA       | 43172 | /us/en/     | 8%  | ranMID=43172 · tarea=us  |
 *   | EU/UK/ME    | 35663 | /int/en/    | 8%  | ranMID=35663 · tarea=uk  |
 *
 * 【2026-07-30 — GLOBAL 을 43172 로 보낸다. 요율이 두 배다.】
 *   라쿠텐 대시보드에서 세 MID 의 실제 적용 오퍼를 확인한 결과:
 *     43172 · 35663 → "PAP Magazine: 8% FP / 4% SP" (전용 오퍼) = 8%
 *     43171        → "[New Baseline]" (공용 베이스라인)        = 4%
 *   마리나가 Naila(EU)·Cale(US) 에게만 온보딩을 지시해 **APAC 은 누락**됐다.
 *   그런데 43171 은 KR + 모든 GLOBAL 폴백을 처리하는 최대 볼륨 MID 다.
 *
 *   마리나가 "배송지와 무관하게 수수료가 나온다"고 확인했으므로, EU·US 가 아닌
 *   GLOBAL 트래픽을 43172(8%) 로 보내면 **같은 클릭에 두 배를 받는다.**
 *   KR 은 한국어 스토어프론트가 독자에게 맞으므로 43171 을 유지한다(4% 감수).
 *
 *   ⚠️ 임시 조치다. 마리나가 43171 에 전용 오퍼를 걸어주면 GLOBAL 을 다시
 *      43171 로 되돌릴지 재검토할 것(그때는 로케일 적합성이 기준이 된다).
 *
 *   **`id=xaC5X1voYF4` 는 세 MID 전부 동일하다** — 이 값은 퍼블리셔 계정 ID(ranEAID)
 *   라 광고주와 무관하다. 실제 리다이렉트를 따라가 확인했다. 덕분에 DB 의 94개
 *   브랜드 링크를 다시 만들 필요 없이 `mid=` 와 목적지 로케일만 갈아끼우면 된다.
 *
 *   MID 번호는 규칙적이지 않다(43171·43172 인데 EU 는 35663). 유추 금지.
 *
 * ── 현재 규칙 ──────────────────────────────────────────────────────────
 *   · 수수료 제외 브랜드 → 항상 null (인스타그램 폴백)
 *       Adidas · Nike · New Balance · On — 마리나가 명시한 non-commissionable.
 *       수수료가 0이면 어필리에이트로 보낼 이유가 없다. 인스타그램으로 보내면
 *       최소한 팔로워 유입은 남는다. (도메니코 승인 2026-07-29)
 *   · affiliate_url_global 이 따로 있으면 그것을 최우선으로 쓴다(수동 지정 존중).
 *   · 그 외에는 저장된 링크에서 지역에 맞는 MID·로케일로 변환해 내보낸다.
 *   · 링크가 아예 없으면 null → 호출부가 인스타그램 프로필 폴백으로 넘어간다.
 */

/**
 * 지역별 MID 와 스토어프론트 로케일.
 *
 * `rate` 는 계약 요율(참고용 주석 값)이다. 코드가 이 값을 쓰지는 않지만,
 * **왜 이 MID 를 골랐는지**가 여기 남아 있어야 다음 사람이 근거 없이 되돌리지 않는다.
 */
const REGION_CONFIG = {
  // 한국 독자에게는 한국어 스토어프론트가 맞다. 요율 4% 를 감수하고 43171 유지.
  KR:     { mid: '43171', locale: 'kr/ko',  rate: 4 },
  US:     { mid: '43172', locale: 'us/en',  rate: 8 },
  EU:     { mid: '35663', locale: 'int/en', rate: 8 },
  // 나머지 전 지역 — 43171(4%) 이 아니라 43172(8%) 로 보낸다. 배송지와 무관하게
  // 수수료가 나오므로 같은 클릭에 두 배를 받는다. 목적지는 국제판이라 언어도 맞다.
  GLOBAL: { mid: '43172', locale: 'int/en', rate: 8 },
};

/**
 * 국가코드 → 지역. 목록에 없으면 GLOBAL(43171) 로 떨어지는데, 43171 은 배송지와
 * 무관하게 수수료가 나오므로 **분류를 틀려도 수수료를 잃지는 않는다.** 로케일이
 * 덜 맞을 뿐이다. 실패 모드가 안전한 쪽이라 목록을 완벽하게 유지할 필요는 없다.
 */
const US_COUNTRIES = new Set(['US', 'CA']);
const EU_COUNTRIES = new Set([
  // EU 27
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  // 영국 + EEA/인접
  'GB','NO','CH','IS','LI','MC','AD','SM',
  // 중동 (ME)
  'AE','SA','QA','KW','BH','OM','IL','JO','LB',
]);

/**
 * @param {string} country ISO 2자리 국가코드
 * @returns {'KR'|'US'|'EU'|'GLOBAL'}
 */
function regionFromCountry(country) {
  const c = String(country || '').trim().toUpperCase();
  if (c === 'KR') return 'KR';
  if (US_COUNTRIES.has(c)) return 'US';
  if (EU_COUNTRIES.has(c)) return 'EU';
  return 'GLOBAL';
}

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
 * 저장된 마이테레사 딥링크를 대상 지역용으로 변환한다.
 *
 * 저장 형태:
 *   click.linksynergy.com/deeplink?id=<퍼블리셔>&mid=43171&u1=<브랜드>
 *     &murl=https%3A%2F%2Fwww.mytheresa.com%2Fkr%2Fko%2Fwomen%2F…
 *
 * 바꾸는 것은 딱 두 가지:
 *   1) `mid=` → 지역 MID (수수료 귀속이 여기서 갈린다)
 *   2) murl 안의 로케일 세그먼트 `/kr/ko/` → 지역 로케일
 *      (세 로케일 모두 그 뒤 경로 구조가 같아 그대로 열린다. 실측 확인)
 *
 * `id`(ranEAID)·`u1` 은 건드리지 않는다 — 퍼블리셔·브랜드 식별자다.
 * 마이테레사 링크가 아니거나 형태가 다르면 원본을 그대로 돌려준다(안전 우선).
 *
 * @param {string} url
 * @param {'KR'|'US'|'EU'|'GLOBAL'} region
 * @returns {string}
 */
function localizeAffiliateUrl(url, region) {
  const raw = String(url || '');
  if (!raw) return raw;
  if (!/mytheresa/i.test(raw)) return raw;

  const cfg = REGION_CONFIG[region] || REGION_CONFIG.GLOBAL;
  let out = raw;

  // 1) mid 교체 — 우리가 쓰는 세 MID 중 하나일 때만 손댄다. 모르는 MID 는
  //    다른 프로그램일 수 있으므로 그대로 둔다.
  out = out.replace(/([?&]mid=)(43171|43172|35663)\b/i, '$1' + cfg.mid);

  // 2) murl 로케일 교체 (URL 인코딩된 형태)
  out = out.replace(
    /(mytheresa\.com)%2F[a-z]{2}%2F[a-z]{2}%2F/gi,
    '$1%2F' + cfg.locale.replace('/', '%2F') + '%2F'
  );
  // 인코딩되지 않은 형태도 대비 (링크를 손으로 넣은 경우)
  out = out.replace(
    /(mytheresa\.com)\/[a-z]{2}\/[a-z]{2}\//gi,
    '$1/' + cfg.locale + '/'
  );

  return out;
}

/**
 * @param {{display_name?: string, brand_id?: string, affiliate_url_korea?: string|null, affiliate_url_global?: string|null}} brand
 * @param {'KR'|'US'|'EU'|'GLOBAL'} region
 * @returns {string|null}
 */
function pickAffiliateUrl(brand, region) {
  if (!brand) return null;

  // 수수료 0 → 어필리에이트로 보낼 이유가 없다. 인스타그램 폴백이 낫다.
  if (isNonCommissionable(brand)) return null;

  const kr = brand.affiliate_url_korea || null;
  const global = brand.affiliate_url_global || null;

  // 관리자가 지역용 링크를 따로 넣어뒀으면 그 의도를 존중한다.
  // (KR 은 korea 링크가 곧 지역 링크이므로 그쪽이 우선)
  if (region === 'KR' && kr) return kr;
  if (global) return localizeAffiliateUrl(global, region);
  if (kr) return localizeAffiliateUrl(kr, region);
  return null;
}

module.exports = {
  pickAffiliateUrl,
  isNonCommissionable,
  localizeAffiliateUrl,
  regionFromCountry,
  REGION_CONFIG,
  NON_COMMISSIONABLE,
};
