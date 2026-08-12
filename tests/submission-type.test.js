// PAP Magazine — Submission-type classification test
//
// Guards the 2026-07-19 DETECT + GUIDE + STORE feature: submissions are routed
// into 'free' | 'paid_few_looks' (€380) | 'branded' (€790) buckets. Payment and
// email stay manual — this only classifies. The POST (api/submissions/index.js)
// and PUT-resubmit (api/submissions/[id].js) handlers recompute the type
// AUTHORITATIVELY from the persisted looks + lookImageMap via this shared helper,
// so the value can't be spoofed by the client.
//
// Exercises the REAL production helper (api/_lib/submissionType.js) — the same
// module the handlers import — so the test can't drift from what ships.
//
// Run with `node tests/submission-type.test.js` (wired into `npm test`).

'use strict';

const path = require('path');
const { classifySubmissionType, MIN_LOOKS } =
  require(path.resolve(__dirname, '..', 'api', '_lib', 'submissionType'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push({ label, detail }); failed++; }
}

// Build a lookImageMap with `counts[i]` images for look number i+1.
function mapFor(counts) {
  const out = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) out.push({ lookN: i + 1, imgIdxInLook: k });
  });
  return out;
}
// Build looks[] from an array of brand-arrays (one per look number).
function looksFor(brandsPerLook) {
  return brandsPerLook.map((brands, i) => ({
    n: i + 1,
    items: brands.map((b) => ({ type: 'Top', brand: b, instagram: '' })),
  }));
}
const typeOf = (looks, map) => classifySubmissionType(looks, map).submissionType;

console.log('\n=== constants ===');
ok('MIN_LOOKS is 4', MIN_LOOKS === 4, String(MIN_LOOKS));

console.log('\n=== free ===');
ok('4 looks, 4 distinct brands → free',
   typeOf(looksFor([['A'], ['B'], ['C'], ['D']]), mapFor([1, 1, 1, 1])) === 'free');
ok('5 looks, no shared brand → free',
   typeOf(looksFor([['A'], ['B'], ['C'], ['D'], ['E']]), mapFor([2, 1, 1, 1, 3])) === 'free');
ok('4 looks, ≥2 distinct brands, one look with NO brand → free (union>1, no full intersection)',
   typeOf(looksFor([['A'], ['B'], ['C'], []]), mapFor([1, 1, 1, 1])) === 'free');

console.log('\n=== paid_few_looks (€380) ===');
ok('3 looks, distinct brands → paid_few_looks',
   typeOf(looksFor([['A'], ['B'], ['C']]), mapFor([1, 1, 1])) === 'paid_few_looks');
ok('1 real look with 2+ DISTINCT brands → paid_few_looks (trigger is "one brand", not met)',
   typeOf(looksFor([['Alpha', 'Beta']]), mapFor([1])) === 'paid_few_looks');
ok('seeded-but-empty look blocks (0 images) → paid_few_looks (realLookCount 0, union empty)',
   typeOf(looksFor([['A'], ['B'], ['C'], ['D']]), []) === 'paid_few_looks');
ok('3 looks, distinct brands, no single/shared brand → paid_few_looks',
   typeOf(looksFor([['Nike'], ['Adidas'], ['Puma']]), mapFor([1, 1, 1])) === 'paid_few_looks');

console.log('\n=== branded (€790) — single-brand trigger (a), look count irrelevant ===');
ok('1 real look, single brand → branded (NEW: single brand fires at any look count)',
   typeOf(looksFor([['Solo']]), mapFor([1])) === 'branded');
ok('2 real looks but only 1 carries images, single brand → branded (image-less look ignored, union==1)',
   typeOf(looksFor([['Nike'], ['Nike']]), mapFor([1, 0])) === 'branded');
ok('4 looks where 3 are brand X and one has NO brand → branded (whole submission = 1 distinct brand)',
   typeOf(looksFor([['X'], ['X'], ['X'], []]), mapFor([1, 1, 1, 1])) === 'branded');
ok('4 looks all same brand → branded',
   typeOf(looksFor([['Gucci'], ['Gucci'], ['Gucci'], ['Gucci']]), mapFor([1, 1, 1, 1])) === 'branded');
ok('case/space normalization: " Prada "/prada/PRADA → branded (union==1)',
   typeOf(looksFor([[' Prada '], ['prada'], ['PRADA '], ['Prada']]), mapFor([1, 1, 1, 1])) === 'branded');

console.log('\n=== branded (€790) — shared-brand trigger (b), ≥2 looks share a common brand ===');
// looksFor() 는 모든 아이템을 type:'Top'(의상)으로 만든다 → 브랜드 수 = 의상 브랜드 수.
// 그래서 아래 두 케이스는 2026-08-03 다중 브랜드 예외 도입으로 판정이 바뀌었다.
ok('4 looks, 공통 브랜드 + 의상 브랜드 5종 → 예외 발동, branded 아님',
   typeOf(looksFor([['Gucci', 'A'], ['Gucci', 'B'], ['Gucci', 'C'], ['Gucci', 'D']]), mapFor([1, 1, 1, 1])) === 'free');
ok('3 looks, 공통 브랜드 + 의상 브랜드 4종 → 예외 발동 후 룩 수 부족 → paid_few_looks',
   typeOf(looksFor([['Common', 'A'], ['Common', 'B'], ['Common', 'C']]), mapFor([1, 1, 1])) === 'paid_few_looks');
ok('4 looks, 공통 브랜드 + 의상 브랜드 3종뿐 → 여전히 branded',
   typeOf(looksFor([['Gucci', 'A'], ['Gucci', 'B'], ['Gucci', 'A'], ['Gucci', 'B']]), mapFor([1, 1, 1, 1])) === 'branded');

console.log('\n=== priority: branded > paid_few_looks ===');
ok('2 shared-brand looks (< 4) → branded, NOT paid_few_looks',
   typeOf(looksFor([['Zara'], ['Zara']]), mapFor([1, 1])) === 'branded');
ok('3 shared-brand looks (< 4) → branded',
   typeOf(looksFor([['H&M'], ['H&M'], ['H&M']]), mapFor([1, 1, 1])) === 'branded');

console.log('\n=== defensive inputs ===');
ok('undefined/undefined → paid_few_looks without throwing',
   classifySubmissionType(undefined, undefined).submissionType === 'paid_few_looks');
ok('empty arrays → paid_few_looks',
   typeOf([], []) === 'paid_few_looks');
ok('lookImageMap entries with null/missing lookN are ignored',
   typeOf(looksFor([['A'], ['B'], ['C'], ['D']]),
     [{ lookN: 1 }, { lookN: null }, {}, { lookN: 2 }, { lookN: 3 }, { lookN: 4 }]) === 'free');

/* ── 2026-07-22 (도메니코 QA) — 핸들-온리 브랜디드 우회 구멍 회귀 ──
 * 실사례(Formositas): 4룩 전부 brand 공란 + 같은 인스타 핸들(@taely__n)
 * → 브랜드 집합이 전부 비어 union=0 → free 로 오분류. 브랜드명이 없으면
 * 인스타 핸들을 브랜드 식별자('@'+handle)로 사용해 잡는다. */
(function(){
  const mk = (handles) => handles.map((h,i)=>({n:i+1,items:[{type:'Dress',brand:'',instagram:h}]}));
  const map4 = [1,2,3,4].map(n=>({lookN:n,imgIdxInLook:0}));
  const same = classifySubmissionType(mk(['taely__n','@taely__n',' taely__n ','TAELY__N']), map4);
  ok('핸들-온리 단일(표기 변형 포함) 4룩 → branded', same.submissionType==='branded' && same.sharedBrands[0]==='@taely__n');
  const diff = classifySubmissionType(mk(['a1','b2','c3','d4']), map4);
  ok('핸들-온리 상이 4룩 → free (오탐 없음)', diff.submissionType==='free');
  const mixed = classifySubmissionType([
    {n:1,items:[{type:'Dress',brand:'Gucci',instagram:''}]},
    {n:2,items:[{type:'Shoes',brand:'',instagram:'other_h'}]},
    {n:3,items:[{type:'Top',brand:'Prada',instagram:''}]},
    {n:4,items:[{type:'Other',brand:'',instagram:'third_h'}]},
  ], map4);
  ok('브랜드·핸들 혼합 상이 4룩 → free', mixed.submissionType==='free');
  const two = classifySubmissionType(mk(['same_h','same_h']), [1,2].map(n=>({lookN:n,imgIdxInLook:0})));
  ok('핸들-온리 공유 2룩 → branded (교집합 트리거)', two.submissionType==='branded');
})();

/* ── 2026-08-03 (도메니코 지시) — 다중 브랜드 예외 ──────────────────────────
 * 공통 브랜드 A가 모든 룩에 들어가 있어도, 의상 슬롯(Jacket/Top/Skirt/Pants…)에
 * 다른 브랜드들이 골고루 함께 들어가 서로 다른 의상 브랜드가 4종 이상이면
 * A의 브랜디드 콘텐츠로 볼 수 없다 → branded 해제.
 * 숫자 4 = submission.html 약관 ①("minimum of 4 different clothing brands").
 * 액세서리(Shoes/Boots/Bag/Hat/Belt/Necklace/Glasses/Scarf/Gloves/Other)는
 * 의상이 아니므로 예외 계산에서 제외 — 액세서리로는 예외를 못 만든다. */
console.log('\n=== 다중 브랜드 예외 (2026-08-03) ===');
(function () {
  const map = (counts) => mapFor(counts);
  const L = (n, items) => ({ n, items });

  // 의상 브랜드 정확히 4종 → 예외 발동 (경계값 ≥ 4)
  const four = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: 'A' }, { type: 'Top', brand: 'B' }]),
    L(2, [{ type: 'Jacket', brand: 'A' }, { type: 'Pants', brand: 'C' }]),
    L(3, [{ type: 'Jacket', brand: 'A' }, { type: 'Skirt', brand: 'D' }]),
    L(4, [{ type: 'Jacket', brand: 'A' }, { type: 'Coat', brand: 'B' }]),
  ], map([1, 1, 1, 1]));
  ok('의상 브랜드 정확히 4종 → free (예외 발동)',
     four.submissionType === 'free' && four.multiBrandExempt === true
     && four.clothingBrandCount === 4,
     JSON.stringify(four));
  ok('예외로 해제돼도 sharedBrands 는 남는다 (관리자 참고용)',
     four.sharedBrands.length === 1 && four.sharedBrands[0] === 'a',
     JSON.stringify(four.sharedBrands));

  // 의상 브랜드 3종 → 예외 미발동 (경계값 바로 아래)
  const three = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: 'A' }, { type: 'Top', brand: 'B' }]),
    L(2, [{ type: 'Jacket', brand: 'A' }, { type: 'Pants', brand: 'C' }]),
    L(3, [{ type: 'Jacket', brand: 'A' }, { type: 'Skirt', brand: 'B' }]),
    L(4, [{ type: 'Jacket', brand: 'A' }, { type: 'Coat', brand: 'C' }]),
  ], map([1, 1, 1, 1]));
  ok('의상 브랜드 3종 → branded 유지 (예외 미발동)',
     three.submissionType === 'branded' && three.multiBrandExempt === false
     && three.clothingBrandCount === 3,
     JSON.stringify(three));

  // 액세서리는 아무리 많아도 예외를 만들지 못한다
  const acc = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'A' }, { type: 'Shoes', brand: 'S1' }, { type: 'Bag', brand: 'S2' }]),
    L(2, [{ type: 'Dress', brand: 'A' }, { type: 'Hat', brand: 'S3' }, { type: 'Belt', brand: 'S4' }]),
    L(3, [{ type: 'Dress', brand: 'A' }, { type: 'Necklace', brand: 'S5' }, { type: 'Boots', brand: 'S6' }]),
    L(4, [{ type: 'Dress', brand: 'A' }, { type: 'Glasses', brand: 'S7' }, { type: 'Other', brand: 'S8' }]),
  ], map([1, 1, 1, 1]));
  ok('의상은 A 하나 + 액세서리만 8종 → 여전히 branded (액세서리는 안 셈)',
     acc.submissionType === 'branded' && acc.clothingBrandCount === 1,
     JSON.stringify(acc));

  // 예외는 "무조건 무료"가 아니다 — 룩 수 규칙이 다시 적용된다
  const fewLooks = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: 'A' }, { type: 'Top', brand: 'B' }, { type: 'Skirt', brand: 'C' }]),
    L(2, [{ type: 'Jacket', brand: 'A' }, { type: 'Pants', brand: 'D' }]),
  ], map([1, 1]));
  ok('예외 발동 + 실제 룩 2개 → free 아니라 paid_few_looks',
     fewLooks.submissionType === 'paid_few_looks' && fewLooks.multiBrandExempt === true,
     JSON.stringify(fewLooks));

  // 이미지 없는 룩의 의상 브랜드는 예외 계산에 안 들어간다
  const ghost = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'A' }]),
    L(2, [{ type: 'Dress', brand: 'A' }]),
    L(3, [{ type: 'Top', brand: 'B' }, { type: 'Pants', brand: 'C' }, { type: 'Coat', brand: 'D' }]),
  ], map([1, 1, 0]));
  ok('이미지 0장인 룩의 의상 브랜드는 예외 계산에서 제외 → branded 유지',
     ghost.submissionType === 'branded' && ghost.clothingBrandCount === 1,
     JSON.stringify(ghost));

  // 브랜드명 공란 + 핸들만 있어도 의상 슬롯이면 예외 계산에 포함
  const handles = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: '', instagram: '@a' }, { type: 'Top', brand: '', instagram: '@b' }]),
    L(2, [{ type: 'Jacket', brand: '', instagram: '@a' }, { type: 'Pants', brand: '', instagram: '@c' }]),
    L(3, [{ type: 'Jacket', brand: '', instagram: '@a' }, { type: 'Skirt', brand: '', instagram: '@d' }]),
    L(4, [{ type: 'Jacket', brand: '', instagram: '@a' }, { type: 'Coat', brand: '', instagram: '@b' }]),
  ], map([1, 1, 1, 1]));
  ok('핸들-온리 의상 크레딧도 예외 계산에 포함 → free',
     handles.submissionType === 'free' && handles.clothingBrandCount === 4,
     JSON.stringify(handles));

  // 단일 브랜드 트리거 (a) 는 예외와 무관하게 그대로 branded
  const solo = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: 'Solo' }, { type: 'Top', brand: 'Solo' }]),
    L(2, [{ type: 'Pants', brand: 'Solo' }, { type: 'Shoes', brand: 'Solo' }]),
    L(3, [{ type: 'Coat', brand: 'Solo' }]),
    L(4, [{ type: 'Dress', brand: 'Solo' }]),
  ], map([1, 1, 1, 1]));
  ok('전 룩 단일 브랜드 → branded (예외 불가, 의상 브랜드 1종)',
     solo.submissionType === 'branded', JSON.stringify(solo));

  // 실사례 회귀: Bounty Law (submission 13299e55-7db7-4260-b7d6-f25cbfeeec7e)
  // NAMILIA 가 6룩 전부에 있지만 의상 브랜드는 7종 → 무료 서브미션.
  const bounty = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: 'NAMILIA' }, { type: 'Top', brand: 'NAMILIA' }, { type: 'Skirt', brand: 'Simone Rocha' }, { type: 'Belt', brand: 'Dsquared2' }, { type: 'Glasses', brand: 'Celine' }, { type: 'Shoes', brand: 'Ferragamo' }, { type: 'Bag', brand: 'Holzweiler' }]),
    L(2, [{ type: 'Jacket', brand: 'RRL' }, { type: 'Top', brand: 'NAMILIA' }, { type: 'Pants', brand: 'NAMILIA' }, { type: 'Shoes', brand: 'Camper LAB' }, { type: 'Necklace', brand: 'AllSaints' }, { type: 'Other', brand: 'Fur Collar - Holzweiler' }]),
    L(3, [{ type: 'Top', brand: 'NAMILIA' }, { type: 'Pants', brand: 'Nensi Dojaka' }, { type: 'Shoes', brand: 'Miste' }, { type: 'Hat', brand: 'Sensi Studio' }, { type: 'Belt', brand: 'Dsquared2' }, { type: 'Necklace', brand: 'AllSaints' }]),
    L(4, [{ type: 'Jacket', brand: 'NAMILIA' }, { type: 'Pants', brand: 'NAMILIA' }, { type: 'Shoes', brand: 'Sendra' }, { type: 'Glasses', brand: 'The Attico' }, { type: 'Gloves', brand: 'Roeckel' }, { type: 'Scarf', brand: 'Won Hundred' }]),
    L(5, [{ type: 'Jacket', brand: 'KNWLS' }, { type: 'Skirt', brand: 'NAMILIA' }, { type: 'Boots', brand: 'NAMILIA' }, { type: 'Hat', brand: 'NAMILIA' }, { type: 'Other', brand: 'String - NAMILIA' }]),
    L(6, [{ type: 'Coat', brand: 'NAMILIA' }, { type: 'Pants', brand: 'Acne Studios' }, { type: 'Top', brand: 'Dsquared2' }, { type: 'Boots', brand: 'New Rock' }, { type: 'Hat', brand: 'Sensi Studio' }]),
  ], map([5, 5, 5, 4, 5, 8]));
  ok('실사례 Bounty Law → free (의상 브랜드 7종, NAMILIA 전 룩 공통이지만 예외)',
     bounty.submissionType === 'free' && bounty.clothingBrandCount === 7
     && bounty.multiBrandExempt === true,
     JSON.stringify(bounty));
})();

/* ── 2026-08-10 (도메니코 지시) — ACCESSORY-ONLY 예외 ────────────────────────
 * 기존 규칙의 비대칭: branded 로 집어넣을 때는 모든 슬롯을 보는데(신발·모자도
 * 트리거), 빼줄 때는 의상 슬롯만 봤다. 그래서 스타일리스트가 신발 한 브랜드를
 * 전 룩에 돌려 신기면 브랜디드 게재료가 붙었다.
 * 새 규칙: 공통 브랜드가 실제 룩의 의상 슬롯에 단 한 번도 안 나오면 branded 해제.
 * 단 clothingBrandCount >= 1 을 요구한다 — 의상 슬롯을 하나도 안 채운 제출까지
 * 풀어주면 "전부 Other 로 태깅하면 브랜디드를 영영 피한다"는 우회로가 생긴다. */
console.log('\n=== ACCESSORY-ONLY 예외 (2026-08-10) ===');
(function () {
  const L = (n, items) => ({ n, items });

  // 실사례 회귀: REVERIE (submission 6b7bfd7a-ee0d-4c63-bc76-670bc9c29f6a)
  // 전 룩 공통은 Somechic Studio(Shoes) 하나뿐이고 의상은 MOIRAI/Roberto Cavalli.
  const reverie = classifySubmissionType([
    L(1, [{ type: 'Top', brand: 'MOIRAI store' }, { type: 'Dress', brand: 'MOIRAI store' }, { type: 'Other', brand: 'Falke' }, { type: 'Shoes', brand: 'Somechic Studio' }]),
    L(2, [{ type: 'Jacket', brand: 'Roberto Cavalli' }, { type: 'Other', brand: 'Wolford' }, { type: 'Shoes', brand: 'Somechic Studio' }, { type: 'Hat', brand: 'Massimo Dutti' }]),
    L(3, [{ type: 'Dress', brand: 'MOIRAI store' }, { type: 'Belt', brand: 'Sezane' }, { type: 'Gloves', brand: 'Furla' }, { type: 'Other', brand: 'Falke' }, { type: 'Shoes', brand: 'Somechic Studio' }, { type: 'Hat', brand: 'Massimo Dutti' }]),
    L(4, [{ type: 'Top', brand: 'MOIRAI store' }, { type: 'Dress', brand: 'MOIRAI store' }, { type: 'Jacket', brand: 'MOIRAI store' }, { type: 'Other', brand: 'Falke' }, { type: 'Shoes', brand: 'Somechic Studio' }, { type: 'Hat', brand: 'Massimo Dutti' }]),
  ], mapFor([5, 4, 5, 5]));
  ok('실사례 REVERIE → free (공통 브랜드가 신발 슬롯에만 등장)',
     reverie.submissionType === 'free' && reverie.accessoryOnlyExempt === true
     && reverie.clothingBrandCount === 2,
     JSON.stringify(reverie));
  ok('해제돼도 sharedBrands 는 남는다 (관리자가 겹침 사실을 볼 수 있게)',
     reverie.sharedBrands.length === 1 && reverie.sharedBrands[0] === 'somechic studio',
     JSON.stringify(reverie.sharedBrands));

  // 공통 브랜드가 의상 슬롯에 한 번이라도 나오면 해제되지 않는다
  const inClothing = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'A' }, { type: 'Shoes', brand: 'A' }]),
    L(2, [{ type: 'Top', brand: 'B' }, { type: 'Shoes', brand: 'A' }]),
    L(3, [{ type: 'Pants', brand: 'C' }, { type: 'Shoes', brand: 'A' }]),
    L(4, [{ type: 'Skirt', brand: 'B' }, { type: 'Shoes', brand: 'A' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('공통 브랜드가 룩1의 의상 슬롯에도 있으면 → branded 유지 (해제 안 됨)',
     inClothing.submissionType === 'branded' && inClothing.accessoryOnlyExempt === false,
     JSON.stringify(inClothing));

  // 우회로 차단: 의상 슬롯을 하나도 안 채우면 해제되지 않는다
  const allOther = classifySubmissionType([
    L(1, [{ type: 'Other', brand: 'A' }, { type: 'Shoes', brand: 'S1' }]),
    L(2, [{ type: 'Other', brand: 'A' }, { type: 'Bag', brand: 'S2' }]),
    L(3, [{ type: 'Other', brand: 'A' }, { type: 'Hat', brand: 'S3' }]),
    L(4, [{ type: 'Other', brand: 'A' }, { type: 'Belt', brand: 'S4' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('전부 Other/액세서리 태깅(의상 0종) → branded 유지 (우회로 차단)',
     allOther.submissionType === 'branded' && allOther.accessoryOnlyExempt === false
     && allOther.clothingBrandCount === 0,
     JSON.stringify(allOther));

  // 다중 브랜드 예외가 이미 걸린 건은 이 예외를 또 타지 않는다 (플래그 분리 확인)
  const alreadyExempt = classifySubmissionType([
    L(1, [{ type: 'Jacket', brand: 'A' }, { type: 'Top', brand: 'B' }, { type: 'Shoes', brand: 'Z' }]),
    L(2, [{ type: 'Jacket', brand: 'A' }, { type: 'Pants', brand: 'C' }, { type: 'Shoes', brand: 'Z' }]),
    L(3, [{ type: 'Jacket', brand: 'A' }, { type: 'Skirt', brand: 'D' }, { type: 'Shoes', brand: 'Z' }]),
    L(4, [{ type: 'Jacket', brand: 'A' }, { type: 'Coat', brand: 'B' }, { type: 'Shoes', brand: 'Z' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('다중 브랜드 예외가 먼저 걸리면 accessoryOnlyExempt 는 false',
     alreadyExempt.submissionType === 'free' && alreadyExempt.multiBrandExempt === true
     && alreadyExempt.accessoryOnlyExempt === false,
     JSON.stringify(alreadyExempt));

  // 해제는 "무조건 무료"가 아니다 — 룩 수 규칙이 다시 적용된다
  const fewLooks = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'M' }, { type: 'Shoes', brand: 'S' }]),
    L(2, [{ type: 'Jacket', brand: 'N' }, { type: 'Shoes', brand: 'S' }]),
  ], mapFor([1, 1]));
  ok('액세서리 전용 공통 + 실제 룩 2개 → free 아니라 paid_few_looks',
     fewLooks.submissionType === 'paid_few_looks' && fewLooks.accessoryOnlyExempt === true,
     JSON.stringify(fewLooks));

  // 단일 브랜드 트리거 (a): 그 브랜드가 액세서리 슬롯에만 있으면 의상 0종이라 유지
  const soloAccessory = classifySubmissionType([
    L(1, [{ type: 'Shoes', brand: 'Solo' }]),
    L(2, [{ type: 'Bag', brand: 'Solo' }]),
    L(3, [{ type: 'Hat', brand: 'Solo' }]),
    L(4, [{ type: 'Belt', brand: 'Solo' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('전 룩 단일 브랜드가 액세서리뿐 → branded 유지 (의상 0종 가드)',
     soloAccessory.submissionType === 'branded' && soloAccessory.accessoryOnlyExempt === false,
     JSON.stringify(soloAccessory));
})();

/* ── 클라이언트 미러 동기화 가드 ──────────────────────────────────────────────
 * frontend/submission.html 의 _papClassifySubmission() 은 이 모듈의 규칙을 그대로
 * 복제한다(제출 전 €790 사전 안내용). 서버만 고치고 미러를 안 고치면 크리에이터가
 * 본 안내와 실제 판정이 어긋난다. 소스에 규칙이 남아 있는지만 확인한다. */
/* ── 2026-08-11 (도메니코 지시) — SINGLE-CLOTHING-BRAND ─────────────────────
 * 실제 룩의 의상 슬롯 브랜드가 정확히 1종이면 무조건 branded.
 * 위 두 예외(multiBrand·accessoryOnly)보다 나중에 적용해 덮는다.
 * 0종은 제외 — "옷이 한 브랜드"가 아니라 "의상 태깅을 안 했다"는 뜻이므로
 * needsCreditReview 로 관리자에게 넘긴다. */
console.log('\n=== SINGLE-CLOTHING-BRAND (2026-08-11) ===');
(function () {
  const L = (n, items) => ({ n, items });

  // 실사례 회귀: insides (submission afe5cbad-ba08-4d1a-a4e2-4970702f781d)
  // 룩3 의 유일한 크레딧이 모자라 "모든 룩 공통" 교집합이 비어 free 로 통과했었다.
  const insides = classifySubmissionType([
    L(1, [{ type: 'Top',   brand: 'Juana Echeguia',    instagram: '@x.jjuana' }]),
    L(2, [{ type: 'Dress', brand: 'Juana Echeguia',    instagram: '@x.jjuana' }]),
    L(3, [{ type: 'Hat',   brand: 'Juan El Daltonico', instagram: '@juaneldaltonico' }]),
    L(4, [{ type: 'Other', brand: 'Juana Echeguia',    instagram: '@x.jjuana' }]),
  ], mapFor([4, 6, 7, 3]));
  ok('실사례 insides → branded (옷이 Juana Echeguia 1종뿐)',
     insides.submissionType === 'branded' && insides.singleClothingBrand === true
     && insides.clothingBrandCount === 1,
     JSON.stringify(insides));
  ok('공통 브랜드 교집합은 여전히 비어 있다 (옛 트리거로는 못 잡는 케이스임을 고정)',
     insides.sharedBrands.length === 0, JSON.stringify(insides.sharedBrands));

  // 의상 2종이면 이 규칙은 안 걸린다 (경계값 바로 위)
  const two = classifySubmissionType([
    L(1, [{ type: 'Top', brand: 'A' }]),
    L(2, [{ type: 'Dress', brand: 'B' }]),
    L(3, [{ type: 'Hat', brand: 'C' }]),
    L(4, [{ type: 'Top', brand: 'B' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('의상 2종 → 이 규칙 미발동',
     two.singleClothingBrand === false && two.clothingBrandCount === 2,
     JSON.stringify(two));

  // 0종은 브랜디드로 만들지 않는다 — 대신 needsCreditReview
  const zero = classifySubmissionType([
    L(1, [{ type: 'Hat', brand: 'A' }]),
    L(2, [{ type: 'Shoes', brand: 'B' }]),
    L(3, [{ type: 'Bag', brand: 'C' }]),
    L(4, [{ type: 'Other', brand: 'D' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('의상 0종 → branded 로 만들지 않는다 (판단 불가)',
     zero.singleClothingBrand === false && zero.clothingBrandCount === 0,
     JSON.stringify(zero));
  ok('의상 0종 → needsCreditReview = true (관리자 확인 대상)',
     zero.needsCreditReview === true, JSON.stringify(zero));
  ok('의상이 있으면 needsCreditReview = false',
     two.needsCreditReview === false, JSON.stringify(two));

  // 이 규칙은 ACCESSORY-ONLY 예외를 덮는다 (적용 순서 고정)
  const overrides = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'OneLabel' }, { type: 'Shoes', brand: 'Shared' }]),
    L(2, [{ type: 'Top',   brand: 'OneLabel' }, { type: 'Shoes', brand: 'Shared' }]),
    L(3, [{ type: 'Coat',  brand: 'OneLabel' }, { type: 'Shoes', brand: 'Shared' }]),
    L(4, [{ type: 'Pants', brand: 'OneLabel' }, { type: 'Shoes', brand: 'Shared' }]),
  ], mapFor([1, 1, 1, 1]));
  ok('액세서리 전용 공통이 있어도, 옷이 1종이면 branded 가 이긴다',
     overrides.submissionType === 'branded' && overrides.singleClothingBrand === true,
     JSON.stringify(overrides));

  // 이미지 없는 룩의 의상은 세지 않는다 → 1종 판정에 영향
  const ghost = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'Solo' }]),
    L(2, [{ type: 'Dress', brand: 'Solo' }]),
    L(3, [{ type: 'Top', brand: 'Other1' }, { type: 'Pants', brand: 'Other2' }]),
    L(4, [{ type: 'Coat', brand: 'Other3' }]),
  ], mapFor([1, 1, 0, 0]));
  ok('이미지 0장 룩의 의상은 세지 않는다 → 옷 1종 → branded',
     ghost.submissionType === 'branded' && ghost.clothingBrandCount === 1,
     JSON.stringify(ghost));

  // 룩 수가 모자라도 branded 가 우선 (기존 우선순위 유지)
  const few = classifySubmissionType([
    L(1, [{ type: 'Dress', brand: 'Solo' }]),
    L(2, [{ type: 'Hat', brand: 'Acc' }]),
  ], mapFor([1, 1]));
  ok('옷 1종 + 룩 2개 → paid_few_looks 아니라 branded',
     few.submissionType === 'branded', JSON.stringify(few));
})();

console.log('\n=== 클라이언트 미러 동기화 ===');
(function () {
  const fs = require('fs');
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', 'frontend', 'submission.html'), 'utf8');
  ok('submission.html 미러에 accessoryOnlyExempt 규칙이 있다',
     html.includes('accessoryOnlyExempt'));
  ok('submission.html 미러가 sharedBrands 를 계산한다',
     html.includes('sharedBrands'));
  ok('submission.html 미러에 의상 0종 우회로 가드(clothingCount>=1)가 있다',
     /accessoryOnlyExempt[\s\S]{0,200}clothingCount\s*>=\s*1/.test(html));
  ok('submission.html 미러에 singleClothingBrand 규칙이 있다',
     html.includes('singleClothingBrand'));
  ok('미러의 singleClothingBrand 는 정확히 1종만 본다 (0종 제외)',
     /singleClothingBrand\s*=\s*clothingCount\s*===\s*1/.test(html));
  ok('미러에 needsCreditReview 가 있다', html.includes('needsCreditReview'));
})();

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) {
  console.log('\n⚠  FAILURES:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
console.log('✓ submission-type tests passed');
process.exit(0);
