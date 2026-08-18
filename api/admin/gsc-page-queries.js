/**
 * 페이지 하나가 어떤 질의로 노출되는지 본다 (2026-08-18 신설)
 * Route: /api/admin/gsc-page-queries?page=/ja/article/...&days=28
 *
 * ■ 왜 따로 만들었나
 * gsc-sync 는 날짜x페이지 와 날짜x질의 를 따로 모은다. page x query 를
 * 곱하면 행이 폭발하기 때문이다(14,634 페이지 x 질의). 그 결정은 그대로 둔다.
 *
 * 그런데 진단할 때는 곱이 꼭 필요하다. 실제로 막혔다:
 *   /ja/article/han-so-hee-...  노출 7,293 · 순위 7.2 · CTR 0.36%
 * 같은 순위대 다른 기사는 2.4~3.0% 다. 순위가 멀쩡한데 CTR 만 6배 낮으면
 * **제목·설명이 검색자의 질의와 안 맞는다**는 뜻이고, 그걸 확인하려면
 * 그 페이지의 질의를 봐야 한다.
 *
 * 그래서 곱은 **한 페이지씩, 사람이 물을 때만** 가져온다. 저장하지 않는다.
 * 매일 쌓을 이유가 없는 데이터를 매일 쌓지 않는다.
 *
 * ■ 같이 보여주는 것
 * 지금 그 페이지의 제목과 설명을 함께 낸다. 질의 목록과 제목을 다른 화면에서
 * 보면 대조가 안 된다. 판단에 필요한 것을 한 화면에 둔다.
 */

const { requireAdmin } = require('../_lib/auth');
const { supabaseAdmin } = require('../_lib/supabase');
const { queryAll, daysAgo, SITE } = require('../_lib/searchConsole');

const ORIGIN = 'https://www.pap-magazine.com';
const END_LAG_DAYS = 2;

/* 경로만 줘도 되게 한다. 사람이 주소창에서 복사하는 건 보통 경로다. */
function toFullUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//.test(s)) return s;
  return ORIGIN + (s.startsWith('/') ? s : '/' + s);
}

/* /ja/article/<slug> · /article/<slug> 둘 다에서 슬러그와 언어를 뽑는다 */
function parsePath(url) {
  const m = /^https?:\/\/[^/]+\/(?:([a-z]{2})\/)?article\/([^/?#]+)/.exec(url || '');
  return m ? { lang: m[1] || 'ko', slug: m[2] } : { lang: null, slug: null };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const q = req.query || {};
  const page = toFullUrl(q.page);
  if (!page) {
    return res.status(400).json({ error: '?page=/ja/article/... 가 필요합니다.' });
  }
  const days = Math.max(1, Math.min(480, Number(q.days || 28)));
  const endDate = daysAgo(END_LAG_DAYS);
  const startDate = daysAgo(END_LAG_DAYS + days - 1);

  try {
    const rows = await queryAll({
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 5000,
      /* 이 페이지로 한정한다. 필터 없이 page x query 를 통째로 받으면
         행이 폭발하고, 그건 이 엔드포인트가 피하려는 바로 그것이다. */
      dimensionFilterGroups: [{
        filters: [{ dimension: 'page', operator: 'equals', expression: page }],
      }],
    });

    const list = (rows || []).map((r) => ({
      query: (r.keys || [])[0] || '',
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      ctr: Number(((Number(r.ctr || 0)) * 100).toFixed(2)),
      position: Number(Number(r.position || 0).toFixed(1)),
    })).sort((a, b) => b.impressions - a.impressions);

    const totImp = list.reduce((a, r) => a + r.impressions, 0);
    const totClk = list.reduce((a, r) => a + r.clicks, 0);

    /* 지금 이 페이지가 검색결과에 무엇으로 보이는지 같이 낸다 */
    const { lang, slug } = parsePath(page);
    let shown = null;
    if (slug) {
      const { data: art } = await supabaseAdmin.from('articles')
        .select('id, title, seo_description, description').eq('slug', slug).maybeSingle();
      if (art) {
        shown = { lang, title: art.title, description: art.seo_description || art.description || null };
        if (lang && lang !== 'ko') {
          const { data: tr } = await supabaseAdmin.from('seo_translations')
            .select('title, description').eq('kind', 'article').eq('lang', lang)
            .eq('content_id', art.id).maybeSingle();
          if (tr) shown = { lang, title: tr.title, description: tr.description };
        }
      }
    }

    return res.status(200).json({
      ok: true, site: SITE, page, startDate, endDate, days,
      totals: { impressions: totImp, clicks: totClk,
        ctr: totImp ? Number((100 * totClk / totImp).toFixed(2)) : 0 },
      shown_in_search: shown,
      queries: list.slice(0, Number(q.limit || 40)),
      query_count: list.length,
    });
  } catch (e) {
    console.error('[gsc-page-queries]', e);
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 400) });
  }
};
