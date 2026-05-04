/**
 * POST /api/admin/extract-brand-aliases
 *
 * Admin-gated wrapper around the brand-alias extractor. Scans both:
 *
 *   1. Production DB — every published editorial in `editorials` table.
 *      Currently 26 rows (admin-uploaded since the table launched).
 *   2. Static JSON snapshot — frontend/data/editorial-details.json,
 *      served at /data/editorial-details.json. ~2,369 historical
 *      editorials that pre-date the DB; still part of the live site
 *      catalogue (the home loads this file alongside the DB sync).
 *
 * Title-based dedup: when an admin re-uploaded a historical piece into
 * the DB, the same editorial appears in both sources. We drop the static
 * copy in that case (DB version wins — it's the editable canonical).
 *
 * Query params:
 *   ?source=db|static|all  — default `all`. `db`-only matches Phase 0.5
 *                            initial behaviour; `all` is what the corpus
 *                            actually needs to bootstrap brand_aliases.
 *   ?threshold=N           — frequent-vs-rare cutoff (default 3)
 *   ?compact=1             — drop rare_aliases from response (smaller payload)
 *
 * Static JSON is fetched over HTTPS from the deployment's own /data/
 * route (Vercel serves frontend/ statically). 4.6MB download at the
 * current corpus size — comfortably inside the 60s function timeout.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { aggregate } = require('../_lib/brandExtract');

const PAGE_SIZE = 500;
const STATIC_JSON_URL = 'https://www.pap-magazine.com/data/editorial-details.json';

async function fetchAllPublishedFromDb() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, credits, fashion')
      .eq('status', 'published')
      .range(from, to);
    if (error) throw new Error('DB read: ' + error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Pull the static editorial-details JSON from the live deployment and
 * shape each entry like a DB row. Object keys are the editorial titles
 * (e.g. "Couture Macabre") or legacy numeric ids (e.g. "3021"); we use
 * them as both id (for editorial-count uniqueness) and title (for the
 * cross-source dedup).
 */
async function fetchStaticEditorials() {
  const r = await fetch(STATIC_JSON_URL);
  if (!r.ok) throw new Error('Static JSON HTTP ' + r.status);
  const obj = await r.json();
  if (!obj || typeof obj !== 'object') return [];

  const out = [];
  for (const key of Object.keys(obj)) {
    const v = obj[key] || {};
    out.push({
      id: 'static:' + key,        // prefix avoids any collision with DB UUIDs
      title: key,
      credits: v.credits || [],
      fashion: v.fashion || [],
    });
  }
  return out;
}

/**
 * Return DB + static, deduped by lowercased trimmed title. DB wins
 * because it's the editable canonical (admin re-uploads supersede the
 * historical snapshot). Static-only entries appended after.
 */
function unionDedupedByTitle(dbRows, staticRows) {
  const dbTitles = new Set(
    dbRows.map(function (r) { return String(r.title || '').trim().toLowerCase(); })
  );
  const merged = dbRows.slice();
  for (const sr of staticRows) {
    const key = String(sr.title || '').trim().toLowerCase();
    if (!key || dbTitles.has(key)) continue;
    merged.push(sr);
  }
  return merged;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const source = (req.query.source || 'all').toString().toLowerCase();
  const threshold = parseInt(req.query.threshold, 10);
  const frequentThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 3;
  const compact = req.query.compact === '1' || req.query.compact === 'true';

  try {
    let editorials = [];
    let dbCount = 0;
    let staticCount = 0;

    if (source === 'db' || source === 'all') {
      const dbRows = await fetchAllPublishedFromDb();
      dbCount = dbRows.length;
      editorials = dbRows;
    }
    if (source === 'static' || source === 'all') {
      const staticRows = await fetchStaticEditorials();
      staticCount = staticRows.length;
      if (source === 'static') {
        editorials = staticRows;
      } else {
        editorials = unionDedupedByTitle(editorials, staticRows);
      }
    }

    const result = aggregate(editorials, { frequentThreshold: frequentThreshold });

    // Surface where the data came from so the admin can sanity-check the
    // source count without inspecting the DB / static URL separately.
    result.summary.source = source;
    result.summary.db_editorials = dbCount;
    result.summary.static_editorials = staticCount;
    result.summary.merged_editorials = editorials.length;

    if (compact) {
      const { rare_aliases, ...rest } = result;
      return res.status(200).json(rest);
    }
    res.status(200).json(result);
  } catch (e) {
    console.error('[extract-brand-aliases] failed', e && e.message);
    res.status(500).json({ message: 'Extraction failed', detail: e && e.message });
  }
};
