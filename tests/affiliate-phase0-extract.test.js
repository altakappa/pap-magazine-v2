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
  STOP_ALIASES,
  isBrandRole,
  isStopAlias,
  inferCategory,
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

// ── Title-based dedup (DB ⊕ static union) ──────────────────────────────
// Same dedup logic lives in api/admin/extract-brand-aliases.js and
// scripts/extract_brand_aliases.js. The function isn't exported because
// it's only 5 lines and duplicating it kept those files self-contained.
// We re-implement it here to test the rule itself rather than reach into
// the call sites (which would couple test setup to file paths).
console.log('\n=== Title-based dedup (DB wins on collision) ===');

function unionDedupedByTitle(dbRows, staticRows) {
  const dbTitles = new Set(dbRows.map(r => String(r.title || '').trim().toLowerCase()));
  const merged = dbRows.slice();
  for (const sr of staticRows) {
    const key = String(sr.title || '').trim().toLowerCase();
    if (!key || dbTitles.has(key)) continue;
    merged.push(sr);
  }
  return merged;
}

it('keeps DB row when title collides with static', () => {
  const db = [{ id: 'uuid-1', title: 'Couture Macabre', fashion: [{ id: '@db' }] }];
  const stat = [{ id: 'static:Couture Macabre', title: 'Couture Macabre', fashion: [{ id: '@static' }] }];
  const merged = unionDedupedByTitle(db, stat);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].id, 'uuid-1');
});

it('case-insensitive title match: "MUGLER" vs "Mugler" → dedup', () => {
  const db = [{ id: 'uuid-2', title: 'MUGLER' }];
  const stat = [{ id: 'static:Mugler', title: 'Mugler' }];
  assert.strictEqual(unionDedupedByTitle(db, stat).length, 1);
});

it('whitespace-trim: " Folie " vs "Folie" → dedup', () => {
  const db = [{ id: 'uuid-3', title: ' Folie ' }];
  const stat = [{ id: 'static:Folie', title: 'Folie' }];
  assert.strictEqual(unionDedupedByTitle(db, stat).length, 1);
});

it('appends static-only entries that have no DB equivalent', () => {
  const db = [{ id: 'uuid-4', title: 'A' }];
  const stat = [
    { id: 'static:A', title: 'A' },        // dedup
    { id: 'static:B', title: 'B' },        // keep
    { id: 'static:3021', title: '3021' },  // keep (numeric legacy id)
  ];
  const merged = unionDedupedByTitle(db, stat);
  assert.strictEqual(merged.length, 3);
  const titles = merged.map(r => r.title).sort();
  assert.deepStrictEqual(titles, ['3021', 'A', 'B']);
});

it('drops static rows with empty/missing title (would be lossy as merge keys)', () => {
  const db = [];
  const stat = [
    { id: 'static:1', title: '' },
    { id: 'static:2' },
    { id: 'static:3', title: 'Real' },
  ];
  const merged = unionDedupedByTitle(db, stat);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].title, 'Real');
});

// ── isStopAlias / stop-word filter ──────────────────────────────────────
console.log('\n=== isStopAlias ===');

it('"brand" placeholder is filtered (live extraction surfaced 1563×)', () => {
  assert.strictEqual(isStopAlias('brand'), true);
});
it('"wearing" / "outfit" / "fashion" generic nouns are filtered', () => {
  ['wearing', 'outfit', 'fashion', 'beauty'].forEach(t =>
    assert.strictEqual(isStopAlias(t), true, t));
});
it('Korean role placeholders (브랜드, 옷) are filtered', () => {
  ['브랜드', '옷'].forEach(t => assert.strictEqual(isStopAlias(t), true, t));
});
it('real brand alias "balenciaga" is NOT filtered', () => {
  assert.strictEqual(isStopAlias('balenciaga'), false);
});

it('extractor drops a token whose normalized form is a stop alias', () => {
  const ed = {
    fashion: [{ n: 'Brand', id: '@brand' }, { n: 'Balenciaga', id: '@balenciaga' }],
  };
  const { brandTokens } = extractFromEditorial(ed);
  const aliases = brandTokens.map(t => t.normalized);
  assert.deepStrictEqual(aliases, ['balenciaga'], 'only the real brand should survive');
});

it('aggregate excludes stop aliases from frequent_aliases entirely', () => {
  // 5 editorials × @brand each → would be frequent_count = 1 with no filter
  const eds = Array.from({ length: 5 }, (_, i) => ({
    id: 'e' + i,
    fashion: [{ n: 'Brand', id: '@brand' }],
  }));
  const out = aggregate(eds, { frequentThreshold: 3 });
  const names = out.frequent_aliases.map(a => a.alias);
  assert.ok(!names.includes('brand'), 'brand must be filtered from frequent list');
  assert.strictEqual(out.summary.unique_aliases, 0, 'no aliases survive when only stop words present');
});

// ── Per-token role tracking (added for category inference + link table) ─
console.log('\n=== role tracking on brandTokens ===');

it('extractor tags fashion[] tokens with role="fashion-field"', () => {
  const ed = { fashion: [{ n: 'Balenciaga', id: '@balenciaga' }] };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].role, 'fashion-field');
  assert.strictEqual(brandTokens[0].source, 'fashion');
});

it('extractor tags display-format credits with the literal role string', () => {
  const ed = {
    credits: [{ r: 'Beauty by', h: [{ n: 'Charlotte Tilbury', id: '@charlottetilbury' }] }],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].role, 'Beauty by');
  assert.strictEqual(brandTokens[0].source, 'credits');
});

it('extractor preserves the matched role from admin-format (roles array)', () => {
  const ed = {
    credits: [{ roles: ['Photography', 'Fashion by'], name: 'Zara', instagram: '@zara' }],
  };
  const { brandTokens } = extractFromEditorial(ed);
  assert.strictEqual(brandTokens.length, 1);
  assert.strictEqual(brandTokens[0].role, 'Fashion by');
});

it('aggregate exposes role distribution per alias', () => {
  const eds = [
    { fashion: [{ n: 'Mugler', id: '@mugler' }] },                                      // role=fashion-field
    { credits: [{ r: 'Fashion by', h: [{ n: 'Mugler', id: '@mugler' }] }] },            // role=Fashion by
    { credits: [{ r: 'Fashion by', h: [{ n: 'Mugler', id: '@mugler' }] }] },            // role=Fashion by (count=2)
  ];
  const out = aggregate(eds, { frequentThreshold: 1 });
  const mugler = out.frequent_aliases.find(a => a.alias === 'mugler');
  assert.ok(mugler, 'mugler should be in frequent aliases');
  assert.deepStrictEqual(mugler.roles, { 'fashion-field': 1, 'Fashion by': 2 });
});

it('aggregate emits editorial_brand_links when collectLinks=true', () => {
  const eds = [
    { title: 'Folie',  fashion: [{ n: 'Zara', id: '@zara' }] },
    { title: 'Equipoise', credits: [{ r: 'Fashion by', h: [{ n: 'Prada', id: '@prada' }] }] },
  ];
  const out = aggregate(eds, { frequentThreshold: 1, collectLinks: true });
  assert.ok(Array.isArray(out.editorial_brand_links));
  assert.strictEqual(out.editorial_brand_links.length, 2);
  const folie = out.editorial_brand_links.find(l => l.editorial_title === 'Folie');
  assert.deepStrictEqual(folie, {
    editorial_title: 'Folie', alias: 'zara', role: 'fashion-field', source: 'fashion',
  });
});

it('aggregate suppresses link collection when collectLinks=false', () => {
  const eds = [{ title: 'X', fashion: [{ n: 'Zara', id: '@zara' }] }];
  const out = aggregate(eds, { frequentThreshold: 1, collectLinks: false });
  assert.strictEqual(out.editorial_brand_links, null);
});

// ── inferCategory (3-layer classifier) ──────────────────────────────────
console.log('\n=== inferCategory ===');

it('Layer 1: "Beauty by" role wins → beauty (even for ambiguous brand name)', () => {
  assert.strictEqual(inferCategory('newbrand', { 'Beauty by': 5 }), 'beauty');
});
it('Layer 1: "Cosmetics by" role → beauty', () => {
  assert.strictEqual(inferCategory('something', { 'Cosmetics by': 2 }), 'beauty');
});
it('Layer 2: hardcoded brand wins over keyword (tiffany → jewelry)', () => {
  assert.strictEqual(inferCategory('tiffany', { 'Fashion by': 5 }), 'jewelry');
});
it('Layer 2: hardcoded footwear (jimmychoo → footwear despite Fashion by role)', () => {
  assert.strictEqual(inferCategory('jimmychoo', { 'Fashion by': 5 }), 'footwear');
});
it('Layer 3: keyword "_cosmetics" → beauty', () => {
  assert.strictEqual(inferCategory('caia_cosmetics', null), 'beauty');
});
it('Layer 3: keyword "jewelry" anywhere → jewelry', () => {
  assert.strictEqual(inferCategory('annabel_jewelry', null), 'jewelry');
});
it('Layer 3: keyword "sneakers" → footwear', () => {
  assert.strictEqual(inferCategory('cheap_sneakers', null), 'footwear');
});
it('Default: bare brand name with Fashion-by role → fashion', () => {
  assert.strictEqual(inferCategory('balenciaga', { 'Fashion by': 100 }), 'fashion');
});
it('Default: no signals → fashion', () => {
  assert.strictEqual(inferCategory('unknownbrand', null), 'fashion');
});
it('Most-common role wins when multiple roles seen', () => {
  // Beauty:1 vs Fashion:5 → fashion category (most common is non-beauty role)
  assert.strictEqual(inferCategory('weirdbrand', { 'Beauty by': 1, 'Fashion by': 5 }), 'fashion');
});

// ── Done ────────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) {
  console.error('\n✗ affiliate-phase0-extract tests FAILED');
  process.exit(1);
}
console.log('✓ affiliate-phase0-extract tests passed');
