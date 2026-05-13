/**
 * PAP Magazine - Films API
 * GET  /api/films         → 필름 목록 조회 (공개)
 * POST /api/films         → 필름 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 필름 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, category, page = 1, limit: rawLimit = 50 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 100);
      const offset = (parseInt(page) - 1) * limit;

      // QA #162 — films previously selected only their own columns, so the
      // related_editorial_id was an opaque UUID the frontend couldn't
      // dereference without a second round-trip. Joining the editorial
      // row inline keeps the film detail overlay render single-fetch
      // and surfaces the linked editorial's slug/title/cover so the
      // "Related Editorial" section can be drawn without further work.
      // Inner-aliased so absent links resolve to null instead of bombing.
      let query = supabaseAdmin
        .from('films')
        .select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date)', { count: 'exact' })
        .eq('status', status || 'published')
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (category) {
        query = query.ilike('categories', `%${category}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

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
      };
      if (slug)                  insertRow.slug = slug;
      if (related_editorial_id)  insertRow.related_editorial_id = related_editorial_id;

      const { data, error } = await supabaseAdmin
        .from('films')
        .insert(insertRow)
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Films POST error:', err);
      return res.status(500).json({ error: 'Failed to create film' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
