/**
 * PAP Magazine - Films API
 * GET  /api/films         → 필름 목록 조회 (공개)
 * POST /api/films         → 필름 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, attachAuthorship } = require('../_lib/audit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 필름 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, category, page = 1, limit: rawLimit = 50 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 100);
      const offset = (parseInt(page) - 1) * limit;

      // QA #162 + #164 — joins editorials!related_editorial_id and hides
      // future-scheduled rows from the public ("published") view, mirroring
      // the editorials GET behaviour so admin tools (status=draft/scheduled)
      // bypass the schedule gate while consumers never see queued rows.
      const requestedStatus = status || 'published';
      // QA #186 — explicit list-view projection (drops `credits` JSONB +
      // `description` so the homepage card list isn't shipping payloads
      // it doesn't render).
      const LIST_COLUMNS = [
        'id','title','slug','youtube_id','thumbnail_url','published_date',
        'categories','tags','status','scheduled_publish_at',
        // QA #202 — authorship columns for admin list rendering.
        'created_at','created_by','updated_by'
      ].join(',');
      let query = supabaseAdmin
        .from('films')
        .select(LIST_COLUMNS + ', related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date)', { count: 'exact' })
        .eq('status', requestedStatus)
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);
      // Schedule gate (QA #164).
      if (requestedStatus === 'published') {
        query = query.or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${new Date().toISOString()}`);
      }

      if (category) {
        query = query.ilike('categories', `%${category}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      // QA #202 — denormalise authorship for admin list views.
      if (Array.isArray(data)) await attachAuthorship(data);

      // QA #186 — edge cache the published list.
      if (requestedStatus === 'published') {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      } else {
        res.setHeader('Cache-Control', 'private, no-store');
      }

      return res.status(200).json({
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / parseInt(limit))
        }
      });
    } catch (err) {
      console.error('Films GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch films' });
    }
  }

  // POST: 필름 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const {
        title, youtube_id, thumbnail_url, published_date,
        categories, tags, credits, slug, status,
        related_editorial_id,
        scheduled_publish_at,
      } = req.body;

      if (!title || !youtube_id) {
        return res.status(400).json({ error: 'title and youtube_id are required' });
      }

      // categories / tags expected as TEXT[] (films schema). Coerce string-shape
      // bodies (legacy admin payloads) into arrays so the column accepts them.
      const toArray = v =>
        Array.isArray(v) ? v
        : (v == null || v === '' ? [] : [String(v)]);

      const insertRow = {
        title,
        youtube_id,
        thumbnail_url: thumbnail_url || null,
        published_date: published_date || null,
        categories: toArray(categories).length ? toArray(categories) : ['Film'],
        tags:       toArray(tags).length       ? toArray(tags)       : [title],
        credits: Array.isArray(credits) ? credits : [],
        status: status || 'published',
        // QA #164 — explicit null when unset so the column is clean rather
        // than absent (matters for the GET schedule gate to short-circuit
        // on IS NULL instead of evaluating a missing column).
        scheduled_publish_at: scheduled_publish_at || null,
        // QA #202 — authorship.
        created_by: user.id,
        updated_by: user.id,
      };
      if (slug)                  insertRow.slug = slug;
      if (related_editorial_id)  insertRow.related_editorial_id = related_editorial_id;

      const { data, error } = await supabaseAdmin
        .from('films')
        .insert(insertRow)
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger.
      await recordContentChange({
        content_type: 'film',
        content_id: data.id,
        action: 'create',
        actor: user,
        summary: `필름 등록: ${data.title}`,
      });

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Films POST error:', err);
      return res.status(500).json({ error: 'Failed to create film' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
