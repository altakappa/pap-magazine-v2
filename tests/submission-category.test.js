// PAP Magazine — Submission category normalization test
//
// Regression guard for FIX-1 (2026-07-19): the selected genre/category used to
// be written ONLY into the description JSON, leaving submissions.category NULL
// for all 80 rows. The POST handler in api/submissions/index.js now normalizes
// + whitelists data.genre and stores the primary pick in the `category` column.
//
// This exercises the REAL production helper (api/_lib/submissionCategories.js),
// which the handler imports — NOT a re-implementation — so the test can't drift
// away from what actually runs.
//
// Run with `node tests/submission-category.test.js` (wired into `npm test`).
// Exits non-zero on any failure.

'use strict';

const path = require('path');
const { ALLOWED_CATEGORIES, normalizeGenres } =
  require(path.resolve(__dirname, '..', 'api', '_lib', 'submissionCategories'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push({ label, detail });
    failed++;
  }
}

function eqArr(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((v, i) => v === b[i]);
}

// `primary` mirrors what the handler persists into submissions.category.
function primaryOf(list) {
  const norm = normalizeGenres(list);
  return norm.length ? norm[0] : null;
}

console.log('\n=== whitelist integrity ===');
ok('ALLOWED_CATEGORIES has exactly the 8 submission.html buttons',
   eqArr(ALLOWED_CATEGORIES,
     ['FASHION', 'BEAUTY', 'ART', 'PORTRAIT', 'STREET', 'FASHION SHOW', 'BACKSTAGE', 'ARTICLE']),
   JSON.stringify(ALLOWED_CATEGORIES));

console.log('\n=== FIX-1 required cases ===');

// (a) multi-select FASHION + ART → normalized both, primary = FASHION
ok("(a) ['FASHION','ART'] → both kept, category = 'FASHION'",
   eqArr(normalizeGenres(['FASHION', 'ART']), ['FASHION', 'ART'])
     && primaryOf(['FASHION', 'ART']) === 'FASHION',
   JSON.stringify(normalizeGenres(['FASHION', 'ART'])));

// (b) lowercase + trailing space + internal spacing → canonical 'FASHION SHOW'
ok("(b) 'fashion show ' → 'FASHION SHOW'",
   eqArr(normalizeGenres(['fashion show ']), ['FASHION SHOW'])
     && primaryOf(['fashion show ']) === 'FASHION SHOW',
   JSON.stringify(normalizeGenres(['fashion show '])));

// (b') collapse multiple internal spaces too (normalization robustness)
ok("(b') 'fashion   show' (multi-space) → 'FASHION SHOW'",
   eqArr(normalizeGenres(['fashion   show']), ['FASHION SHOW']),
   JSON.stringify(normalizeGenres(['fashion   show'])));

// (c) arbitrary value 'HACK' is filtered out entirely
ok("(c) 'HACK' is filtered; valid sibling survives",
   eqArr(normalizeGenres(['HACK', 'ART']), ['ART'])
     && normalizeGenres(['HACK']).indexOf('HACK') === -1,
   JSON.stringify(normalizeGenres(['HACK', 'ART'])));

// (d) all arbitrary values → empty array (handler turns this into a 400)
ok("(d) all-arbitrary ['HACK','<script>','FASHIONISTA'] → [] (400 target)",
   eqArr(normalizeGenres(['HACK', '<script>', 'FASHIONISTA']), []),
   JSON.stringify(normalizeGenres(['HACK', '<script>', 'FASHIONISTA'])));

// (e) duplicate removal (post-normalization, so mixed-case dupes collapse)
ok("(e) ['FASHION','fashion ','FASHION'] → ['FASHION'] (dedup)",
   eqArr(normalizeGenres(['FASHION', 'fashion ', 'FASHION']), ['FASHION']),
   JSON.stringify(normalizeGenres(['FASHION', 'fashion ', 'FASHION'])));

console.log('\n=== defensive / edge inputs ===');

// Non-array input must not throw and yields [] (handler pre-validates, but the
// helper is defensive so a future caller can't crash on it).
ok('non-array input (undefined) → [] without throwing',
   eqArr(normalizeGenres(undefined), []));
ok('non-array input (string) → [] without throwing',
   eqArr(normalizeGenres('FASHION'), []));

// null / non-string members are coerced safely and filtered out.
ok('mixed [null, 42, "BEAUTY"] → ["BEAUTY"] (null/number dropped)',
   eqArr(normalizeGenres([null, 42, 'BEAUTY']), ['BEAUTY']),
   JSON.stringify(normalizeGenres([null, 42, 'BEAUTY'])));

// order of the surviving primary reflects submission order, not whitelist order
ok("primary follows submit order: ['ART','FASHION'] → 'ART'",
   primaryOf(['ART', 'FASHION']) === 'ART');

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) {
  console.log('\n⚠  FAILURES:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
console.log('✓ submission-category tests passed');
process.exit(0);
