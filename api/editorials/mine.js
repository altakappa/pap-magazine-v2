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
const { findYearlyPremiumSubscription } = require('../_lib/premiumFeeWaiver');
const { MAX_CREDIT_EDITS, PAYMENT_EDITABLE, maxCreditEditsFor } = require('../_lib/creditEdit');

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
    const maxEdits = maxCreditEditsFor(profile || {});   // 2026-10-03 스탠다드 1 · 프리미엄 3
    // 2026-10-02 게재 인증서는 연간 프리미엄만. 판정은 서버(premiumFeeWaiver)가 한다.
    let canCertificate = false;
    // 2026-10-03 사다리: 스탠다드·프리미엄도 기본형 인증서. 연간은 검증 코드형(certificate.js 가 가른다).
    try { canCertificate = maxEdits > 0 || !!(await findYearlyPremiumSubscription(supabaseAdmin, user.id)); } catch (_) { canCertificate = maxEdits > 0; }
    const subList = subs || [];
    if (!subList.length) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ editorials: [], isPremium, canCertificate, maxEdits });
    }

    const payById = {};
    subList.forEach((s) => { payById[s.id] = s.payment_status || 'none'; });

    const { data: rows, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, slug, cover_image, thumbnail, published_date, status, source_submission_id, credits, fashion, credits_edit_count, updated_at, pinterest_pin_id')
      .in('source_submission_id', subList.map((s) => s.id))
      .eq('status', 'published')
      .order('published_date', { ascending: false });
    if (error) throw error;

    // 2026-10-03 내 화보 통계 + 공유 킷 (스탠다드부터). 인스타 도달을 앞에, 웹 조회수는 뒤에(도메니코 "실망할 수도").
    const canStats = maxEdits > 0;
    const statsById = {};
    if (canStats && (rows || []).length) {
      const ids = rows.map((r) => r.id);
      try {
        const [{ data: ig }, { data: ev }] = await Promise.all([
          supabaseAdmin.from('ig_post_latest').select('editorial_id, permalink, reach, like_count, saved').in('editorial_id', ids),
          supabaseAdmin.from('editorial_views').select('editorial_id').in('editorial_id', ids).limit(50000),
        ]);
        for (const p of (ig || [])) {
          const cur = statsById[p.editorial_id] || { igReach: 0, igLikes: 0, igSaves: 0, igUrl: null, webViews: 0 };
          cur.igReach = Math.max(cur.igReach, Number(p.reach || 0));
          cur.igLikes = Math.max(cur.igLikes, Number(p.like_count || 0));
          cur.igSaves = Math.max(cur.igSaves, Number(p.saved || 0));
          if (!cur.igUrl && p.permalink) cur.igUrl = p.permalink;
          statsById[p.editorial_id] = cur;
        }
        for (const v of (ev || [])) {
          const cur = statsById[v.editorial_id] || { igReach: 0, igLikes: 0, igSaves: 0, igUrl: null, webViews: 0 };
          cur.webViews += 1; statsById[v.editorial_id] = cur;
        }
      } catch (e) { console.warn('[editorials/mine] stats failed:', e && e.message); }
    }
    const SITE = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

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
        editsLeft: Math.max(0, maxEdits - used),
        paymentStatus: pay,
        // 2026-10-03 통계·공유 킷 — 유료(스탠다드부터)만 값이 있다. 무료는 null(화면이 잠금 안내).
        stats: canStats ? (statsById[r.id] || { igReach: 0, igLikes: 0, igSaves: 0, igUrl: null, webViews: 0 }) : null,
        shareKit: canStats ? {
          web: SITE + '/editorial/' + encodeURIComponent(r.slug) + '?utm_source=creator_share&utm_medium=social',
          instagram: (statsById[r.id] && statsById[r.id].igUrl) || null,
          pinterest: r.pinterest_pin_id ? ('https://www.pinterest.com/pin/' + encodeURIComponent(r.pinterest_pin_id) + '/') : null,
        } : null,
        canEditCredits: maxEdits > 0 && paidOk && used < maxEdits,
        // 왜 못 고치는지 프론트가 그대로 보여줄 수 있게 사유를 준다
        blockedReason: maxEdits <= 0 ? 'not_premium'
          : (!paidOk ? 'payment_pending'
            : (used >= maxEdits ? 'limit_reached' : null)),
      };
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ editorials, isPremium, canCertificate, maxEdits });
  } catch (e) {
    console.error('[editorials/mine]', (e && e.message) || e);
    return res.status(500).json({ message: 'Failed to load editorials' });
  }
};
