/**
 * PAP Magazine - Editorials API
 * GET  /api/editorials      → 에디토리얼 목록 조회 (공개)
 * POST /api/editorials      → 에디토리얼 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 에디토리얼 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, page = 1, limit: rawLimit = 25 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 25), 100);
      const offset = (parseInt(page) - 1) * limit;
      const requestedStatus = status || 'published';

      let query = supabaseAdmin
        .from('editorials')
        .select('*', { count: 'exact' })
        .eq('status', requestedStatus)
        .order('published_date', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      // For the public-facing 'published' view, hide editorials whose
      // scheduled_publish_at is still in the future. Admin tools that
      // pass status='draft' or status='scheduled' bypass this gate.
      // The OR clause keeps backward-compat with rows that don't have
      // scheduled_publish_at set.
      if (requestedStatus === 'published') {
        query = query.or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${new Date().toISOString()}`);
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
      console.error('Editorials GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch editorials' });
    }
  }

  // POST: 에디토리얼 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const {
        title, slug, cover_image, published_date, url, tags, issue,
        thumbnail, gallery, credits, fashion, status, description,
        scheduled_publish_at, seo_title, seo_description, og_image,
        title_en, description_en
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .insert({
          title,
          slug: slug || null,
          cover_image: cover_image || null,
          published_date: published_date || null,
          url: url || null,
          tags: tags || [],
          issue: issue || null,
          thumbnail: thumbnail || null,
          gallery: gallery || [],
          credits: credits || {},
          fashion: fashion || {},
          status: status || 'published',
          description: description || null,
          // Phase 4 fields — null when not provided keeps the column clean
          scheduled_publish_at: scheduled_publish_at || null,
          seo_title: seo_title || null,
          seo_description: seo_description || null,
          og_image: og_image || null,
          title_en: title_en || null,
          description_en: description_en || null,
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Editorials POST error:', err);
      return res.status(500).json({ error: 'Failed to create editorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
