'use strict';
/**
 * 브랜드명 표기 철칙 (도메니코 2026-09-14): "가장 앞글자 대문자, 그다음 소문자. 전체 소문자나 전체 대문자 적용 안 됨."
 *   mincrisot → Mincrisot · TRENDYWU STUDIOS → Trendywu Studios · jean paul gaultier → Jean Paul Gaultier
 *   H&M → H&M (글자 덩어리마다 첫 글자만 대문자) · o'neill → O'Neill · 333 studio → 333 Studio
 * 거부하지 않고 고쳐서 저장한다. 폼(submission.html _papBrandCase)도 같은 규칙으로 입력칸을 고쳐 보여준다.
 * 판정(submissionType.js)은 소문자로 비교하므로 표기 변경이 분류에 영향을 주지 않는다.
 * 라틴 확장(À-ÿ·Ā-ɏ 등)도 글자로 본다(Hermès → Hermès, ÉTUDES → Études).
 */
const LETTER_RUN = /[A-Za-zÀ-ɏḀ-ỿ]+/g;

function toBrandCase(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const t = s.replace(LETTER_RUN, (run) => run.charAt(0).toUpperCase() + run.slice(1).toLowerCase());
  // 소유격 's: "Stylist's Own" 이 "Stylist'S Own" 이 되지 않게 — 글자 뒤 아포스트로피 + 한 글자로 끝나는 꼬리는 소문자.
  return t.replace(/([A-Za-z\u00C0-\u024F\u1E00-\u1EFF])['\u2019]([A-Z\u00C0-\u024F])(?![A-Za-z\u00C0-\u024F\u1E00-\u1EFF])/g, (m, a, b) => a + m.charAt(1) + b.toLowerCase());
}

/** 이미 규칙대로인가(고쳐도 같으면 true). */
function isBrandCase(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  return s === toBrandCase(s);
}

/** data.looks[].items[].brand 를 제자리에서 고친다. 고친 항목 수를 돌려준다. */
function applyBrandCase(data) {
  let n = 0;
  const looks = data && Array.isArray(data.looks) ? data.looks : [];
  for (const lk of looks) {
    if (!lk || !Array.isArray(lk.items)) continue;
    for (const it of lk.items) {
      if (!it || it.brand == null) continue;
      const fixed = toBrandCase(it.brand);
      if (fixed !== String(it.brand)) { it.brand = fixed; n++; }
    }
  }
  return n;
}

module.exports = { toBrandCase, isBrandCase, applyBrandCase, LETTER_RUN };
