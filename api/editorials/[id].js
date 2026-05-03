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
      const { data, error } = await supabaseAdmin
        .from('editorials')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Editorial not found' });
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
        'title_en', 'description_en'
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Re-embed when the admin changed something that affects the
      // embedding text. Best-effort, AFTER successful save.
      if (shouldReembed(updates)) {
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
