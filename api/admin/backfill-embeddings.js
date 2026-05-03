/**
 * POST /api/admin/backfill-embeddings
 *
 * Admin-only one-shot. Generates OpenAI text-embedding-3-small vectors for:
 *   1) every theme defined in api/_lib/themes.js → upsert into theme_embeddings
 *   2) every published editorial that doesn't yet have an embedding → write
 *      back to editorials.embedding
 *
 * Idempotent — re-running:
 *   - re-embeds all 7 themes (overwrites theme_embeddings rows). Cheap and
 *     desirable when the curated theme `description` strings are tweaked.
 *   - skips editorials that already have a non-null embedding. To force
 *     re-embed of editorials, pass ?force=1 (admin can clear stale vectors
 *     after a model change).
 *
 * Cost: 7 themes + 26 editorials = 33 calls × ~$0.0001 = roughly $0.003 per
 * full backfill. Sits well under the Vercel function 60s timeout: even a
 * conservative 600ms/call × 33 = 20s.
 *
 * Returns a structured summary so the admin can paste it back to debug if
 * something looks off:
 *   {
 *     themes:     { processed, errors: [...] },
 *     editorials: { processed, skipped, errors: [...] }
 *   }
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { embed, toPgVectorString, embedAndStoreEditorial, editorialEmbeddingText } = require('../_lib/embeddings');
const { THEMES, themeEmbeddingText } = require('../_lib/themes');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return; // requireAdmin already wrote 401/403

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      message: 'OPENAI_API_KEY missing in env — set it in Vercel Project Settings → Environment Variables before running backfill.',
    });
  }

  const force = req.query.force === '1' || req.query.force === 'true';

  const summary = {
    themes:     { processed: 0, errors: [] },
    editorials: { processed: 0, skipped: 0, errors: [] },
  };

  // ── Themes ─────────────────────────────────────────────────────────────
  for (const theme of THEMES) {
    try {
      const vec = await embed(themeEmbeddingText(theme));
      if (!vec) {
        summary.themes.errors.push({ themeId: theme.id, reason: 'embed_returned_null' });
        continue;
      }
      const { error } = await supabaseAdmin
        .from('theme_embeddings')
        .upsert(
          { theme_id: theme.id, embedding: toPgVectorString(vec), updated_at: new Date().toISOString() },
          { onConflict: 'theme_id' }
        );
      if (error) {
        summary.themes.errors.push({ themeId: theme.id, reason: error.message });
        continue;
      }
      summary.themes.processed++;
    } catch (e) {
      summary.themes.errors.push({ themeId: theme.id, reason: (e && e.message) || 'unknown' });
    }
  }

  // ── Editorials ─────────────────────────────────────────────────────────
  // We pull *all* published rows; the embedAndStoreEditorial path handles
  // empty title/description gracefully (returns false). With ~26 rows the
  // single fetch is fine. If the corpus grows past a few hundred we'd want
  // to batch with a `.range()` paginator — defer until we cross that line.
  let q = supabaseAdmin
    .from('editorials')
    .select('id,title,description,tags,embedding')
    .eq('status', 'published');
  if (!force) q = q.is('embedding', null);

  const { data: rows, error: fetchErr } = await q;
  if (fetchErr) {
    return res.status(500).json({ message: 'editorials fetch failed', detail: fetchErr.message, summary });
  }

  for (const row of rows || []) {
    if (!force && row.embedding) {
      summary.editorials.skipped++;
      continue;
    }
    const ok = await embedAndStoreEditorial({
      id: row.id,
      title: row.title,
      description: row.description,
      tags: row.tags,
    });
    if (ok) {
      summary.editorials.processed++;
    } else {
      summary.editorials.errors.push({ id: row.id, title: row.title, reason: 'embed_or_write_failed' });
    }
  }

  res.status(200).json({ ok: true, summary });
};
