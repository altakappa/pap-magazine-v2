/**
 * Submission type classification — free vs paid_few_looks vs branded.
 *
 * Domenico-confirmed scope (2026-07-19): DETECT + GUIDE + STORE only. No
 * payment window, no automated email. The submission is always ALLOWED; this
 * module only decides which policy bucket it falls into so the admin can follow
 * up manually.
 *
 *   'free'            — ≥ 4 looks, not brand-dominated. Standard free editorial.
 *   'paid_few_looks'  — fewer than 4 looks. Outside the free-publication policy;
 *                       treated as a paid submission (€345, handled manually).
 *   'branded'         — a single brand overlaps across ALL looks (or every look
 *                       is the same brand). Branded content (€720, manual).
 *
 * PRIORITY: branded > paid_few_looks > free. When a submission both has < 4
 * looks AND is brand-dominated, `branded` wins (it is the higher policy tier).
 *
 * AUTHORITATIVE SERVER RECOMPUTE: api/submissions/index.js (POST) and
 * api/submissions/[id].js (PUT resubmit) call classifySubmissionType() from the
 * persisted `looks` + `lookImageMap` and store the result in description JSON as
 * `submissionType`. The client also runs an equivalent classifier purely for
 * on-page guidance UX — the server value is the trusted one.
 *
 * DATA SHAPES (both produced by frontend/submission.html):
 *   looks        : [{ n:Number, items:[{ type, brand, instagram }] }]
 *   lookImageMap : [{ lookN:Number, imgIdxInLook:Number }]  — one entry per
 *                  uploaded image, in final file_urls order. This is the
 *                  authoritative source for "how many images does look N have"
 *                  because it reflects images that ACTUALLY made it into the
 *                  submission (the UI seeds 4 empty look blocks by default, so
 *                  looks[].length alone would always read ≥ 4).
 *
 * ASSUMPTIONS (reported to Domenico, adjustable later):
 *   • MIN_LOOKS = 4. A "look" counts only if it has ≥ 1 image (empty seeded
 *     look blocks do NOT count).
 *   • Branded fires when the whole submission uses a SINGLE distinct brand
 *     (union of all real-look brands == 1) — independent of look count, so even
 *     one real look with one brand is branded — OR when ≥ 2 real looks all share
 *     a common brand (non-empty intersection). A single real look carrying 2+
 *     distinct brands is NOT branded (trigger is "one brand") and stays
 *     paid_few_looks.
 *   • Brand comparison is over the raw brand STRING (trim + collapse spaces +
 *     lowercase). Brand-set membership still keys off ALL item types.
 *
 * MULTI-BRAND EXEMPTION (도메니코 지시 2026-08-03) ─────────────────────────
 *   공통 브랜드 A가 모든 룩에 들어가 있어도, 의상(Jacket/Top/Skirt/Pants 등)
 *   슬롯에 B·C·D 같은 다른 브랜드들이 골고루 함께 들어가 있으면 그것은 A의
 *   브랜디드 콘텐츠라고 볼 수 없다 → branded 해제.
 *
 *   판정: 실제 룩(이미지 ≥1)의 CLOTHING 슬롯에서 나온 서로 다른 브랜드 수가
 *   MIN_CLOTHING_BRANDS(4) 이상이면 branded 를 끈다. 숫자 4는 임의값이 아니라
 *   submission.html 약관 ①("Editorials must include a minimum of 4 different
 *   clothing brands")과 동일한 값이다 — 판정 근거를 크리에이터에게 그대로
 *   설명할 수 있어야 하므로 약관과 어긋나면 안 된다.
 *
 *   CLOTHING = 옷만. 신발·부츠·가방·모자·벨트·주얼리·안경·스카프·장갑·기타는
 *   액세서리로 제외한다(도메니코 확정) — 액세서리는 한 브랜드로 몰리기 쉬워
 *   포함시키면 예외가 헐거워진다.
 *
 *   해제 후에는 룩 수 규칙이 그대로 다시 적용된다: 실제 룩 < 4 면
 *   paid_few_looks, 그 이상이면 free. 즉 예외는 "€720 → 무조건 무료"가 아니라
 *   "€720 판정만 취소"다.
 *
 *   sharedBrands 는 해제된 뒤에도 그대로 돌려준다(관리자가 "A가 전 룩에 있긴
 *   했다"는 사실을 볼 수 있게). branded 플래그만 false 가 된다.
 */

'use strict';

const MIN_LOOKS = 4;

// 다중 브랜드 예외 임계값 — submission.html 약관 ①의 "minimum of 4 different
// clothing brands" 와 같은 숫자. 약관을 바꾸면 여기도 같이 바꿔야 한다.
const MIN_CLOTHING_BRANDS = 4;

// '의상' 슬롯 화이트리스트 (frontend/submission.html 의 아이템 타입 <option> 중
// 옷에 해당하는 것들). 여기 없는 타입(Shoes/Boots/Bag/Glasses/Sunglasses/Hat/
// Belt/Ring/Necklace/Earrings/Watch/Scarf/Gloves/Other, 빈 값, 오타)은 전부
// 액세서리로 취급해 예외 계산에서 제외한다 — 보수적으로(예외가 덜 터지게).
const CLOTHING_TYPES = new Set([
  'jacket', 'top', 'shirt', 'sweater', 'dress', 'pants', 'skirt',
  'bodysuit', 'costume', 'coat',
]);

/** Normalize an item type for CLOTHING_TYPES membership. */
function normItemType(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalize a brand string for set membership: trim → collapse ws → lower. */
function normBrand(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalize an instagram handle: trim → strip leading @ → strip ws → lower. */
function normHandle(s) {
  return String(s == null ? '' : s).trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Count images per look number from lookImageMap. Falls back to counting
 * looks[].items when lookImageMap is absent/empty is NOT done here — image
 * presence is the authoritative look signal, so a look with no images does
 * not count regardless of how many brand items it lists.
 */
function imagesByLookFromMap(lookImageMap) {
  const counts = {};
  if (Array.isArray(lookImageMap)) {
    for (const ent of lookImageMap) {
      if (!ent) continue;
      const n = ent.lookN;
      if (n == null) continue;
      const key = String(n);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

/** Build a map lookN(string) → Set(normalized non-empty brands) from looks[]. */
function brandSetsFromLooks(looks) {
  const byLook = {};
  if (Array.isArray(looks)) {
    for (const lk of looks) {
      if (!lk || lk.n == null) continue;
      const key = String(lk.n);
      const set = byLook[key] || new Set();
      if (Array.isArray(lk.items)) {
        for (const it of lk.items) {
          const b = normBrand(it && it.brand);
          if (b) {
            set.add(b);
          } else {
            // 2026-07-22 (도메니코 QA) — 브랜드명을 비우고 @핸들만 입력하면
            // 브랜디드 탐지가 통째로 우회되던 구멍. 실제 사례: 4룩 전부
            // brand 공란 + 같은 인스타 핸들 → 모든 브랜드 집합이 비어
            // union=0 → free 로 분류됨. 브랜드명이 없으면 인스타 핸들을
            // 브랜드 식별자로 사용한다(같은 핸들 = 같은 브랜드).
            // '@' 접두로 네임스페이스를 분리해 브랜드명 문자열과의 우연한
            // 충돌은 피한다(보수적 — 확실한 동일성만 잡는다).
            const h = normHandle(it && it.instagram);
            if (h) set.add('@' + h);
          }
        }
      }
      byLook[key] = set;
    }
  }
  return byLook;
}

/**
 * 실제 룩들의 CLOTHING 슬롯에서 나온 서로 다른 브랜드 집합.
 * 브랜드명이 비어 있으면 brandSetsFromLooks 와 동일하게 '@handle' 로 대체한다
 * (같은 핸들 = 같은 브랜드). 이미지 없는 룩은 세지 않는다.
 *
 * @param {Array} looks
 * @param {Array<string>} realLookKeys  이미지가 1장 이상인 룩 번호(문자열) 목록
 * @returns {Set<string>}
 */
function clothingBrandUnion(looks, realLookKeys) {
  const out = new Set();
  if (!Array.isArray(looks)) return out;
  const allowed = new Set((realLookKeys || []).map(String));
  for (const lk of looks) {
    if (!lk || lk.n == null) continue;
    if (!allowed.has(String(lk.n))) continue;
    if (!Array.isArray(lk.items)) continue;
    for (const it of lk.items) {
      if (!it) continue;
      if (!CLOTHING_TYPES.has(normItemType(it.type))) continue;
      const b = normBrand(it.brand);
      if (b) { out.add(b); continue; }
      const h = normHandle(it.instagram);
      if (h) out.add('@' + h);
    }
  }
  return out;
}

/**
 * Classify a submission into 'free' | 'paid_few_looks' | 'branded'.
 *
 * @param {Array} looks         [{ n, items:[{ type, brand, instagram }] }]
 * @param {Array} lookImageMap  [{ lookN, imgIdxInLook }] — one per image.
 * @returns {{ submissionType:string, realLookCount:number, branded:boolean,
 *            sharedBrands:string[], clothingBrands:string[],
 *            clothingBrandCount:number, multiBrandExempt:boolean }}
 */
function classifySubmissionType(looks, lookImageMap) {
  const imgCounts = imagesByLookFromMap(lookImageMap);
  // Real looks = look numbers that carry ≥ 1 image.
  const realLookKeys = Object.keys(imgCounts).filter((k) => imgCounts[k] > 0);
  const realLookCount = realLookKeys.length;

  const brandSets = brandSetsFromLooks(looks);

  // Branded detection (Domenico-confirmed 2026-07-19). Two triggers:
  //   (a) SINGLE BRAND across the whole submission — the union of all real-look
  //       brands is exactly one distinct brand. Fires regardless of look count
  //       (even a single real look with one brand is branded).
  //   (b) SHARED BRAND across MULTIPLE looks — with ≥ 2 real looks, a brand
  //       appears in every real look (non-empty intersection of brand sets).
  // Edge left as paid_few_looks: 1 real look with 2+ distinct brands →
  // union > 1 and realLookCount < 2 → NOT branded (the trigger is "one brand").
  const unionBrands = new Set();
  for (const key of realLookKeys) {
    for (const b of (brandSets[key] || new Set())) unionBrands.add(b);
  }

  let sharedBrands = [];
  let branded = false;
  if (unionBrands.size === 1) {
    // (a) whole submission is one brand — look count irrelevant.
    branded = true;
    sharedBrands = Array.from(unionBrands);
  } else if (realLookCount >= 2) {
    // (b) intersect the brand sets of every REAL look. A real look with no
    // brands empties the intersection (the brand isn't in "all looks").
    let intersection = null;
    for (const key of realLookKeys) {
      const set = brandSets[key] || new Set();
      if (intersection === null) {
        intersection = new Set(set);
      } else {
        const next = new Set();
        for (const b of intersection) if (set.has(b)) next.add(b);
        intersection = next;
      }
      if (intersection.size === 0) break;
    }
    sharedBrands = intersection ? Array.from(intersection) : [];
    branded = sharedBrands.length > 0;
  }

  // MULTI-BRAND EXEMPTION (도메니코 2026-08-03) — 위 트리거가 걸렸더라도, 실제
  // 룩의 의상 슬롯에 서로 다른 브랜드가 MIN_CLOTHING_BRANDS 개 이상 들어가 있으면
  // 한 브랜드의 브랜디드 콘텐츠로 볼 수 없다 → branded 해제.
  // sharedBrands 는 남겨둔다(관리자 참고용). 해제 뒤에는 아래 룩 수 규칙이 그대로
  // 다시 적용되므로 4룩 미만이면 free 가 아니라 paid_few_looks 로 떨어진다.
  const clothingBrandSet = clothingBrandUnion(looks, realLookKeys);
  const clothingBrandCount = clothingBrandSet.size;
  const multiBrandExempt = branded && clothingBrandCount >= MIN_CLOTHING_BRANDS;
  if (multiBrandExempt) branded = false;

  let submissionType = 'free';
  if (branded) submissionType = 'branded';
  else if (realLookCount < MIN_LOOKS) submissionType = 'paid_few_looks';

  return {
    submissionType,
    realLookCount,
    branded,
    sharedBrands,
    clothingBrands: Array.from(clothingBrandSet),
    clothingBrandCount,
    multiBrandExempt,
  };
}

/**
 * 크레딧이 없는 룩의 번호 배열을 돌려준다 — 브랜드/인스타가 모두 빈 룩.
 * (2026-07-21 도메니코 지시: 모든 룩은 최소 1개 크레딧 필수)
 */
function looksMissingCredit(looks) {
  if (!Array.isArray(looks)) return [];
  const out = [];
  for (const L of looks) {
    const items = (L && Array.isArray(L.items)) ? L.items : [];
    const credited = items.some(function (it) {
      return it && (String(it.brand == null ? '' : it.brand).trim()
        || String(it.instagram == null ? '' : it.instagram).trim());
    });
    if (!credited) out.push((L && L.n != null) ? L.n : null);
  }
  return out;
}

module.exports = {
  MIN_LOOKS,
  MIN_CLOTHING_BRANDS,
  CLOTHING_TYPES,
  normBrand,
  normHandle,
  normItemType,
  clothingBrandUnion,
  classifySubmissionType,
  looksMissingCredit,
};
