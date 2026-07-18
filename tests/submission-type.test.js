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
ok('4 looks, brand shared across all among other brands → branded (intersection non-empty)',
   typeOf(looksFor([['Gucci', 'A'], ['Gucci', 'B'], ['Gucci', 'C'], ['Gucci', 'D']]), mapFor([1, 1, 1, 1])) === 'branded');
ok('3 looks each with 2 brands, one brand common to all → branded',
   typeOf(looksFor([['Common', 'A'], ['Common', 'B'], ['Common', 'C']]), mapFor([1, 1, 1])) === 'branded');

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

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) {
  console.log('\n⚠  FAILURES:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
console.log('✓ submission-type tests passed');
process.exit(0);
