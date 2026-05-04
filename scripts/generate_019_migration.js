#!/usr/bin/env node
/**
 * PAP Magazine — Generate supabase_migrations/019_brand_aliases_extracted.sql
 *
 * Reads scripts/output/frequent_aliases.json (produced by the Phase 0.5
 * extractor) plus supabase_migrations/018_seed_brands.sql (the manual
 * seed) and emits a SQL migration that:
 *
 *   1. INSERT new brands rows (status='pending', tier=NULL, category='fashion')
 *      for every frequent alias not already covered by 018.
 *   2. INSERT brand_aliases rows (confidence='auto') pointing each frequent
 *      alias at the matching brand.
 *
 * Glued-suffix collapsing (live data showed these patterns):
 *   chanelofficial + chanel both appear → use brand_id='chanel' for both
 *   muglerofficial → already aliased to mugler in seed, skip
 *   drmartensofficial alone (no bare) → brand_id='drmartens', alias=full
 *   rickowensonline → already aliased to rick_owens in seed, skip
 *
 * Idempotent: every INSERT uses ON CONFLICT DO NOTHING so re-running on
 * top of admin curation work is safe.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FREQ_PATH = path.join(ROOT, 'scripts', 'output', 'frequent_aliases.json');
const SEED_PATH = path.join(ROOT, 'supabase_migrations', '018_seed_brands.sql');
const OUT_PATH  = path.join(ROOT, 'supabase_migrations', '019_brand_aliases_extracted.sql');

// ── Load + parse seed 018 ───────────────────────────────────────────────
const seedSql = fs.readFileSync(SEED_PATH, 'utf8');

// Brand canonical IDs: parse rows in `INSERT INTO public.brands (...) VALUES ('id', 'NAME', ...)`
const seedBrandIds = new Set();
const brandRowRe = /^\s*\('([a-z0-9_]+)'\s*,/gm;
let m;
while ((m = brandRowRe.exec(seedSql)) !== null) {
  seedBrandIds.add(m[1]);
}
// Filter out rows that are actually in the brand_aliases section, not brands.
// The brands rows have 5 columns; aliases have 3. We match by *also* requiring
// the line context — but the regex is loose. Tighten by reading the file in
// two halves split on the brand_aliases header.
const aliasSplit = seedSql.indexOf('INSERT INTO public.brand_aliases');
const brandsHalf = aliasSplit > 0 ? seedSql.slice(0, aliasSplit) : seedSql;
const aliasesHalf = aliasSplit > 0 ? seedSql.slice(aliasSplit) : '';

seedBrandIds.clear();
brandRowRe.lastIndex = 0;
while ((m = brandRowRe.exec(brandsHalf)) !== null) seedBrandIds.add(m[1]);

// Aliases: rows like `('alias', 'brand_id', 'manual')`
const seedAliases = new Map(); // alias → brand_id
const aliasRowRe = /^\s*\('([^']+)'\s*,\s*'([a-z0-9_]+)'\s*,\s*'(?:manual|auto|pending)'\s*\)/gm;
while ((m = aliasRowRe.exec(aliasesHalf)) !== null) {
  seedAliases.set(m[1], m[2]);
}

console.log('Seed brands: ' + seedBrandIds.size);
console.log('Seed aliases: ' + seedAliases.size);

// ── Load extraction output ──────────────────────────────────────────────
const frequent = JSON.parse(fs.readFileSync(FREQ_PATH, 'utf8'));
console.log('Frequent aliases extracted: ' + frequent.length);

const freqByAlias = new Map();
frequent.forEach(f => freqByAlias.set(f.alias, f));

// ── Resolve each frequent alias to a brand_id ──────────────────────────
const GLUED_SUFFIXES = ['official', 'online'];

const newBrands = new Map();   // brand_id → { display_name, instagram_handle, category, sample, occ, alias_set }
const newAliases = [];          // [{alias, brand_id, occ, source_note}]
let skippedSeed = 0;

function pickInstagramFromSample(sample) {
  if (!sample) return null;
  const s = String(sample).trim();
  return s.startsWith('@') ? s.slice(1) : s;
}
function deriveDisplayName(alias) {
  // Match seed convention: ALL CAPS. Hard to reconstruct true display so
  // we just uppercase the brand_id; admin can edit.
  return alias.toUpperCase();
}

for (const entry of frequent) {
  const alias = entry.alias;
  const occ   = entry.occurrences_total;

  // Already covered by seed alias map? Skip — alias already routes to a brand.
  if (seedAliases.has(alias)) {
    skippedSeed++;
    continue;
  }

  // Derive target brand_id with glued-suffix collapsing.
  let brandId = alias;
  let collapsedFrom = null;

  for (const suf of GLUED_SUFFIXES) {
    if (alias.endsWith(suf) && alias.length > suf.length) {
      const bare = alias.slice(0, -suf.length);
      // Bare matches an existing seed alias → reuse that brand
      if (seedAliases.has(bare)) {
        brandId = seedAliases.get(bare);
        collapsedFrom = 'seed:' + bare;
        break;
      }
      // Bare matches an existing seed canonical brand_id → reuse it
      if (seedBrandIds.has(bare)) {
        brandId = bare;
        collapsedFrom = 'seed-brand:' + bare;
        break;
      }
      // Bare appears in this same extraction → collapse to bare brand_id
      if (freqByAlias.has(bare)) {
        brandId = bare;
        collapsedFrom = 'extraction:' + bare;
        break;
      }
      // Otherwise leave brandId = full alias (e.g., drmartensofficial)
      // but strip the glued suffix so the display is cleaner.
      brandId = bare;
      collapsedFrom = 'orphan-bare:' + bare;
      break;
    }
  }

  // If brandId resolved into an existing seed brand, register only the alias.
  if (seedBrandIds.has(brandId)) {
    newAliases.push({ alias, brand_id: brandId, occ, note: collapsedFrom || null });
    continue;
  }

  // New brand — create it (or update sample/occ if we already created it
  // earlier in the loop e.g. for the 'chanel' variant).
  if (!newBrands.has(brandId)) {
    const sample0 = (entry.samples && entry.samples[0]) || '';
    newBrands.set(brandId, {
      brand_id: brandId,
      display_name: deriveDisplayName(brandId),
      instagram_handle: pickInstagramFromSample(sample0),
      category: 'fashion',
      sample: sample0,
      occ,
      contributing_aliases: new Set(),
    });
  }
  // Track the contributing alias (used by the SQL comment header so admin
  // sees why a brand was created).
  newBrands.get(brandId).contributing_aliases.add(alias);
  newBrands.get(brandId).occ = Math.max(newBrands.get(brandId).occ, occ);

  newAliases.push({ alias, brand_id: brandId, occ, note: collapsedFrom || null });
}

console.log('Skipped (already in seed aliases): ' + skippedSeed);
console.log('New brands to create: ' + newBrands.size);
console.log('New aliases to register: ' + newAliases.length);

// ── Emit SQL ────────────────────────────────────────────────────────────
function sqlString(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const sortedBrands = Array.from(newBrands.values()).sort((a, b) => b.occ - a.occ);
const sortedAliases = newAliases.slice().sort((a, b) => b.occ - a.occ);

const lines = [];
lines.push('/**');
lines.push(' * PAP Magazine — Brand aliases auto-extracted from production corpus');
lines.push(' * Step 19 in supabase_migrations/README.md execution order.');
lines.push(' *');
lines.push(' * Generated by scripts/generate_019_migration.js from');
lines.push(' * scripts/output/frequent_aliases.json (run on ' + new Date().toISOString().slice(0,10) + ').');
lines.push(' *');
lines.push(' * Source corpus: 2374 published editorials (DB + frontend/data/editorial-details.json).');
lines.push(' * Frequent threshold: 3+ occurrences.');
lines.push(' * Stop-aliases ("brand", "wearing", …) filtered upstream — see brandExtract.js.');
lines.push(' *');
lines.push(' * After this migration:');
lines.push(' *   • ' + newBrands.size + ' new brands at status=\'pending\' (admin must set affiliate URLs to activate)');
lines.push(' *   • ' + newAliases.length + ' new aliases at confidence=\'auto\' (admin reviews via curation UI)');
lines.push(' *   • ' + skippedSeed + ' frequent aliases already covered by seed (no-op)');
lines.push(' *');
lines.push(' * All INSERTs use ON CONFLICT DO NOTHING — safe to re-run after admin');
lines.push(' * has edited (renamed, recategorised, or merged) any pending brand.');
lines.push(' */');
lines.push('');

// Brands
lines.push('-- ── New brands (status=pending, category=fashion default) ────────────');
lines.push('-- Admin curation step: set proper category, tier, affiliate_url_*, then');
lines.push('-- flip status to \'active\' to enable /api/go/[id] redirects.');
lines.push('INSERT INTO public.brands (brand_id, display_name, category, status, instagram_handle, note) VALUES');

const brandRows = sortedBrands.map(b => {
  const note = 'auto-extracted ' + b.occ + 'x; aliases: ' + Array.from(b.contributing_aliases).join(', ');
  return '  (' + sqlString(b.brand_id) + ', ' + sqlString(b.display_name) + ', \'fashion\', \'pending\', ' + sqlString(b.instagram_handle) + ', ' + sqlString(note) + ')';
});
lines.push(brandRows.join(',\n'));
lines.push('ON CONFLICT (brand_id) DO NOTHING;');
lines.push('');

// Aliases
lines.push('-- ── New aliases (confidence=auto) ─────────────────────────────────────');
lines.push('-- Each row routes a credit-line variant to a canonical brand_id. Admin');
lines.push('-- promotes confidence=\'auto\' → \'manual\' after visual review.');
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

// Quick post-write summary for the human reviewer
console.log('\n=== TOP 20 new brands by occurrences ===');
sortedBrands.slice(0, 20).forEach((b, i) => {
  console.log('  ' + String(i+1).padStart(2) + '. ' + b.brand_id.padEnd(28) + ' display=' + b.display_name.padEnd(28) + ' aliases=[' + Array.from(b.contributing_aliases).join(', ') + ']');
});
console.log('\n=== Sample aliases collapsed via glued-suffix logic ===');
sortedAliases.filter(a => a.note).slice(0, 15).forEach(a => {
  console.log('  ' + a.alias.padEnd(28) + ' → ' + a.brand_id.padEnd(20) + ' (' + a.note + ')');
});
