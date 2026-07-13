/**
 * PAP Magazine - Shorts API
 * GET  /api/shorts         → 쇼츠 목록 조회 (공개)
 * POST /api/shorts         → 쇼츠 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, attachAuthorship } = require('../_lib/audit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 쇼츠 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, page = 1, limit: rawLimit = 50 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 100);
      const offset = (parseInt(page) - 1) * limit;
      const requestedStatus = status || 'published';
      // QA #220 — edge cache for anonymous public list.
      {
        const { setListCacheHeader } = require('../_lib/cdnCache');
        setListCacheHeader(req, res, { isPublic: requestedStatus === 'published' });
      }

      // QA(2026-07) #11 — shorts 테이블에는 published_date 컬럼이 없다(schema:
      // sort_order, created_at). 존재하지 않는 컬럼으로 order 하면 Postgres 가
      // 에러를 던져 GET 이 통째로 500 이 됐다(홈/관리자 숏츠 조회 실패). 실제
      // 컬럼(sort_order 오름차순 → created_at 내림차순)으로 정렬한다.
      let query = supabaseAdmin
        .from('shorts')
        .select('*', { count: 'exact' })
        .eq('status', status || 'published')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      // QA #202 — denormalise authorship for admin list views.
      if (Array.isArray(data)) await attachAuthorship(data);

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
      console.error('Shorts GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch shorts' });
    }
  }

  // POST: 쇼츠 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      // QA(2026-07) #11 — published_date/tags 컬럼은 shorts 스키마에 없다.
      // 유효 컬럼(sort_order)만 insert 하도록 정리(기존엔 존재하지 않는 컬럼을
      // insert 해 create 도 500 이었다).
      const { title, youtube_id, thumbnail_url, sort_order, status } = req.body;

      if (!title || !youtube_id) {
        return res.status(400).json({ error: 'title and youtube_id are required' });
      }

      const { data, error } = await supabaseAdmin
        .from('shorts')
        .insert({
          title,
          youtube_id,
          thumbnail_url: thumbnail_url || null,
          sort_order: (sort_order != null ? sort_order : 0),
          status: status || 'published',
          // QA #202 — authorship.
          created_by: user.id,
          updated_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger entry.
      await recordContentChange({
        content_type: 'shorts',
        content_id: data.id,
        action: 'create',
        actor: user,
        summary: `쇼츠 등록: ${data.title}`,
      });

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Shorts POST error:', err);
      return res.status(500).json({ error: 'Failed to create short' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
