/**
 * POST /api/admin/extract-brand-aliases
 *
 * Admin-gated convenience wrapper around the brand-alias extractor that
 * scripts/extract_brand_aliases.js exposes as a CLI. Same core logic
 * (api/_lib/brandExtract.js); calling this endpoint avoids needing a
 * local service-role key.
 *
 * Returns the full aggregator output as JSON. With ~2k editorials the
 * payload is ~200KB which is fine for a one-off admin call. The browser
 * console + JSON.stringify(... , null, 2) is the easiest way to read the
 * result; admin can then paste it into scripts/output/*.json locally so
 * the migration generator has the same input either way.
 *
 * Query params:
 *   ?threshold=N  — frequent-vs-rare cutoff (default 3)
 *   ?compact=1    — drop rare_aliases from response (smaller payload)
 *
 * Cost: one paginated SELECT against editorials, no OpenAI / external
 * services. Runs well inside the 60s Vercel function timeout for the
 * current corpus size.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { aggregate } = require('../_lib/brandExtract');

const PAGE_SIZE = 500;

async function fetchAllPublishedEditorials() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('editorials')
      .select('id, credits, fashion')
      .eq('status', 'published')
      .range(from, to);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const threshold = parseInt(req.query.threshold, 10);
  const frequentThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 3;
  const compact = req.query.compact === '1' || req.query.compact === 'true';

  try {
    const eds = await fetchAllPublishedEditorials();
    const result = aggregate(eds, { frequentThreshold: frequentThreshold });

    if (compact) {
      // For browser-console review of just the high-signal output, drop
      // the long rare list. role_stats + unknown_roles stay because they
      // help admin decide whether the extractor missed any role label.
      const { rare_aliases, ...rest } = result;
      return res.status(200).json(rest);
    }

    res.status(200).json(result);
  } catch (e) {
    console.error('[extract-brand-aliases] failed', e && e.message);
    res.status(500).json({ message: 'Extraction failed', detail: e && e.message });
  }
};
