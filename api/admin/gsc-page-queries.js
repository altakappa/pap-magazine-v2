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


/* ── 검색결과 표기를 DB 에서 '다시 계산' 하지 않는다 (2026-08-19) ───────
 *
 * 처음에는 articles 에서 제목·설명을 읽었다. 조회 컬럼이
 * seo_description·description 이었는데, **articles 에는 그 두 컬럼이 없다**
 * (있는 건 subtitle·content·content_en). PostgREST 가 에러를 돌려주고
 * data 가 null 이 되어 shown_in_search 는 **언제나 null** 이었다.
 *
 * 어제 이걸 '슬러그 조회 실패' 라고 적었는데 그것도 틀렸다.
 * 실측: 발행 기사 2,395건 전부 slug 가 채워져 있고(slug_null = 0),
 * 노출 상위 25페이지 모두 slug 로 1건씩 정확히 잡힌다. 슬러그는 멀쩡했다.
 *
 * 근본 문제는 컬럼 이름이 아니다. **설명을 만드는 규칙이 seoRenderer 안에
 * 있는데 여기서 그걸 다시 짜려 했다는 것**이다. 실제 규칙은 언어마다 다르고
 * 폴백이 여러 단계다(subtitle → content_en 요약 → 번역 설명 → 번역 본문
 * 요약 → 제목 에코). 규칙이 두 벌이면 한쪽만 고쳐진다(GROWTH-LEDGER 교훈 2).
 *
 * 그래서 계산하지 않고 **그 페이지를 그냥 가져와서 읽는다.** 우리 SSR 이
 * 뱉는 <title> 과 meta description 이 곧 구글이 보는 것이다. 재계산본이
 * 아니라 실물이라, 렌더러가 바뀌어도 이 화면은 자동으로 맞다.
 *
 * 실패는 삼키지 않는다(G-4). 못 가져왔으면 이유를 낸다 — null 만 돌려주면
 * '설명이 없다' 와 '조회가 깨졌다' 가 구분되지 않는다. 어제가 그 상태였다.
 */
const APPEARANCE_TIMEOUT_MS = 6000;

function pickTag(html, re) {
  const m = re.exec(html || '');
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function fetchSearchAppearance(url, lang) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, APPEARANCE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        /* 사람 UA 로 가져온다. 봇 이름을 쓰면 우리 자신의 AI 크롤 계측
           (ai_crawl_daily)이나 조회수 필터를 오염시킨다. 꼬리표를 남겨
           로그에서 우리 자가점검임을 알아볼 수 있게 한다. */
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36 PAP-admin-selfcheck',
        accept: 'text/html',
      },
    });
    const html = await r.text();
    const title = decodeEntities(pickTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
    const desc = decodeEntities(
      pickTag(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
      || pickTag(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)
    );
    return {
      lang: lang || null,
      status: r.status,
      final_url: r.url || url,
      title: title,
      description: desc,
      source: 'live-page',
      note: r.ok ? null : 'HTTP ' + r.status + ' — 이 페이지가 지금 정상 응답하지 않는다',
    };
  } catch (e) {
    return {
      lang: lang || null,
      status: null,
      title: null,
      description: null,
      source: 'live-page',
      error: String((e && e.message) || e).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
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

    /* 지금 이 페이지가 검색결과에 무엇으로 보이는지 같이 낸다.
       DB 에서 다시 만들지 않고 실제 페이지를 가져와 읽는다 (위 주석). */
    const { lang } = parsePath(page);
    const shown = await fetchSearchAppearance(page, lang);

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
