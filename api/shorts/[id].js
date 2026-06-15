/**
 * PAP Magazine - Short Detail API
 * GET    /api/shorts/:id   → 쇼츠 상세 조회 (공개)
 * PUT    /api/shorts/:id   → 쇼츠 수정 (관리자)
 * DELETE /api/shorts/:id   → 쇼츠 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, diffFields, attachAuthorship } = require('../_lib/audit');

// QA #202 — fields tracked in the audit diff for shorts.
const SHORTS_AUDIT_FIELDS = ['title','youtube_id','thumbnail_url','published_date','tags','status'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('shorts')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Short not found' });
      }

      await attachAuthorship([data]);

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Short GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch short' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      const allowed = ['title', 'youtube_id', 'thumbnail_url', 'published_date', 'tags', 'status'];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // QA #202 — capture prior + stamp editor.
      let priorRow = null;
      let priorStatus = null;
      {
        const { data: prior } = await supabaseAdmin
          .from('shorts').select('*').eq('id', id).single();
        priorRow = prior || null;
        priorStatus = prior ? prior.status : null;
      }
      updates.updated_by = user.id;

      const { data, error } = await supabaseAdmin
        .from('shorts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      try {
        const diff = diffFields(priorRow, updates, SHORTS_AUDIT_FIELDS);
        let action = 'update';
        let summary;
        if (updates.status && priorStatus && updates.status !== priorStatus) {
          if (updates.status === 'published')         { action = 'publish';   summary = `공개 전환 (이전: ${priorStatus})`; }
          else if (priorStatus === 'published')       { action = 'unpublish'; summary = `${updates.status} 으로 비공개 전환`; }
        }
        await recordContentChange({
          content_type: 'shorts',
          content_id: id,
          action,
          actor: user,
          summary,
          diff,
        });
      } catch(_){}

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Short PUT error:', err);
      return res.status(500).json({ error: 'Failed to update short' });
    }
  }

  // DELETE: 삭제
  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      let priorTitle = null;
      try {
        const { data: prior } = await supabaseAdmin
          .from('shorts').select('title').eq('id', id).single();
        priorTitle = prior ? prior.title : null;
      } catch(_){}

      const { error } = await supabaseAdmin
        .from('shorts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await recordContentChange({
        content_type: 'shorts',
        content_id: id,
        action: 'delete',
        actor: user,
        summary: priorTitle ? `삭제: ${priorTitle}` : '쇼츠 삭제',
      });

      return res.status(200).json({ message: 'Short deleted' });
    } catch (err) {
      console.error('Short DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete short' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
