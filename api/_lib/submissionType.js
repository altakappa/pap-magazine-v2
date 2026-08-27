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
 *                       treated as a paid submission (€380, handled manually).
 *   'branded'         — a single brand overlaps across ALL looks (or every look
 *                       is the same brand). Branded content (€790, manual).
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
 *   paid_few_looks, 그 이상이면 free. 즉 예외는 "€790 → 무조건 무료"가 아니라
 *   "€790 판정만 취소"다.
 *
 *   sharedBrands 는 해제된 뒤에도 그대로 돌려준다(관리자가 "A가 전 룩에 있긴
 *   했다"는 사실을 볼 수 있게). branded 플래그만 false 가 된다.
 *
 * ACCESSORY-ONLY 예외 (도메니코 지시 2026-08-10) ────────────────────────────
 *   위 다중 브랜드 예외에는 비대칭이 있었다:
 *     • branded 로 "집어넣을 때"  → 모든 슬롯을 본다 (신발·모자도 트리거가 됨)
 *     • branded 에서 "빼줄 때"    → 의상 슬롯만 본다 (신발·모자는 못 씀)
 *   들어갈 때는 쓰이고 나올 때는 안 쓰이는 구조라, 스타일리스트가 신발 한
 *   브랜드를 전 룩에 돌려 신기면 브랜디드 게재료가 붙었다.
 *   실사례: "REVERIE"(2026-08-03) — 전 룩 공통 브랜드가 Somechic Studio(Shoes)
 *   하나뿐이고 의상은 MOIRAI store / Roberto Cavalli 2종. 신발이 겹쳤다는 이유로
 *   브랜디드 판정. 도메니코 판단: 이건 그 신발 브랜드의 브랜디드 콘텐츠가 아니다.
 *
 *   판정: branded 트리거가 걸렸더라도, 그 공통 브랜드가 실제 룩의 CLOTHING
 *   슬롯에 단 한 번도 등장하지 않으면(= 액세서리 슬롯에만 있으면) branded 를 끈다.
 *
 *   단, clothingBrandCount >= 1 을 함께 요구한다. 의상 슬롯을 아예 하나도
 *   채우지 않은 제출(전부 'Other' 로 태깅)까지 풀어주면 "전부 Other 로 넣으면
 *   브랜디드를 영영 피한다"는 우회로가 생기기 때문이다 — 2026-08-10 실측에서
 *   전체 116건 중 18건이 의상 슬롯 0개였다. 이 가드가 있어야 해제 대상이
 *   11건 → 3건으로 좁혀진다(REVERIE / Wild - Kiara Jones / Cold air).
 *
 *   sharedBrands 는 여기서도 그대로 돌려준다. branded 플래그만 false 가 된다.
 *
 * SINGLE-CLOTHING-BRAND (도메니코 지시 2026-08-11) ─────────────────────────
 *   실제 룩의 의상 슬롯 브랜드가 **정확히 1종**이면 무조건 branded 다.
 *   위 두 예외보다 나중에 적용해 그것들을 덮는다.
 *
 *   실사례 "insides"(2026-08-03): 옷은 전부 Juana Echeguia 인데 룩3 의 유일한
 *   크레딧이 모자(Juan El Daltonico)라 "모든 룩 공통" 교집합이 비어 free 로
 *   통과했다. 모자 하나가 단일 디자이너 화보의 브랜디드 판정을 떼어낸 것이다.
 *   ACCESSORY-ONLY 예외와 정확히 반대 방향의 같은 뿌리 — 판정이 액세서리를
 *   의상과 동등하게 취급하는 데서 온다.
 *
 *   0종은 제외한다. 0종은 "옷이 한 브랜드"가 아니라 "의상 슬롯을 하나도 안
 *   채웠다"는 뜻이라 판단이 불가능하다(헤어·뷰티 화보가 섞여 있다).
 *   대신 needsCreditReview=true 로 관리자에게 넘긴다.
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

// GENERIC-CREDIT 필터 (도메니코 지시 2026-08-24) ─────────────────────────────
// "Stylist" / "Own Design" / "Stylist's Own" 같은 관용 표기는 브랜드가 아니라
// "스타일리스트 소장품·본인 제작"이라는 뜻이다. 실사례 "BURNOUT IS A BADGE OF
// HONOR"(93ed4a18): 룩 크레딧이 Ginza Kanematsu(Shoes) + Stylist(Jacket) +
// Own Design(Shirt) + Stylist's Own(Top) — 뒤 3개가 브랜드로 세어져 union 4종,
// 교집합 없음 → free 로 저장됐다. 검증 불가한 관용 표기는 어떤 카운트에도
// (branded 트리거·의상 브랜드 수·free 자격) 넣지 않는다.
//
// 비교 키: 소문자 + 영숫자 외 전부 제거 — "Stylist's Own"/"stylists own"/
// "@stylistsown" 이 전부 'stylistsown' 하나로 접힌다. 실제 브랜드명과의
// 부분 일치는 안 한다("Owndesign Studio" 는 'owndesignstudio' → 통과).
// ⚠ frontend/submission.html 미러의 _PAP_GENERIC_CREDITS 와 목록이 같아야
// 한다 — tests/submission-type.test.js 가 두 목록의 일치를 고정한다.
const GENERIC_CREDIT_TERMS = new Set([
  // 스타일리스트 소장/본인 제작 계열
  'stylist', 'stylists', 'stylistsown', 'stylistown', 'ownstylist',
  'own', 'owndesign', 'owndesigns', 'ownbrand', 'self', 'selfmade',
  'designersown', 'designerown', 'modelsown', 'modelown', 'talentsown', 'artistsown',
  // 출처 불명/일반명사 계열
  'vintage', 'archive', 'custom', 'custommade', 'handmade', 'diy',
  'secondhand', 'thrift', 'thrifted', 'thriftstore', 'borrowed', 'rental', 'rented',
  // 무기재 계열
  'nobrand', 'brandless', 'none', 'na', 'unknown', 'tbd', 'tba',
]);

/** 브랜드/핸들 문자열이 "브랜드가 아닌 관용 표기"인지. 빈 값도 true. */
/* ── SPA(패스트패션) 브랜드 (2026-08-26 도메니코 지시) ──────────────────
   "브랜드 갯수를 세아릴 때 SPA 브랜드나 빈티지 브랜드는 브랜드로 카운트하지
   않는다."

   빈티지는 이미 GENERIC_CREDIT_TERMS('vintage','archive','secondhand',
   'thrift' 등)로 처리되고 있었다. 개별 빈티지 숍 상호는 목록으로 열거할 수
   없어 약관(제7조⑤)의 편집팀 판단으로 넘긴다. 코드가 자동으로 거르는 것은
   아래 SPA 목록뿐이다.

   ※ GENERIC_CREDIT_TERMS 와 합치지 않는다. "관용 표기"(브랜드가 아님)와
     "SPA 브랜드"(브랜드지만 집계 제외)는 성격이 다르다. 합치면 나중에
     구분이 불가능해진다.

   ※ 한글·비라틴 키는 넣지 않는다. 브랜드명은 라틴 전용으로 받는다
     (api/_lib/latinOnly.js, 2026-08-26 지시).

   실측(2026-08-26, 룩 데이터 113건): SPA 제외로 무료→유료가 되는 건 3건.
   SPA 를 쓴 서브미션은 약 20건이나 대부분 독립 디자이너를 함께 크레딧한다. */
const SPA_BRANDS = new Set([
  // Inditex
  'zara', 'bershka', 'pullbear', 'pullandbear', 'stradivarius', 'massimodutti',
  // 스페인 SPA (Inditex 아님)
  'mango',
  // H&M 그룹
  'hm', 'handm', 'cos', 'arket', 'otherstories', 'andotherstories', 'monki',
  // 패스트리테일링
  'uniqlo', 'gu',
  // 온라인·기타 글로벌
  'asos', 'shein', 'primark', 'forever21', 'topshop', 'urbanoutfitters',
  'evenandodd', 'boohoo', 'prettylittlething', 'missguided', 'hollister',
  'brandymelville', 'reserved', 'newlook', 'gap', 'oldnavy',
  // 이탈리아 체인
  'calzedonia', 'intimissimi',
  // 한국
  'spao', '8seconds', 'eightseconds', 'mixxo',
]);

/* SPA 제외 규칙 발효일 (UTC).
   이 시각 **이전에 제출된** 서브미션은 기존 규칙으로 판정한다. 판정 기준은
   심사 시각이 아니라 제출 시각이다 — 구 규칙에서 제출했는데 심사가 늦어져
   유료가 되는 상황을 만들지 않기 위해서다.
   값을 바꿀 일이 있으면 **여기 한 곳만** 고친다. */
const SPA_RULE_EFFECTIVE_AT = process.env.SPA_RULE_EFFECTIVE_AT || '2026-09-03T00:00:00Z';

/** SPA 브랜드인가. 정규화 키 완전 일치만 본다(부분 일치 금지 — "Zara Home" 통과). */
function isSpaBrand(s) {
  const key = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key !== '' && SPA_BRANDS.has(key);
}

/** 이 제출 시각에 SPA 제외 규칙이 적용되는가.
    submittedAt 이 없으면(신규 입력·미리보기) 현재 시각으로 본다. */
function spaRuleApplies(submittedAt) {
  const eff = Date.parse(SPA_RULE_EFFECTIVE_AT);
  if (!isFinite(eff)) return true;              // 상수가 깨졌으면 신규 규칙으로
  const t = submittedAt ? Date.parse(submittedAt) : Date.now();
  if (!isFinite(t)) return true;
  return t >= eff;
}

function isGenericCredit(s) {
  const key = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key === '' || GENERIC_CREDIT_TERMS.has(key);
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
function brandSetsFromLooks(looks, opts) {
  // 2026-08-26 SPA 제외. 발효일 이전 제출은 적용하지 않는다(유예).
  const applySpa = spaRuleApplies(opts && opts.submittedAt);
  const byLook = {};
  if (Array.isArray(looks)) {
    for (const lk of looks) {
      if (!lk || lk.n == null) continue;
      const key = String(lk.n);
      const set = byLook[key] || new Set();
      if (Array.isArray(lk.items)) {
        for (const it of lk.items) {
          const b = normBrand(it && it.brand);
          // 2026-08-24 — 관용 표기(Stylist's Own 등)는 브랜드가 아니므로 집합에
          // 넣지 않는다. 브랜드칸이 관용 표기면 없는 것으로 보고 핸들로 넘어간다.
          if (b && !isGenericCredit(b) && !(applySpa && isSpaBrand(b))) {
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
            if (h && !isGenericCredit(h)) set.add('@' + h);
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
function clothingBrandUnion(looks, realLookKeys, opts) {
  const out = new Set();
  if (!Array.isArray(looks)) return out;
  // 2026-08-26 SPA 제외. 무료 게재 자격(의상 브랜드 4종)을 세는 곳이 바로
  // 여기이므로 반드시 여기에도 걸어야 한다. brandSetsFromLooks 에만 걸면
  // 브랜디드 판정만 바뀌고 무료/유료 경계는 그대로다.
  const applySpa = spaRuleApplies(opts && opts.submittedAt);
  const allowed = new Set((realLookKeys || []).map(String));
  for (const lk of looks) {
    if (!lk || lk.n == null) continue;
    if (!allowed.has(String(lk.n))) continue;
    if (!Array.isArray(lk.items)) continue;
    for (const it of lk.items) {
      if (!it) continue;
      if (!CLOTHING_TYPES.has(normItemType(it.type))) continue;
      // 2026-08-24 — 관용 표기(Stylist's Own 등)는 의상 브랜드 수에도 넣지 않는다.
      // 안 그러면 "Stylist's Own ×4" 로 무료 자격(4종)을 채우는 우회로가 생긴다.
      const b = normBrand(it.brand);
      if (b && isGenericCredit(b)) {
        // 관용 표기 → 핸들 폴백으로 내려간다(종전 동작)
      } else if (b && applySpa && isSpaBrand(b)) {
        // SPA 브랜드는 집계에서 뺀다. 핸들 폴백으로도 되살리지 않는다
        // (@zara 로 우회하는 길을 열면 규칙이 무의미해진다).
        continue;
      } else if (b) {
        out.add(b); continue;
      }
      const h = normHandle(it.instagram);
      if (h && !isGenericCredit(h) && !(applySpa && isSpaBrand(h))) out.add('@' + h);
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
 *            clothingBrandCount:number, multiBrandExempt:boolean,
 *            accessoryOnlyExempt:boolean, singleClothingBrand:boolean,
 *            needsCreditReview:boolean }}
 */
function classifySubmissionType(looks, lookImageMap, opts) {
  /* opts.submittedAt — SPA 제외 규칙의 유예 판정에 쓴다(2026-08-26).
     신규 제출은 값이 없어도 되고(현재 시각), 기존 행을 다시 분류할 때는
     반드시 그 행의 created_at 을 넘겨야 소급 적용이 일어나지 않는다. */
  const imgCounts = imagesByLookFromMap(lookImageMap);
  // Real looks = look numbers that carry ≥ 1 image.
  const realLookKeys = Object.keys(imgCounts).filter((k) => imgCounts[k] > 0);
  const realLookCount = realLookKeys.length;

  const brandSets = brandSetsFromLooks(looks, opts);

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
  const clothingBrandSet = clothingBrandUnion(looks, realLookKeys, opts);
  const clothingBrandCount = clothingBrandSet.size;
  const multiBrandExempt = branded && clothingBrandCount >= MIN_CLOTHING_BRANDS;
  if (multiBrandExempt) branded = false;

  // ACCESSORY-ONLY 예외 (도메니코 2026-08-10) — 공통 브랜드가 의상 슬롯에 단 한
  // 번도 나오지 않으면(액세서리 전용) 그 브랜드의 브랜디드 콘텐츠로 볼 수 없다.
  // 의상 슬롯을 하나도 안 채운 제출은 제외한다(전부 'Other' 태깅 우회 방지).
  const accessoryOnlyExempt = branded
    && sharedBrands.length > 0
    && clothingBrandCount >= 1
    && !sharedBrands.some((b) => clothingBrandSet.has(b));
  if (accessoryOnlyExempt) branded = false;

  // SINGLE-CLOTHING-BRAND (도메니코 2026-08-11) — 위 트리거·예외를 모두 통과했더라도,
  // 실제 룩의 의상 슬롯 브랜드가 정확히 1종이면 branded 로 확정한다. 마지막에 적용해
  // 위의 두 예외를 덮는다(전부 한 디자이너 옷이면 예외가 붙을 이유가 없다).
  //
  // 왜 필요했나 — 실사례 "insides"(afe5cbad, 2026-08-03):
  //   룩1 Top: Juana Echeguia · 룩2 Dress: Juana Echeguia
  //   룩3 Hat: Juan El Daltonico  ← 이 룩의 유일한 크레딧이 모자(액세서리)
  //   룩4 Other: Juana Echeguia
  // 룩3 에 Juana 가 없어 "모든 룩 공통 브랜드" 교집합이 비었고 → free 로 통과했다.
  // 화보 전체 옷이 한 디자이너인데 모자 하나가 브랜디드 판정을 떼어낸 것이다.
  // 이는 accessoryOnlyExempt(2026-08-10)와 정확히 반대 방향의 같은 뿌리 —
  // 판정이 액세서리를 의상과 동등하게 취급하는 데서 온다.
  //
  // 0종은 일부러 제외한다. 0종은 "옷이 한 브랜드"가 아니라 "의상 슬롯을 하나도
  // 안 채웠다"는 뜻이라 판단 불가다. 2026-08-11 실측 116건 중 8건이 0종이었고
  // Hairlog·POOLSIDE FANTASY 처럼 헤어·뷰티 화보가 섞여 있다 — 태깅 미비를
  // €790 청구로 바꾸면 안 된다. 대신 needsCreditReview 로 관리자에게 넘긴다.
  const singleClothingBrand = clothingBrandCount === 1;
  if (singleClothingBrand) branded = true;

  // 의상 크레딧이 아예 없어 자동 판정이 불가능한 제출 — 관리자 확인 대상 표시.
  const needsCreditReview = clothingBrandCount === 0 && realLookCount > 0;

  // FEW-CLOTHING-BRANDS (도메니코 지시 2026-08-23) ────────────────────────
  // "의상을 위한 브랜드가 4개 미만이면 유료서브미션이잖아."
  // 약관 ①("minimum of 4 different clothing brands")은 처음부터 무료 게재의
  // 자격 조건인데, 분류기는 그 숫자(MIN_CLOTHING_BRANDS=4)를 branded 를
  // **풀어줄 때만** 쓰고 free 자격으로는 안 쓰고 있었다 — 들어올 땐 안 세고
  // 나갈 때만 세는 비대칭.
  //
  // 실사례 "BioGenesis Human to Creature"(1250b66a, 2026-08-21): 실제 룩 6개라
  // 룩 수 규칙 통과, 의상 브랜드는 cosic fashion·paridia 2종뿐인데 free 판정.
  // 약관대로면 무료 자격이 없다. 이제 의상 브랜드 2~3종은 paid_few_looks
  // 버킷(€380)으로 떨어진다.
  //
  // 경계 유지(기존 판례 그대로):
  //   · 1종  → 위 SINGLE-CLOTHING-BRAND 가 이미 branded(€790)로 확정
  //   · 0종  → 유료로 밀지 않는다. "옷이 적다"가 아니라 "의상 태깅을 안 했다"
  //            (헤어·뷰티 화보 실측 8/116건) — needsCreditReview 로 관리자 판단.
  const fewClothingBrands = clothingBrandCount >= 2 && clothingBrandCount < MIN_CLOTHING_BRANDS;

  let submissionType = 'free';
  let paidReason = null;
  if (branded) submissionType = 'branded';
  else if (realLookCount < MIN_LOOKS) { submissionType = 'paid_few_looks'; paidReason = 'few_looks'; }
  else if (fewClothingBrands) { submissionType = 'paid_few_looks'; paidReason = 'few_clothing_brands'; }

  return {
    submissionType,
    realLookCount,
    branded,
    sharedBrands,
    clothingBrands: Array.from(clothingBrandSet),
    clothingBrandCount,
    multiBrandExempt,
    accessoryOnlyExempt,
    singleClothingBrand,
    needsCreditReview,
    fewClothingBrands,
    paidReason,   // 'few_looks' | 'few_clothing_brands' | null — 안내 문구가 진짜 이유를 말하게
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
  GENERIC_CREDIT_TERMS,
  isGenericCredit,
  SPA_BRANDS,
  SPA_RULE_EFFECTIVE_AT,
  isSpaBrand,
  spaRuleApplies,
  clothingBrandUnion,
  classifySubmissionType,
  looksMissingCredit,
};
