/**
 * GET /api/banners
 *
 * QA #295 — 메인 hero 배너 public read. 활성화된 모든 cover_groups 와
 * 그 안의 이미지 목록을 sort_order 대로 반환. frontend hero
 * (pap-shell-bootstrap.js) 가 호출.
 *
 * 응답:
 *   {
 *     "data": [
 *       {
 *         "id": "uuid", "issue": "JULY ISSUE", "title": "Masquerade",
 *         "link_url": "/editorial/masquerade", "sort_order": 0,
 *         "images": [
 *           { "id": "uuid", "image_url": "...", "sort_order": 0 },
 *           ...
 *         ]
 *       }
 *     ]
 *   }
 *
 * Edge cache: s-maxage=300 (5분) + SWR 1h. admin 저장 시 frontend 에서
 * fetch 시 cache-buster 파라미터를 붙여 즉시 갱신.
 *
 * 2026-08-13 — 응답 마지막에 '이달의 에디토리얼' 합성 그룹이 붙을 수 있다.
 *   id 가 'eom-' 으로 시작하고 cover_groups 에 실재하지 않는다. 아래 참조.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors }    = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  try {
    // 그룹 + 이미지 nested. PostgREST 의 embed 문법으로 단일 round-trip.
    // QA #296 — image_url_mobile (모바일 viewport 우선).
    // QA #298 — scheduled_publish_at 게이트.
    // QA #299 — ended_at 게이트. ended IS NULL 이거나 NOW() 이후일 때만 노출.
    const nowIso = new Date().toISOString();
    const { data: groups, error } = await supabaseAdmin
      .from('cover_groups')
      .select('id,issue,title,link_url,sort_order,images:cover_images(id,image_url,image_url_mobile,sort_order)')
      .eq('is_active', true)
      .or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${nowIso}`)
      .or(`ended_at.is.null,ended_at.gt.${nowIso}`)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[banners GET] supabase error', error);
      return res.status(500).json({ message: 'Failed to load banners' });
    }

    // 그룹 내부 이미지도 sort_order 정렬 (embed 는 서버측 정렬 없음).
    const out = (groups || []).map(function (g) {
      const imgs = Array.isArray(g.images) ? g.images.slice() : [];
      imgs.sort(function (a, b) {
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
      return Object.assign({}, g, { images: imgs });
    });

    /* 2026-08-13 — '이달의 에디토리얼' 을 마지막 슬라이드로 덧붙인다.
     *
     * submission.html 이 크리에이터에게 약속한 것을 코드로 지키는 자리다:
     *   "매월 최우수 에디토리얼 1편을 선정해 한 달간 홈페이지 메인에 노출"
     *
     * 어드민이 커버 그룹을 따로 만들 필요가 없도록, 이미지·제목·링크를
     * 에디토리얼 레코드에서 직접 가져온다(단일 출처). 별표 한 번이면 끝이고
     * 달이 지나면 조회 조건에서 자연히 빠진다 — 지난 달 최우수작이 계속
     * 걸려 있는 것보다, 잊으면 조용히 사라지는 쪽이 낫다.
     *
     * 실패해도 커버 배너는 그대로 나가야 한다. 부수 기능이 주 기능을
     * 막으면 그게 더 큰 사고다(2026-08-12 가드와 같은 원칙). */
    try {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      const monthKey = monthStart.toISOString().slice(0, 10);
      const { data: eom, error: eomErr } = await supabaseAdmin
        .from('editorials')
        .select('id,title,slug,cover_image,featured_month')
        .eq('featured_month', monthKey)
        .eq('status', 'published')
        .limit(1)
        .maybeSingle();
      if (eomErr) {
        console.error('[banners GET] editorial-of-month 조회 실패(무시):', eomErr.message);
      } else if (eom && eom.cover_image) {
        out.push({
          // 실제 cover_groups 행이 아니므로 id 를 접두사로 구분한다.
          // 어드민 커버 화면이 이 id 로 저장을 시도하지 않게 하기 위함.
          id: 'eom-' + eom.id,
          issue: 'EDITORIAL OF THE MONTH',
          title: eom.title || '',
          link_url: eom.slug ? ('/editorial/' + eom.slug) : '',
          sort_order: 9999,
          images: [{ id: 'eom-img-' + eom.id, image_url: eom.cover_image, image_url_mobile: null, sort_order: 0 }],
        });
      }
    } catch (e) {
      console.error('[banners GET] editorial-of-month 예외(무시):', e && e.message);
    }

    // QA #294 cache 패턴과 동일 ─ 5분 edge + 1시간 SWR.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ data: out });
  } catch (err) {
    console.error('[banners GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load banners' });
  }
};
