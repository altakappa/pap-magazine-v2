// PAP Magazine — Submission-type classification test
//
// Guards the 2026-07-19 DETECT + GUIDE + STORE feature: submissions are routed
// into 'free' | 'paid_few_looks' (€345) | 'branded' (€720) buckets. Payment and
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

console.log('\n=== paid_few_looks (€345) ===');
ok('3 looks, distinct brands → paid_few_looks',
   typeOf(looksFor([['A'], ['B'], ['C']]), mapFor([1, 1, 1])) === 'paid_few_looks');
ok('1 real look with 2+ DISTINCT brands → paid_few_looks (trigger is "one brand", not met)',
   typeOf(looksFor([['Alpha', 'Beta']]), mapFor([1])) === 'paid_few_looks');
ok('seeded-but-empty look blocks (0 images) → paid_few_looks (realLookCount 0, union empty)',
   typeOf(looksFor([['A'], ['B'], ['C'], ['D']]), []) === 'paid_few_looks');
ok('3 looks, distinct brands, no single/shared brand → paid_few_looks',
   typeOf(looksFor([['Nike'], ['Adidas'], ['Puma']]), mapFor([1, 1, 1])) === 'paid_few_looks');

console.log('\n=== branded (€720) — single-brand trigger (a), look count irrelevant ===');
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

console.log('\n=== branded (€720) — shared-brand trigger (b), ≥2 looks share a common brand ===');
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

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) {
  console.log('\n⚠  FAILURES:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
console.log('✓ submission-type tests passed');
process.exit(0);
