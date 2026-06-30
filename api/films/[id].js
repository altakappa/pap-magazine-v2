/**
 * PAP Magazine - Film Detail API
 * GET    /api/films/:id   → 필름 상세 조회 (공개)
 * PUT    /api/films/:id   → 필름 수정 (관리자)
 * DELETE /api/films/:id   → 필름 삭제 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, diffFields, attachAuthorship } = require('../_lib/audit');

// QA #202 — fields tracked in the audit diff for films.
const FILM_AUDIT_FIELDS = [
  'title','slug','status','youtube_id','thumbnail_url','published_date',
  'scheduled_publish_at','categories','tags','related_editorial_id'
];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const { id } = req.query;

  // GET: 단건 조회
  if (req.method === 'GET') {
    try {
      // Embed the linked editorial inline (QA #162) so the detail view
      // can render "Related Editorial: <title>" without a second fetch.
      const { data, error } = await supabaseAdmin
        .from('films')
        .select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date)')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Film not found' });
      }

      // QA #164 — schedule gate. A row whose scheduled_publish_at is
      // still in the future shouldn't be reachable via the public
      // detail endpoint either. Returning 404 mirrors the editorials
      // behaviour and avoids leaking the future-go-live moment.
      if (data.status === 'published'
          && data.scheduled_publish_at
          && new Date(data.scheduled_publish_at).getTime() > Date.now()) {
        return res.status(404).json({ error: 'Film not found' });
      }

      // QA #202 — denormalised authorship for the admin detail view.
      await attachAuthorship([data]);

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Film GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch film' });
    }
  }

  // PUT: 수정
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const updates = {};
      const allowed = [
        'title', 'youtube_id', 'thumbnail_url', 'published_date',
        'categories', 'tags', 'credits', 'slug', 'status',
        'related_editorial_id',
        // QA #164 — admins can transition a film between published / draft
        // / scheduled by sending the new value plus optional timestamp.
        'scheduled_publish_at',
        // QA #250 — Instagram caption. Plain TEXT; empty string normalised
        // to null below so DB stays clean.
        'instagram_caption',
        // QA #251 — KR/EN/IT description slots. Same trim+null treatment
        // as instagram_caption below.
        'description', 'description_en', 'description_it',
      ];
      // Coerce TEXT[] columns to arrays so admin payloads from older
      // form versions (string-shape) don't break the schema.
      const toArrayCols = new Set(['categories', 'tags']);
      for (const key of allowed) {
        if (req.body[key] === undefined) continue;
        let v = req.body[key];
        if (toArrayCols.has(key)) {
          v = Array.isArray(v) ? v : (v == null || v === '' ? [] : [String(v)]);
        }
        // QA #250 / #251 — TEXT slots: trim + treat empty as null so
        // the column doesn't get written as "" (which would defeat any
        // future IS NULL gate for "needs caption?" / "needs IT?" admin
        // filters).
        if (
          key === 'instagram_caption' ||
          key === 'description' ||
          key === 'description_en' ||
          key === 'description_it'
        ) {
          const trimmed = String(v || '').trim();
          v = trimmed ? trimmed : null;
        }
        updates[key] = v;
      }

      // QA #301 — credits 정규화 (instagram @ 자동 보강 + 잘못 매핑 정정).
      try {
        const { normalizeCreditsArray } = require('../_lib/credits');
        if (Array.isArray(updates.credits)) {
          updates.credits = normalizeCreditsArray(updates.credits);
        }
      } catch (_) {}

      // QA #202 — pull prior row for both transition detection and the
      // audit diff.
      let priorRow = null;
      let priorStatus = null;
      {
        const { data: prior } = await supabaseAdmin
          .from('films').select('*').eq('id', id).single();
        priorRow = prior || null;
        priorStatus = prior ? prior.status : null;
      }

      // QA #202 — stamp the editor.
      updates.updated_by = user.id;

      const { data, error } = await supabaseAdmin
        .from('films')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger entry with diff.
      try {
        const diff = diffFields(priorRow, updates, FILM_AUDIT_FIELDS);
        let action = 'update';
        let summary;
        if (updates.status && priorStatus && updates.status !== priorStatus) {
          if (updates.status === 'published')         { action = 'publish';   summary = `공개 전환 (이전: ${priorStatus})`; }
          else if (priorStatus === 'published')       { action = 'unpublish'; summary = `${updates.status} 으로 비공개 전환`; }
        }
        await recordContentChange({
          content_type: 'film',
          content_id: id,
          action,
          actor: user,
          summary,
          diff,
        });
      } catch(_){}

      return res.status(200).json({ data });
    } catch (err) {
      console.error('Film PUT error:', err);
      return res.status(500).json({ error: 'Failed to update film' });
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
          .from('films').select('title').eq('id', id).single();
        priorTitle = prior ? prior.title : null;
      } catch(_){}

      const { error } = await supabaseAdmin
        .from('films')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await recordContentChange({
        content_type: 'film',
        content_id: id,
        action: 'delete',
        actor: user,
        summary: priorTitle ? `삭제: ${priorTitle}` : '필름 삭제',
      });

      return res.status(200).json({ message: 'Film deleted' });
    } catch (err) {
      console.error('Film DELETE error:', err);
      return res.status(500).json({ error: 'Failed to delete film' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
