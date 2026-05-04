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
const { aggregate } = require('../api/_lib/brandExtract');

// Lazy-load supabase only when DB scan is requested — keeps SOURCE=static
// runs working without `npm install` in fresh checkouts.
let _createClient = null;
function loadSupabaseClient() {
  if (!_createClient) {
    try {
      _createClient = require('@supabase/supabase-js').createClient;
    } catch (e) {
      fail('SOURCE=' + SOURCE + ' needs @supabase/supabase-js. Either run `npm install`,\n' +
           '  or set SOURCE=static to scan the editorial-details.json snapshot only.');
    }
  }
  return _createClient;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const PAGE_SIZE   = parseInt(process.env.PAGE_SIZE, 10) || 500;
const FREQUENT_TH = parseInt(process.env.FREQUENT_THRESHOLD, 10) || 3;
const SOURCE      = (process.env.SOURCE || 'all').toLowerCase();   // db | static | all

const OUT_DIR = path.join(__dirname, 'output');
const STATIC_JSON_PATH = path.join(__dirname, '..', 'frontend', 'data', 'editorial-details.json');

function fail(msg) {
  console.error('[extract] ' + msg);
  process.exit(1);
}

// DB credentials only required when scanning the DB. Pure static-source
// runs need just the JSON file on disk.
if ((SOURCE === 'db' || SOURCE === 'all') && (!SUPABASE_URL || !SUPABASE_KEY)) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required (SOURCE=' + SOURCE + ').\n' +
       '  Find them in Vercel → Settings → Environment Variables, or use SOURCE=static for offline run.');
}

const supa = (SUPABASE_URL && SUPABASE_KEY)
  ? loadSupabaseClient()(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

async function fetchAllFromDb() {
  if (!supa) return [];
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const res = await supa
      .from('editorials')
      .select('id, title, credits, fashion')
      .eq('status', 'published')
      .range(from, to);
    if (res.error) fail('DB read failed: ' + res.error.message);
    const data = res.data || [];
    all.push(...data);
    process.stdout.write('  fetched ' + all.length + ' DB editorials\r');
    if (data.length < PAGE_SIZE) break;
  }
  process.stdout.write('\n');
  return all;
}

function readStaticEditorials() {
  if (!fs.existsSync(STATIC_JSON_PATH)) {
    fail('static JSON not found at ' + STATIC_JSON_PATH);
  }
  const raw = fs.readFileSync(STATIC_JSON_PATH, 'utf8');
  const obj = JSON.parse(raw);
  const out = [];
  for (const key of Object.keys(obj)) {
    const v = obj[key] || {};
    out.push({
      id: 'static:' + key,
      title: key,
      credits: v.credits || [],
      fashion: v.fashion || [],
    });
  }
  return out;
}

// DB wins on title collision: admin re-upload of a historical piece
// supersedes the static snapshot. Same dedup as the admin endpoint.
function unionDedupedByTitle(dbRows, staticRows) {
  const dbTitles = new Set(dbRows.map(function (r) { return String(r.title || '').trim().toLowerCase(); }));
  const merged = dbRows.slice();
  for (const sr of staticRows) {
    const key = String(sr.title || '').trim().toLowerCase();
    if (!key || dbTitles.has(key)) continue;
    merged.push(sr);
  }
  return merged;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  console.log('  wrote ' + file);
}

(async function main() {
  console.log('[extract] source=' + SOURCE + ' threshold=' + FREQUENT_TH);

  let editorials = [];
  let dbCount = 0, staticCount = 0;

  if (SOURCE === 'db' || SOURCE === 'all') {
    console.log('[extract] fetching DB published editorials …');
    const dbRows = await fetchAllFromDb();
    dbCount = dbRows.length;
    editorials = dbRows;
  }
  if (SOURCE === 'static' || SOURCE === 'all') {
    console.log('[extract] reading static editorial-details.json …');
    const staticRows = readStaticEditorials();
    staticCount = staticRows.length;
    editorials = SOURCE === 'static'
      ? staticRows
      : unionDedupedByTitle(editorials, staticRows);
  }
  console.log('  ' + dbCount + ' DB + ' + staticCount + ' static (deduped → ' + editorials.length + ')');

  console.log('[extract] running aggregator …');
  const result = aggregate(editorials, { frequentThreshold: FREQUENT_TH });
  result.summary.source = SOURCE;
  result.summary.db_editorials = dbCount;
  result.summary.static_editorials = staticCount;
  result.summary.merged_editorials = editorials.length;

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
