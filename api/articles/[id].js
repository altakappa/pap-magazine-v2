/**
 * PAP Magazine - Article Detail API
 * GET    /api/articles/:id   → 아티클 상세 조회 (공개)
 * PUT    /api/articles/:id   → 아티클 수정 (관리자)
 * DELETE /api/articles/:id   → 아티클 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('articles')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Article not found' });
      }

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Article GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch article' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      // QA #199 — added scheduled_publish_at to the allowlist so the
      // admin form can save a "publish at this future moment" stamp.
      const allowed = [
        'title', 'subtitle', 'slug', 'published_date', 'category', 'tags',
        'thumbnail_url', 'hero_image_url', 'content', 'gallery', 'credits',
        'custom_url', 'status', 'scheduled_publish_at'
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // Detect draft→published transition so we can stamp published_date
      // when the row goes live for the first time (mirrors editorial).
      let priorStatus = null;
      let priorPublishedAt = null;
      if (updates.status !== undefined) {
        const { data: prior } = await supabaseAdmin
          .from('articles')
          .select('status, published_date')
          .eq('id', id)
          .single();
        priorStatus = prior ? prior.status : null;
        priorPublishedAt = prior ? prior.published_date : null;
        const becomingPublished = updates.status === 'published' && priorStatus !== 'published';
        if (becomingPublished && updates.published_date === undefined && !priorPublishedAt) {
          updates.published_date = new Date().toISOString();
        }
      }

      // QA #199 — stamp admin_edited_at on every admin PUT so the
      // Drafts tab can tell "actually curated by an admin" from any
      // future auto-staged rows (matching QA #197 for editorials).
      updates.admin_edited_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('articles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Article PUT error:', err);
      return res.status(500).json({ error: 'Failed to update article' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const { error } = await supabaseAdmin
        .from('articles')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ message: 'Article deleted' });
    } catch (err) {
      console.error('Article DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete article' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
