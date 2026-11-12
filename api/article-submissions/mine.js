/**
 * GET /api/article-submissions/mine — 내 아티클 기고 목록 (회원)
 *
 * 마이페이지가 쓴다. 본문 전체는 내려주지 않는다 — 목록에 필요한 건 상태와
 * 분량이고, 통째로 실으면 긴 글 수십 편이 한 응답에 들어온다.
 *
 * 관리자 전용 칸(admin_notes · promo_ai)은 절대 내려가지 않는다. AI 홍보성
 * 분석은 **관리자용 의견**이고, 제출자에게 점수를 보여줄 이유가 없다
 * (보여주면 점수를 피하려 글을 비틀게 된다).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('article_submissions')
      .select('id, title, subtitle, category, topic, body_lang, word_count, cover_url, status, fee_type, payment_status, paid_amount, fee_notified_at, feedback, published_article_id, created_at, reviewed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // 발행된 기사로 가는 링크 — 에디토리얼 마이페이지와 같은 방식(hydrate).
    const artIds = (rows || []).map((r) => r.published_article_id).filter(Boolean);
    const byId = {};
    if (artIds.length) {
      const { data: arts } = await supabaseAdmin
        .from('articles').select('id, slug, custom_url, status, published_date').in('id', artIds);
      for (const a of (arts || [])) byId[a.id] = a;
    }

    const submissions = (rows || []).map((r) => Object.assign({}, r, {
      linked_article: r.published_article_id ? (byId[r.published_article_id] || null) : null,
    }));
    return res.status(200).json({ submissions });
  } catch (error) {
    console.error('[article-submissions/mine] error:', error);
    return res.status(500).json({ message: 'Failed to load your article submissions.', code: 'fetch_failed' });
  }
};
