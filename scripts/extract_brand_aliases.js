#!/usr/bin/env node
/**
 * PAP Magazine — Brand alias auto-extraction CLI (Phase 0.5).
 *
 * Reads every published editorial from production Supabase, runs the
 * core extractor (api/_lib/brandExtract.js), and writes:
 *
 *   scripts/output/frequent_aliases.json   — occurrences ≥ FREQUENT_THRESHOLD
 *   scripts/output/rare_aliases.json       — occurrences < FREQUENT_THRESHOLD
 *   scripts/output/role_stats.json         — every role label seen + counts
 *
 * Usage:
 *   SUPABASE_URL=https://...  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *     node scripts/extract_brand_aliases.js
 *
 * Optional env:
 *   FREQUENT_THRESHOLD   — default 3, lower for sparser corpora
 *   PAGE_SIZE            — default 500 (Supabase REST default cap is 1000)
 *
 * Exit codes:
 *   0 — success, files written
 *   1 — env vars missing or DB error
 *
 * Alternative: hit POST /api/admin/extract-brand-aliases (admin-gated)
 * if you don't want to handle the service-role key locally. Same logic,
 * returns JSON inline.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { aggregate } = require('../api/_lib/brandExtract');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const PAGE_SIZE   = parseInt(process.env.PAGE_SIZE, 10) || 500;
const FREQUENT_TH = parseInt(process.env.FREQUENT_THRESHOLD, 10) || 3;

const OUT_DIR = path.join(__dirname, 'output');

function fail(msg) {
  console.error('[extract] ' + msg);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required.\n' +
       '  Find them in Vercel → Settings → Environment Variables.');
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAll() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const res = await supa
      .from('editorials')
      .select('id, credits, fashion')
      .eq('status', 'published')
      .range(from, to);
    if (res.error) fail('DB read failed: ' + res.error.message);
    const data = res.data || [];
    all.push(...data);
    process.stdout.write('  fetched ' + all.length + ' editorials\r');
    if (data.length < PAGE_SIZE) break;
  }
  process.stdout.write('\n');
  return all;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  console.log('  wrote ' + file);
}

(async function main() {
  console.log('[extract] fetching published editorials …');
  const editorials = await fetchAll();
  console.log('[extract] running aggregator …');
  const result = aggregate(editorials, { frequentThreshold: FREQUENT_TH });

  console.log('\n=== summary ===');
  console.log(JSON.stringify(result.summary, null, 2));
  console.log('\n=== top 30 frequent aliases ===');
  result.frequent_aliases.slice(0, 30).forEach(function (a, i) {
    console.log(
      '  ' + String(i + 1).padStart(3, ' ') + '. ' +
      a.alias.padEnd(30, ' ') +
      ' ' + String(a.occurrences_total).padStart(5, ' ') + 'x' +
      ' (' + a.editorials_count + ' eds)' +
      '   samples: ' + a.samples.slice(0, 2).join(' | ')
    );
  });
  console.log('\n=== unknown role labels (NOT in BRAND_ROLE_LABELS) ===');
  result.unknown_roles.slice(0, 30).forEach(function (r) {
    console.log('  ' + r);
  });

  ensureDir(OUT_DIR);
  writeJson(path.join(OUT_DIR, 'frequent_aliases.json'), {
    summary: result.summary,
    aliases: result.frequent_aliases,
  });
  writeJson(path.join(OUT_DIR, 'rare_aliases.json'), {
    summary: result.summary,
    aliases: result.rare_aliases,
  });
  writeJson(path.join(OUT_DIR, 'role_stats.json'), {
    role_stats: result.role_stats,
    unknown_roles: result.unknown_roles,
  });

  console.log('\n[extract] done. Review scripts/output/frequent_aliases.json before running migration 019.');
})().catch(function (e) {
  fail('uncaught: ' + (e && e.message));
});
