/**
 * GET /api/admin/download-logs — 어드민 전용 다운로드 이력 조회.
 *
 * QA #284 Phase 3. download_logs 테이블에서 사용자/콘텐츠별 필터링하여
 * 어드민 페이지에 노출.
 *
 * Query:
 *   • email        : 부분 일치 (LIKE %email%)
 *   • user_id      : 정확 일치
 *   • content_type : cover / gallery / editorial-zip / article-thumb / all
 *   • content_id   : 정확 일치
 *   • from / to    : ISO 날짜 범위 (downloaded_at)
 *   • allowed      : 'allowed' (consented=true) / 'denied' (consented=false) / 'all'
 *   • limit        : 기본 50, 최대 200
 *   • offset       : 페이지네이션
 *
 * 응답:
 *   { logs: [...], total: number }
 *
 * 권한: requireAdmin (대표/서브 관리자 모두).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAdmin(req, res);
  if (!user) return;

  const q = req.query || {};
  let limit  = Math.min(parseInt(q.limit || '50', 10) || 50, 200);
  let offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);

  try {
    let query = supabaseAdmin
      .from('download_logs')
      .select('id,user_id,user_email,content_type,content_id,content_slug,image_url,file_name,ip_address,user_agent,consented,downloaded_at', { count: 'exact' })
      .order('downloaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (q.email)        query = query.ilike('user_email', '%' + String(q.email).slice(0, 100) + '%');
    if (q.user_id)      query = query.eq('user_id', String(q.user_id));
    if (q.content_type && q.content_type !== 'all') {
      query = query.eq('content_type', String(q.content_type));
    }
    if (q.content_id)   query = query.eq('content_id', String(q.content_id));
    if (q.from)         query = query.gte('downloaded_at', String(q.from));
    if (q.to)           query = query.lte('downloaded_at', String(q.to));
    if (q.allowed === 'allowed') query = query.eq('consented', true);
    if (q.allowed === 'denied')  query = query.eq('consented', false);

    const { data, count, error } = await query;
    if (error) {
      console.error('[admin/download-logs] error:', error.message || error);
      return res.status(500).json({ message: 'query failed', error: error.message });
    }

    return res.status(200).json({
      logs: data || [],
      total: count || 0,
      limit, offset,
    });
  } catch (err) {
    console.error('[admin/download-logs] error:', err && err.message || err);
    return res.status(500).json({ message: 'unexpected error' });
  }
};
