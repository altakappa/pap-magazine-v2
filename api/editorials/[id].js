/**
 * PAP Magazine - Editorial Detail API
 * GET    /api/editorials/:id   → 에디토리얼 상세 조회 (공개)
 * PUT    /api/editorials/:id   → 에디토리얼 수정 (관리자)
 * DELETE /api/editorials/:id   → 에디토리얼 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { embedAndStoreEditorial } = require('../_lib/embeddings');

// Re-embed only when fields that drive the embedding text actually change.
// Saves an OpenAI call (and a DB write) on routine admin edits like fixing
// a typo in `gallery` or toggling status.
const EMBED_TRIGGERS = ['title', 'description', 'tags'];
function shouldReembed(updates) {
  for (const k of EMBED_TRIGGERS) {
    if (Object.prototype.hasOwnProperty.call(updates, k)) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      // QA #163 — reverse-fan in the films that point at this editorial
      // via films.related_editorial_id so the detail page can render a
      // "Related Films" section without a second round-trip. Limit to
      // published films and a sane projection (id/slug/title/thumbnail/
      // youtube_id/published_date) so the response stays small even when
      // a single editorial gets multiple linked films over time.
      const { data, error } = await supabaseAdmin
        .from('editorials')
        .select('*, related_films:films!related_editorial_id(id,slug,title,thumbnail_url,youtube_id,published_date,status)')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Editorial not found' });
      }

      // Filter out unpublished films before sending — service-role bypasses
      // RLS so we have to enforce visibility here. (Doing it post-fetch
      // keeps the join shape simple — Supabase doesn't yet support an
      // .eq() on the joined table directly when there's no explicit
      // relationship hint.)
      if (Array.isArray(data.related_films)) {
        data.related_films = data.related_films
          .filter(f => f && f.status === 'published')
          .sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')));
      }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Editorial GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch editorial' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      // Phase 4: scheduled_publish_at, seo_*, og_image, title_en, description_en
      // are part of the allowlist so the admin form can save them.
      const allowed = [
        'title', 'slug', 'cover_image', 'published_date', 'url', 'tags',
        'issue', 'thumbnail', 'gallery', 'credits', 'fashion', 'status', 'description',
        'scheduled_publish_at', 'seo_title', 'seo_description', 'og_image',
        'title_en', 'description_en',
        // QA #170 — editor-tunable Instagram caption (auto-seeded at
        // submission approval; admin can hand-edit before publishing).
        'instagram_caption',
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // Detect a draft→published transition so we can stamp published_date
      // and force an embed below. We need the prior status for that.
      let priorStatus = null;
      if (updates.status !== undefined) {
        const { data: prior } = await supabaseAdmin
          .from('editorials')
          .select('status, published_date')
          .eq('id', id)
          .single();
        priorStatus = prior ? prior.status : null;
        const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
        if (becomingPublished && updates.published_date === undefined && (!prior || !prior.published_date)) {
          updates.published_date = new Date().toISOString();
        }
      }

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Re-embed when the admin changed embedding-relevant text OR when the
      // editorial is going public for the first time (drafts staged from
      // submissions never got an initial embed — we skip that to avoid
      // indexing half-baked work).
      const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
      if (shouldReembed(updates) || becomingPublished) {
        try { await embedAndStoreEditorial(data); }
        catch (e) { console.warn('[editorial PUT] re-embed failed', e && e.message); }
      }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Editorial PUT error:', err);
      return res.status(500).json({ error: 'Failed to update editorial' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { error } = await supabaseAdmin
        .from('editorials')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ message: 'Editorial deleted' });
    } catch (err) {
      console.error('Editorial DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete editorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
