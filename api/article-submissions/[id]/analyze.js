/**
 * POST /api/article-submissions/:id/analyze — AI 홍보성 재분석 (관리자)
 *
 * 접수 때 한 번 돌지만(api/article-submissions/index.js), 회원을 기다리게 하는
 * 요청이라 예산이 12초로 짧다. 시간이 모자라 비어 있거나 파싱이 실패한 건을
 * 관리자가 심사 화면에서 다시 돌린다. 여기는 사람이 버튼을 누른 자리이므로
 * 넉넉한 예산을 준다.
 *
 * ★ 이 엔드포인트는 fee_type 을 건드리지 않는다. AI 는 요금을 매기지 않는다 —
 *   점수·근거·인용·브랜드 목록을 올려 주는 데까지다(도메니코 판정 대상).
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { analyzePromo } = require('../../_lib/articlePromoAi');

const ADMIN_AI_BUDGET_MS = 45000;   // api 전체 와일드카드의 maxDuration 120 안에서

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ message: 'Missing id', code: 'missing_id' });

  try {
    const { data: sub, error } = await supabaseAdmin
      .from('article_submissions')
      .select('id, title, subtitle, topic, body_lang, body, promo_self_declared')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!sub) return res.status(404).json({ message: 'Submission not found', code: 'not_found' });

    const ai = await analyzePromo(sub, { timeoutMs: ADMIN_AI_BUDGET_MS });
    const { error: updErr } = await supabaseAdmin
      .from('article_submissions')
      .update({ promo_ai: ai, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updErr) throw updErr;

    return res.status(200).json({ promo_ai: ai });
  } catch (error) {
    console.error('[article-submissions/analyze] error:', error);
    return res.status(500).json({ message: 'Analysis failed.', code: 'analyze_failed' });
  }
};
