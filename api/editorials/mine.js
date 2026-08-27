/**
 * GET /api/editorials/mine — 내가 제출해서 게재된 에디토리얼 목록
 *
 * 2026-08-26 도메니코 지시: "마이페이지에 게시한 에디토리얼 리스트를 볼 수
 * 있게 만들어주고 거기에서 클릭 시 프리미엄 회원에 한해서 수정 가능."
 *
 * 소유 판정은 editorials.source_submission_id → submissions.user_id 하나로만
 * 한다. 인스타 임포트·legacy 행은 source_submission_id 가 없으므로 자연히
 * 제외된다(주인이 없는 글을 남이 고치게 두지 않는다).
 *
 * canEditCredits 는 **서버가 계산해서** 내려준다. 프론트가 스스로 등급을
 * 판단하게 두면 화면과 서버 판정이 갈린다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { hasActivePremium } = require('../_lib/subscriptionAccess');
const { MAX_CREDIT_EDITS, PAYMENT_EDITABLE } = require('../_lib/creditEdit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);   // 동기 함수 (mine.js 관례)
  if (!user) return;

  try {
    const [{ data: profile }, { data: subs }] = await Promise.all([
      supabaseAdmin.from('profiles')
        .select('subscription_plan, subscription_status').eq('id', user.id).single(),
      supabaseAdmin.from('submissions')
        .select('id, payment_status, created_at').eq('user_id', user.id),
    ]);

    const isPremium = hasActivePremium(profile || {});
    const subList = subs || [];
    if (!subList.length) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ editorials: [], isPremium, maxEdits: MAX_CREDIT_EDITS });
    }

    const payById = {};
    subList.forEach((s) => { payById[s.id] = s.payment_status || 'none'; });

    const { data: rows, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, slug, cover_image, thumbnail, published_date, status, source_submission_id, credits, fashion, credits_edit_count, updated_at')
      .in('source_submission_id', subList.map((s) => s.id))
      .eq('status', 'published')
      .order('published_date', { ascending: false });
    if (error) throw error;

    const editorials = (rows || []).map((r) => {
      const pay = payById[r.source_submission_id] || 'none';
      const used = Number(r.credits_edit_count || 0);
      // 화이트리스트 — 새 상태값이 생겨도 조용히 열리지 않는다.
      const paidOk = PAYMENT_EDITABLE.includes(pay);
      const fashion = r.fashion && typeof r.fashion === 'object' && !Array.isArray(r.fashion) ? r.fashion : {};
      return {
        id: r.id,
        title: r.title,
        // 수정 화면이 바로 채워지도록 현재 크레딧을 함께 내린다. 모달을 열 때
        // 다시 조회하면 목록과 화면이 다른 시점을 보게 된다.
        credits: Array.isArray(r.credits) ? r.credits : [],
        brands: Array.isArray(fashion.brands) ? fashion.brands : [],
        slug: r.slug,
        cover: r.cover_image || r.thumbnail || null,
        publishedDate: r.published_date,
        editsUsed: used,
        editsLeft: Math.max(0, MAX_CREDIT_EDITS - used),
        paymentStatus: pay,
        canEditCredits: isPremium && paidOk && used < MAX_CREDIT_EDITS,
        // 왜 못 고치는지 프론트가 그대로 보여줄 수 있게 사유를 준다
        blockedReason: !isPremium ? 'not_premium'
          : (!paidOk ? 'payment_pending'
            : (used >= MAX_CREDIT_EDITS ? 'limit_reached' : null)),
      };
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ editorials, isPremium, maxEdits: MAX_CREDIT_EDITS });
  } catch (e) {
    console.error('[editorials/mine]', (e && e.message) || e);
    return res.status(500).json({ message: 'Failed to load editorials' });
  }
};
