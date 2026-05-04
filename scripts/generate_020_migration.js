#!/usr/bin/env node
/**
 * PAP Magazine — Generate supabase_migrations/020_brand_aliases_full_corpus.sql
 *
 * Successor to 019: lowers the frequency threshold to 1 (so 1-2 occurrence
 * "rare" aliases get registered too — most are real indie/local brands) AND
 * applies category inference (Beauty by → beauty, swarovski → jewelry, etc.)
 * instead of defaulting everything to 'fashion'.
 *
 * Strictly additive: anything already in 018 (manual seed) or 019 (frequent
 * auto-extract) is left untouched. Re-running this generator after admin
 * has hand-edited brand metadata is safe — the migration uses ON CONFLICT
 * DO NOTHING so admin work survives.
 *
 * Inputs:
 *   - frontend/data/editorial-details.json   (production corpus snapshot)
 *   - supabase_migrations/018_seed_brands.sql       (skip list)
 *   - supabase_migrations/019_brand_aliases_extracted.sql  (skip list)
 *
 * Output:
 *   - supabase_migrations/020_brand_aliases_full_corpus.sql
 */

const fs = require('fs');
const path = require('path');
const { aggregate, inferCategory } = require('../api/_lib/brandExtract');

const ROOT = path.resolve(__dirname, '..');
const STATIC_JSON = path.join(ROOT, 'frontend', 'data', 'editorial-details.json');
const SEED_018    = path.join(ROOT, 'supabase_migrations', '018_seed_brands.sql');
const MIG_019     = path.join(ROOT, 'supabase_migrations', '019_brand_aliases_extracted.sql');
const OUT_PATH    = path.join(ROOT, 'supabase_migrations', '020_brand_aliases_full_corpus.sql');

// ── Parse existing brand_aliases from prior migrations ──────────────────
function parseAliasMap(sqlPath) {
  if (!fs.existsSync(sqlPath)) return { aliases: new Map(), brandIds: new Set() };
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Find the brand_aliases section (everything after the header line)
  const aliasIdx = sql.indexOf('INSERT INTO public.brand_aliases');
  const brandsHalf = aliasIdx > 0 ? sql.slice(0, aliasIdx) : sql;
  const aliasesHalf = aliasIdx > 0 ? sql.slice(aliasIdx) : '';

  // Brand canonical IDs from `INSERT INTO public.brands ... VALUES ('id', ...)`
  const brandIds = new Set();
  const brandRowRe = /^\s*\('([a-z0-9_]+)'\s*,/gm;
  let m;
  while ((m = brandRowRe.exec(brandsHalf)) !== null) brandIds.add(m[1]);

  // Aliases: rows like `('alias', 'brand_id', 'manual'|'auto'|'pending')`
  const aliases = new Map();
  const aliasRowRe = /^\s*\('([^']+)'\s*,\s*'([a-z0-9_]+)'\s*,\s*'(?:manual|auto|pending)'\s*\)/gm;
  while ((m = aliasRowRe.exec(aliasesHalf)) !== null) {
    aliases.set(m[1], m[2]);
  }
  return { aliases, brandIds };
}

const seed018 = parseAliasMap(SEED_018);
const mig019  = parseAliasMap(MIG_019);
const knownAliases = new Map([...seed018.aliases, ...mig019.aliases]);
const knownBrandIds = new Set([...seed018.brandIds, ...mig019.brandIds]);
console.log('Existing aliases (018+019): ' + knownAliases.size);
console.log('Existing canonical brand_ids: ' + knownBrandIds.size);

// ── Load corpus + run extractor (threshold=1) ───────────────────────────
const jr = JSON.parse(fs.readFileSync(STATIC_JSON, 'utf8'));
const editorials = Object.keys(jr).map(title => Object.assign({ title }, jr[title]));
console.log('Loaded ' + editorials.length + ' editorials from static snapshot');

const result = aggregate(editorials, { frequentThreshold: 1, collectLinks: false });
const allAliases = result.frequent_aliases;   // threshold=1 → everything in this list
console.log('Unique aliases extracted: ' + allAliases.length);

// ── Resolve each alias to a brand_id with glued-suffix collapsing ───────
const GLUED_SUFFIXES = ['official', 'online'];
const freqByAlias = new Map(allAliases.map(a => [a.alias, a]));

const newBrands = new Map();
const newAliases = [];
let skippedKnown = 0;

function pickInstagramFromSample(sample) {
  if (!sample) return null;
  const s = String(sample).trim();
  return s.startsWith('@') ? s.slice(1) : s;
}

for (const entry of allAliases) {
  const alias = entry.alias;

  // Already registered by 018 or 019 → skip
  if (knownAliases.has(alias)) { skippedKnown++; continue; }

  // Glued-suffix collapse
  let brandId = alias;
  let collapsedFrom = null;
  for (const suf of GLUED_SUFFIXES) {
    if (alias.endsWith(suf) && alias.length > suf.length) {
      const bare = alias.slice(0, -suf.length);
      if (knownAliases.has(bare))   { brandId = knownAliases.get(bare); collapsedFrom = 'known-alias:'   + bare; break; }
      if (knownBrandIds.has(bare))  { brandId = bare;                   collapsedFrom = 'known-brand:'   + bare; break; }
      if (freqByAlias.has(bare))    { brandId = bare;                   collapsedFrom = 'extraction:'    + bare; break; }
      brandId = bare; collapsedFrom = 'orphan-bare:' + bare;
      break;
    }
  }

  // brandId resolves into an existing canonical brand → register only the alias
  if (knownBrandIds.has(brandId)) {
    newAliases.push({ alias, brand_id: brandId, occ: entry.occurrences_total, note: collapsedFrom || null });
    continue;
  }

  // New brand — infer category from role distribution + name
  const category = inferCategory(brandId, entry.roles);

  if (!newBrands.has(brandId)) {
    const sample0 = (entry.samples && entry.samples[0]) || '';
    newBrands.set(brandId, {
      brand_id: brandId,
      display_name: brandId.toUpperCase(),
      instagram_handle: pickInstagramFromSample(sample0),
      category: category,
      occ: entry.occurrences_total,
      contributing_aliases: new Set([alias]),
      role_breakdown: Object.assign({}, entry.roles),
    });
  } else {
    const existing = newBrands.get(brandId);
    existing.contributing_aliases.add(alias);
    existing.occ = Math.max(existing.occ, entry.occurrences_total);
    Object.keys(entry.roles).forEach(r => {
      existing.role_breakdown[r] = (existing.role_breakdown[r] || 0) + entry.roles[r];
    });
  }
  newAliases.push({ alias, brand_id: brandId, occ: entry.occurrences_total, note: collapsedFrom || null });
}

console.log('Skipped (already in 018+019): ' + skippedKnown);
console.log('New brands to create: ' + newBrands.size);
console.log('New aliases to register: ' + newAliases.length);

// Category distribution preview
const catCounts = {};
newBrands.forEach(b => { catCounts[b.category] = (catCounts[b.category] || 0) + 1; });
console.log('New-brand category distribution:', catCounts);

// ── Emit SQL ────────────────────────────────────────────────────────────
function sqlString(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const sortedBrands = Array.from(newBrands.values()).sort((a, b) => b.occ - a.occ);
const sortedAliases = newAliases.slice().sort((a, b) => b.occ - a.occ);

const lines = [];
lines.push('/**');
lines.push(' * PAP Magazine — Full-corpus brand-alias backfill (rare + categorised)');
lines.push(' * Step 20 in supabase_migrations/README.md execution order.');
lines.push(' *');
lines.push(' * Generated by scripts/generate_020_migration.js on ' + new Date().toISOString().slice(0,10) + '.');
lines.push(' *');
lines.push(' * Diff vs 019:');
lines.push(' *   • frequency threshold lowered 3 → 1 (every brand mentioned in any');
lines.push(' *     editorial gets a row, not just ≥3 occurrences). Adds the long tail');
lines.push(' *     of indie/local brands.');
lines.push(' *   • category auto-inferred from credit role / name keyword / hardcoded');
lines.push(' *     map instead of defaulting all to "fashion". Roughly:');
Object.keys(catCounts).sort().forEach(c => {
  lines.push(' *       ' + c.padEnd(10) + ': ' + catCounts[c]);
});
lines.push(' *');
lines.push(' * Strictly additive — every alias already in 018 or 019 is skipped (' + skippedKnown + ').');
lines.push(' * ON CONFLICT DO NOTHING so admin curation work on existing rows survives.');
lines.push(' */');
lines.push('');

// Brands
lines.push('-- ── New brands (categories auto-inferred; status=pending) ────────────');
lines.push('-- Admin curation: refine category if extractor guessed wrong, set tier,');
lines.push('-- then fill affiliate_url_* and flip status=\'active\' to enable /go/[id].');
lines.push('INSERT INTO public.brands (brand_id, display_name, category, status, instagram_handle, note) VALUES');

const brandRows = sortedBrands.map(b => {
  const note = 'auto-extracted ' + b.occ + 'x; aliases: ' + Array.from(b.contributing_aliases).join(', ');
  return '  (' + sqlString(b.brand_id) + ', ' + sqlString(b.display_name) + ', ' + sqlString(b.category) + ', \'pending\', ' + sqlString(b.instagram_handle) + ', ' + sqlString(note) + ')';
});
lines.push(brandRows.join(',\n'));
lines.push('ON CONFLICT (brand_id) DO NOTHING;');
lines.push('');

// Aliases
lines.push('-- ── New aliases (confidence=auto) ─────────────────────────────────────');
lines.push('INSERT INTO public.brand_aliases (alias, brand_id, confidence) VALUES');
const aliasRows = sortedAliases.map(a => {
  return '  (' + sqlString(a.alias) + ', ' + sqlString(a.brand_id) + ', \'auto\')';
});
lines.push(aliasRows.join(',\n'));
lines.push('ON CONFLICT (alias) DO NOTHING;');
lines.push('');

fs.writeFileSync(OUT_PATH, lines.join('\n'));
console.log('\nWrote ' + OUT_PATH);
console.log('  ' + lines.length + ' SQL lines');

console.log('\n=== TOP 15 new brands ===');
sortedBrands.slice(0, 15).forEach((b, i) => {
  console.log('  ' + String(i+1).padStart(2) + '. ' + b.brand_id.padEnd(28) + ' [' + b.category + ']  occ=' + b.occ);
});
console.log('\n=== Sample non-fashion category inferences ===');
sortedBrands.filter(b => b.category !== 'fashion').slice(0, 25).forEach(b => {
  console.log('  ' + b.brand_id.padEnd(28) + ' → ' + b.category);
});
