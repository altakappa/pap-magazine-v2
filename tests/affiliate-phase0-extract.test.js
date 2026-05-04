/**
 * PAP Magazine — Brand-extractor unit tests.
 *
 * Covers api/_lib/brandExtract.js end-to-end against synthetic editorials
 * shaped like the three storage formats we know exist in production:
 *
 *   A. {r, h:[{n,id}]}                       (display format, most common)
 *   B. {roles, name, instagram}              (newer admin saves)
 *   C. legacy dict {role: value}             (oldest entries)
 *
 * Plus the editorial-level `fashion` field which is brand-only and seen
 * on 99.8% of editorials per the static-snapshot survey.
 *
 * Same test harness style as the other phase-0 tests so npm test stays
 * uniform.
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const {
  BRAND_ROLE_LABELS,
  isBrandRole,
  tokensFromHandle,
  extractFromEditorial,
  aggregate,
} = require(path.join(ROOT, 'api/_lib/brandExtract.js'));

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); fail++; }
}

// ── isBrandRole ─────────────────────────────────────────────────────────
console.log('\n=== isBrandRole ===');

it('matches "Fashion by"', () => assert.strictEqual(isBrandRole('Fashion by'), true));
it('matches "fashion by" (case-insensitive)', () => assert.strictEqual(isBrandRole('fashion by'), true));
it('matches "함께한 브랜드"', () => assert.strictEqual(isBrandRole('함께한 브랜드'), true));
it('matches "Beauty by"', () => assert.strictEqual(isBrandRole('Beauty by'), true));
it('rejects crew roles', () => {
  assert.strictEqual(isBrandRole('Photography'), false);
  assert.strictEqual(isBrandRole('Hair'), false);
  assert.strictEqual(isBrandRole('Stylist'), false);
  assert.strictEqual(isBrandRole('Photographer'), false);
});
it('rejects empty/null', () => {
  assert.strictEqual(isBrandRole(null), false);
  assert.strictEqual(isBrandRole(undefined), false);
  assert.strictEqual(isBrandRole(''), false);
});

// ── tokensFromHandle ────────────────────────────────────────────────────
console.log('\n=== tokensFromHandle (split + normalise) ===');

it('uses id (Instagram handle) when both id and n exist', () => {
  const out = tokensFromHandle({ n: 'Rick Owens', id: '@rickowensonline' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].normalized, 'rickowensonline');
  assert.strictEqual(out[0].raw, '@rickowensonline');
});

it('falls back to n when id absent', () => {
  const out = tokensFromHandle({ n: 'Rick Owens' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].normalized, 'rick_owens');
});

it('splits on commas: "@a, @b, @c" → 3 tokens', () => {
  const out = tokensFromHandle({ n: '@a, @b, @c' });
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(t => t.normalized), ['a', 'b', 'c']);
});

it('splits on semicolons + slash + pipe', () => {
  const out = tokensFromHandle({ n: 'a;b/c|d' });
  assert.strictEqual(out.length, 4);
  assert.deepStrictEqual(out.map(t => t.normalized), ['a', 'b', 'c', 'd']);
});

it('drops empty tokens from delimiter runs', () => {
  const out = tokensFromHandle({ n: 'a,,b,/c' });
  assert.strictEqual(out.length, 3);
});

it('returns empty array for nullish / empty input', () => {
  assert.strictEqual(tokensFromHandle(null).length, 0);
  assert.strictEqual(tokensFromHandle({}).length, 0);
  assert.strictEqual(tokensFromHandle({ id: '', n: '' }).length, 0);
});

it('strips region suffix via normaliseAlias chain', () => {
  const out = tokensFromHandle({ id: '@maccosmeticsnordics' });
  // Suffix-stripping is `_nordics` only, so the run-on stays. (Same behaviour
  // as the seed table — see SPEC §1.4 + the brandAlias.test cases.)
  assert.strictEqual(out[0].normalized, 'maccosmeticsnordics');
});

// ── extractFromEditorial: format A (display shape) ──────────────────────
console.log('\n=== extractFromEditorial: format A {r, h} ===');

it('pulls brand handles from credits with "Fashion by"', () => {
  const ed = {
    id: 'ed1',
    credits: [
      { r: 'Photography', h: [{ n: 'Photographer', id: '@p' }] },
      { r: 'Fashion by',  h: [{ n: 'Balenciaga', id: '@balenciaga' }, { n: 'Rick Owens', id: '@rickowens' }] },
    ],
  };
  const { brandTokens, seenRoles } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 2);
  assert.deepStrictEqual(brandTokens.map(t => t.normalized).sort(), ['balenciaga', 'rickowens']);
  // Photography role recorded but not extracted as brand
  assert.deepStrictEqual(seenRoles.sort(), ['Fashion by', 'Photography']);
});

it('skips credits with non-brand roles', () => {
  const ed = {
    id: 'ed2',
    credits: [
      { r: 'Hair', h: [{ n: 'Stylist', id: '@hairstylist' }] },
    ],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 0);
});

it('handles "함께한 브랜드" Korean role', () => {
  const ed = {
    id: 'ed3',
    credits: [
      { r: '함께한 브랜드', h: [{ n: 'Mugler', id: '@mugler' }] },
    ],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].normalized, 'mugler');
  // (Note: @muglerofficial normalises to "muglerofficial" because suffix
  //  stripping requires an underscore separator. Resolution to the
  //  canonical "mugler" brand_id happens via the brand_aliases lookup
  //  table, not at the normalisation stage.)
});

// ── extractFromEditorial: format B (admin shape) ────────────────────────
console.log('\n=== extractFromEditorial: format B {roles, name, instagram} ===');

it('pulls from credits with roles array containing Fashion by', () => {
  const ed = {
    id: 'ed4',
    credits: [
      { roles: ['Fashion by', 'Styling'], name: 'Balenciaga', instagram: '@balenciaga' },
      { roles: ['Photography'], name: 'X', instagram: '@x' },
    ],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].normalized, 'balenciaga');
});

it('handles single role string (older variant)', () => {
  const ed = {
    id: 'ed5',
    credits: [
      { role: 'Fashion by', name: 'Diesel', instagram: '@diesel' },
    ],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].normalized, 'diesel');
});

// ── extractFromEditorial: format C (legacy dict) ────────────────────────
console.log('\n=== extractFromEditorial: format C legacy dict ===');

it('pulls brand role from dict-style credits with object value', () => {
  const ed = {
    id: 'ed6',
    credits: {
      'Fashion by': { name: 'Saint Laurent', instagram: '@ysl' },
      'Photography': { name: 'P', instagram: '@p' },
    },
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].normalized, 'ysl');
});

it('handles dict-style with string value (split on commas)', () => {
  const ed = {
    id: 'ed7',
    credits: {
      'Fashion by': '@a, @b, @c',
    },
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 3);
});

// ── editorial.fashion field ─────────────────────────────────────────────
console.log('\n=== editorial.fashion (brand-only by definition) ===');

it('extracts everything from fashion[] regardless of role filter', () => {
  const ed = {
    id: 'ed8',
    fashion: [
      { n: 'Calzedonia', id: '@calzedonia' },
      { n: 'Converse', id: '@converse' },
    ],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 2);
  assert.deepStrictEqual(brandTokens.map(t => t.source), ['fashion', 'fashion']);
});

it('handles fashion as { brands: [...] } variant', () => {
  const ed = {
    id: 'ed9',
    fashion: { brands: [{ n: 'Diesel', id: '@diesel' }] },
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].normalized, 'diesel');
});

// ── aggregate ───────────────────────────────────────────────────────────
console.log('\n=== aggregate ===');

it('counts occurrences across editorials, dedups by normalized form', () => {
  const corpus = [
    { id: 'a', fashion: [{ n: 'Balenciaga', id: '@balenciaga' }] },
    { id: 'b', credits: [{ r: 'Fashion by', h: [{ n: 'Balenciaga', id: '@BALENCIAGA' }] }] },
    { id: 'c', credits: [{ r: 'Fashion by', h: [{ n: 'Balenciaga', id: '@balenciaga_official' }] }] },
    { id: 'd', fashion: [{ n: 'Diesel', id: '@diesel' }] },
  ];
  const r = aggregate(corpus, { frequentThreshold: 3 });
  // balenciaga: 3 occurrences across 3 editorials
  // diesel: 1 occurrence in 1 editorial
  const bal = r.frequent_aliases.find(a => a.alias === 'balenciaga');
  assert.ok(bal, 'balenciaga should be frequent');
  assert.strictEqual(bal.occurrences_total, 3);
  assert.strictEqual(bal.editorials_count, 3);

  const dies = r.rare_aliases.find(a => a.alias === 'diesel');
  assert.ok(dies, 'diesel should be rare (only 1 occurrence)');
  assert.strictEqual(dies.occurrences_total, 1);
});

it('separates frequent (≥ threshold) from rare (< threshold)', () => {
  const corpus = [
    { id: 'a', fashion: [{ n: 'Foo', id: '@foo' }, { n: 'Foo', id: '@foo' }, { n: 'Foo', id: '@foo' }] },
    { id: 'b', fashion: [{ n: 'Bar', id: '@bar' }] },
  ];
  const r = aggregate(corpus, { frequentThreshold: 3 });
  assert.strictEqual(r.frequent_aliases.length, 1);  // foo
  assert.strictEqual(r.rare_aliases.length, 1);      // bar
});

it('sorts frequent_aliases by occurrences DESC', () => {
  const corpus = [
    { id: 'a', fashion: [{ id: '@a' }, { id: '@a' }, { id: '@a' }] },
    { id: 'b', fashion: [{ id: '@b' }, { id: '@b' }, { id: '@b' }, { id: '@b' }, { id: '@b' }] },
    { id: 'c', fashion: [{ id: '@c' }, { id: '@c' }, { id: '@c' }, { id: '@c' }] },
  ];
  const r = aggregate(corpus, { frequentThreshold: 3 });
  assert.deepStrictEqual(r.frequent_aliases.map(a => a.alias), ['b', 'c', 'a']);
});

it('records every role label in role_stats AND surfaces non-brand roles', () => {
  const corpus = [
    { id: 'a', credits: [
      { r: 'Photography', h: [{ id: '@p' }] },
      { r: 'Some Weird Role', h: [{ id: '@x' }] },
      { r: 'Fashion by', h: [{ id: '@b' }] },
    ]},
  ];
  const r = aggregate(corpus);
  assert.strictEqual(r.role_stats['Photography'], 1);
  assert.strictEqual(r.role_stats['Some Weird Role'], 1);
  assert.strictEqual(r.role_stats['Fashion by'], 1);
  assert.ok(r.unknown_roles.includes('Photography'));
  assert.ok(r.unknown_roles.includes('Some Weird Role'));
  assert.ok(!r.unknown_roles.includes('Fashion by')); // it IS a brand role
});

it('records sources (fashion vs credits) per alias', () => {
  const corpus = [
    { id: 'a', fashion: [{ id: '@x' }] },
    { id: 'b', credits: [{ r: 'Fashion by', h: [{ id: '@x' }] }] },
    { id: 'c', credits: [{ r: 'Fashion by', h: [{ id: '@x' }] }] },
  ];
  const r = aggregate(corpus, { frequentThreshold: 3 });
  const x = r.frequent_aliases.find(a => a.alias === 'x');
  assert.deepStrictEqual(x.sources.sort(), ['credits', 'fashion']);
});

it('summary numbers add up', () => {
  const corpus = [
    { id: 'a', fashion: [{ id: '@x' }] },
    { id: 'b', credits: [] },
    { id: 'c', fashion: [{ id: '@y' }, { id: '@y' }, { id: '@y' }] },
  ];
  const r = aggregate(corpus, { frequentThreshold: 3 });
  assert.strictEqual(r.summary.editorials_scanned, 3);
  assert.strictEqual(r.summary.editorials_with_brand_signal, 2); // a + c
  assert.strictEqual(r.summary.unique_aliases, 2); // x + y
  assert.strictEqual(r.summary.frequent_count, 1); // y (3 occurrences)
  assert.strictEqual(r.summary.rare_count, 1);     // x (1 occurrence)
});

// ── Done ────────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) {
  console.error('\n✗ affiliate-phase0-extract tests FAILED');
  process.exit(1);
}
console.log('✓ affiliate-phase0-extract tests passed');
