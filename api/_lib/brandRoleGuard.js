'use strict';
/**
 * 팀 크레딧(사람) vs 의상 크레딧(브랜드) 분리 — 도메니코 2026-09-12.
 *   "의상 및 잡화, 주얼리 등의 디자이너는 크리에이터 크레딧이 아닌 의상 크레딧에만 입력할 수 있게."
 *
 * 팀 크레딧의 자유입력 역할에 'Designer' 'Jewelry' 'Brand' 'Bags' 같은 값을 넣으면 사람 크레딧 목록에
 * 브랜드가 섞여 인스타 캡션·/go/ 제휴 링크(brandExtract)가 그 브랜드를 놓친다. 그래서 그런 역할은
 * 팀 크레딧에서 거부하고(400 TEAM_ROLE_BRAND) 룩별 의상 크레딧으로 보낸다.
 *
 * 표준 역할(creditRoles.CANONICAL_ROLES: Set Design, Sound 등)은 절대 걸리지 않는다 — 표준으로 정규화되면 통과.
 * 프론트(frontend/submission.html _PAP_BRAND_ROLE_RE)가 같은 정규식을 쓰고 tests/team-role-brand-guard 가 대조한다.
 */
const { normalizeRole, isCanonical } = require('./creditRoles');

// 소스 문자열로 둔다 — 프론트와 글자 단위로 같아야 해서(테스트가 비교).
// 'Designer' 홀로는 브랜드(의상 디자이너)로 본다. 'Sound/Lighting/Production Designer' 처럼 앞말이 붙으면 사람 역할이라 통과.
const BRAND_ROLE_RE_SRC = '^\\s*designers?\\s*$|(^|[^a-z])((fashion|textile|knitwear|print|pattern)\\s+designers?|design house|brands?|labels?|maison|atelier|jewel\\w*|bijoux|accessor\\w*|bags?|handbags?|shoes?|footwear|sneakers?|eyewear|sunglasses|watch(es)?|hats?|millinery|clothing|garments?|apparel|fashion by|beauty by|wardrobe|outfits?|dress(es)?|couture|ready.to.wear|rtw)([^a-z]|$)';
const BRAND_ROLE_RE = new RegExp(BRAND_ROLE_RE_SRC, 'i');

/** 이 역할은 브랜드/디자이너 크레딧이라 팀 크레딧에 못 들어간다. */
function isBrandRole(role) {
  const raw = String(role == null ? '' : role).trim();
  if (!raw) return false;
  const canon = normalizeRole(raw);
  if (canon && isCanonical(canon)) return false;      // Set Design, Sound, Music… 표준은 사람 역할
  return BRAND_ROLE_RE.test(raw);
}

/** team 배열에서 브랜드 역할을 가진 항목의 역할명 목록 (없으면 []). */
function brandRolesIn(team) {
  return (Array.isArray(team) ? team : [])
    .map((m) => (m && typeof m === 'object') ? String(m.role || '').trim() : '')
    .filter((r) => r && isBrandRole(r));
}

module.exports = { BRAND_ROLE_RE_SRC, BRAND_ROLE_RE, isBrandRole, brandRolesIn };
