/**
 * GET /api/magazine-issues
 *
 * QA #317 — Magazine 발행호 목록 public read.
 * magazine.html 이 호출해 발행호 카드를 동적 렌더링.
 *
 * QA(2026-07) 자동화:
 *   (1) 분기 볼륨(title 이 "VOL.N")의 editorial_count 를 해당 분기의 실제 published
 *       에디토리얼 수로 동적 계산 → 발행할수록 자동으로 늘어난다("차곡차곡").
 *   (2) 아직 완성되지 않은(진행 중인) 분기 볼륨은 공개하지 않는다. 분기가 끝나는
 *       마지막 날(예: Q3 → 9월 30일)부터 노출된다. 미래 볼륨도 동일하게 자동 처리.
 *   (3) is_latest 는 "공개된 것 중 최신"으로 재계산 → 진행 볼륨이 숨겨진 동안에는
 *       가장 최근 '완성된' 볼륨이 최신으로 표기된다.
 *   ※ (1)(2)(3) 은 public 응답에만 적용된다. 관리자(api/admin/magazine-issues)는
 *      원본 데이터를 그대로 보므로 편집/미리보기에 영향 없다.
 *
 * 정렬: issue_year DESC, sort_order DESC (최신 발행이 먼저).
 * Edge cache: s-maxage=60 + SWR 300.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors }    = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const quarterOf = (m) => Math.ceil((Number(m) || 1) / 3);            // 1..4
const isQuarterlyVolume = (r) => /^\s*VOL\.?\s*\d+/i.test(String(r.title || ''));
// 분기의 마지막 날(=완성 시점). 그 날짜 이전이면 아직 미완성.
// new Date(y, q*3, 0) → q*3 월(1-index)의 "0일" = 그 분기 마지막 달의 말일.
const quarterEndDate = (y, m) => new Date(Number(y), quarterOf(m) * 3, 0);
// 월의 마지막 날(=월별 발행호 완성 시점). new Date(y, m, 0) → m월(1-index)의 0일 = 그 달 말일.
const monthEndDate = (y, m) => new Date(Number(y), Number(m), 0);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  try {
    const { data, error } = await supabaseAdmin
      .from('magazine_issues')
      .select('id,issue_number,title,issue_year,issue_month,month_label,cover_image,editorial_count,link_url,is_latest,sort_order')
      .eq('is_active', true)
      .order('issue_year', { ascending: false })
      .order('sort_order', { ascending: false });

    if (error) {
      console.error('[magazine-issues GET] supabase error', error);
      return res.status(500).json({ message: 'Failed to load magazine issues' });
    }

    const rows = data || [];
    const now = new Date();

    // (2) 진행 중(미완성) 분기 볼륨 숨김 — 분기 종료일이 아직 안 온 발행호 제외.
    //     날짜가 불명확한 행은 기존처럼 노출.
    let visible = rows.filter((r) => {
      if (!r.issue_year || !r.issue_month) return true;
      // 2026-07: 발행호가 월별로 전환됨. 월별은 '월말', 레거시 VOL.N은 '분기말' 기준.
      var endDate = isQuarterlyVolume(r)
        ? quarterEndDate(r.issue_year, r.issue_month)
        : monthEndDate(r.issue_year, r.issue_month);
      return now >= endDate;
    });

    // (1) editorial_count 를 실제 published 수로 동적 교체 — 월별/분기별 모두.
    //     비용 제한: 작년~올해 발행호만 재계산(과거는 저장값 유지). 엣지캐시 60s.
    const _curY = now.getFullYear();
    await Promise.all(visible.map(async (r) => {
      if (!r.issue_year || !r.issue_month) return;
      if (Number(r.issue_year) < _curY - 1) return;          // 오래된 호는 저장값 유지
      try {
        let start, end;
        if (isQuarterlyVolume(r)) {
          const q = quarterOf(r.issue_month);
          const sm = (q - 1) * 3 + 1;                          // 1,4,7,10
          start = `${r.issue_year}-${String(sm).padStart(2, '0')}-01`;
          end = new Date(Date.UTC(Number(r.issue_year), q * 3, 0)).toISOString().slice(0, 10);
        } else {
          const mm = String(r.issue_month).padStart(2, '0');
          start = `${r.issue_year}-${mm}-01`;
          end = new Date(Date.UTC(Number(r.issue_year), Number(r.issue_month), 0)).toISOString().slice(0, 10);
        }
        const { count, error: cErr } = await supabaseAdmin
          .from('editorials')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'published')
          .gte('published_date', start)
          .lte('published_date', end);
        if (!cErr && typeof count === 'number') r.editorial_count = count;
      } catch (_) { /* 실패 시 저장값 유지 */ }
    }));

    // (3) is_latest 재계산 — 공개된 것 중 최신(정렬 첫 행)만 latest.
    visible = visible.map((r, i) => Object.assign({}, r, { is_latest: i === 0 }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ data: visible });
  } catch (err) {
    console.error('[magazine-issues GET] uncaught', err);
    return res.status(500).json({ message: 'Failed to load magazine issues' });
  }
};
