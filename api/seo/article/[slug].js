/**
 * PAP Magazine — Server-Side Rendered Article Page (SEO)
 * Route: /article/:slug   (rewritten in vercel.json)
 *
 * Same shape as /editorial/:slug but for the `articles` table:
 *   - schema.org NewsArticle (Google rich-result eligible for news/articles)
 *   - falls back across slug → custom_url → title → UUID id
 *   - renders rich-text `content` field if present
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { renderSeoHtml, renderNotFoundHtml } = require('../../_lib/seoRenderer');
const { logSocialInclick } = require('../../_lib/socialInclick');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).end();
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(renderNotFoundHtml('article', ''));
  }

  const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
  // QA #222 — articles authored via the admin "뉴스" flow usually leave
  // slug + custom_url NULL, so the SPA renders the title-as-URL with
  // spaces replaced by hyphens (자크뮈스가-담아낸-...). The SSR must
  // mirror that transform on the way back in: when no exact match is
  // found, swap `-` → ` ` and try the title column with both equality
  // (fast path) and ilike (forgiving of trailing punctuation / extra
  // spaces). We also try the slug column with the same dash-space swap
  // so a partially-slugified record still resolves.
  const dehyphenated = decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    let data = null;

    /* 1) custom_url match (articles use custom_url for SEO slugs) */
    let r = await supabaseAdmin.from('articles').select('*')
      .eq('custom_url', slug).eq('status', 'published').limit(1).maybeSingle();
    data = r.data;

    /* 2) decoded custom_url */
    if (!data && decoded !== slug) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('custom_url', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2b) slug column (decoded + dehyphenated) — QA #222 */
    if (!data) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('slug', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('slug', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3) title match (exact) */
    if (!data) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3b) title match with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('title', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3c) title ilike (forgiving of trailing punctuation / whitespace) — QA #222 */
    if (!data && dehyphenated.length >= 3) {
      const safe = dehyphenated.replace(/[\\%_]/g, ch => '\\' + ch);
      r = await supabaseAdmin.from('articles').select('*')
        .ilike('title', safe).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 4) UUID id (legacy /article/<id>) */
    if (!data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
      r = await supabaseAdmin.from('articles').select('*')
        .eq('id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 5) redirect_from — 옛 슬러그 보존 301 (2026-07-26, lever ②).
       레거시 슬러그(categoryfashion…)를 깨끗한 슬러그로 바꾸면 옛 /article/<old>
       URL 이 404 → 순위 소실. 옛 슬러그를 articles.redirect_from(text[])에
       담아두면 여기서 해석되고, 아래 정규-슬러그 301 블록이 새 URL 로 넘긴다.
       컬럼 미생성 환경에서도 안전: 쿼리 에러면 r.data 가 없어 그대로 통과. */
    if (!data) {
      try {
        r = await supabaseAdmin.from('articles').select('*')
          .contains('redirect_from', [slug]).eq('status', 'published').limit(1).maybeSingle();
        if (r && r.data) data = r.data;
        if (!data && decoded !== slug) {
          r = await supabaseAdmin.from('articles').select('*')
            .contains('redirect_from', [decoded]).eq('status', 'published').limit(1).maybeSingle();
          if (r && r.data) data = r.data;
        }
      } catch (_) { /* redirect_from 컬럼 미생성 — 무시하고 404 로 진행 */ }
    }

    if (!data) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(renderNotFoundHtml('article', slug));
    }

    /* QA(2026-07) #7 — 정규 슬러그로 301 리다이렉트.
     *
     * 기사 URL 이 한글 인코딩(%EA%B2%90%EC%A1%B0…)과 영문 슬러그로 혼재해
     * 공유·SEO·가독성이 나빴다. 슬러그를 ASCII 로 정리하면 옛 한글 URL 은
     * custom_url 조회(위 1단계)로 계속 해석되는데, 그대로 200 을 주면 같은
     * 기사가 두 URL 로 색인되는 중복 콘텐츠가 된다.
     *
     * 그래서 요청 경로가 정규 슬러그(data.slug)와 다르면 301 로 정규 URL 에
     * 넘긴다 → 옛 공유 링크는 살아있고(끊기지 않음), 색인·공유는 새 ASCII URL
     * 하나로 수렴한다. data.slug 가 없거나 이미 정규면 리다이렉트하지 않는다
     * (루프 방지).
     */
    const canonicalSlug = (data.slug || '').trim();
    if (canonicalSlug && canonicalSlug !== decoded && canonicalSlug !== slug) {
      // 쿼리스트링(utm 등) 보존 — X 유입 계측이 301 을 거쳐도 살아남게 (2026-07-16)
      const qi = String(req.url || '').indexOf('?');
      const qs = qi >= 0 ? String(req.url).slice(qi).replace(/[\r\n]/g, '') : '';
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400');
      res.setHeader('Location', '/article/' + encodeURIComponent(canonicalSlug) + qs);
      return res.status(301).end();
    }

    // 소셜 유입 계측 (utm_source 있을 때만 기록, 실패는 삼킨다 — 2026-07-16)
    await logSocialInclick(req, 'article');

    /* 다국어 (2026-07-21): 에디토리얼은 2026-07-16 부터 it/fr/es/ja SSR 이
       있었는데 기사는 en 하나뿐이었다 — 밀라노 기반 매체가 이탈리아어 기사
       검색에 잡히지 않는 상태. 에디토리얼과 동일한 구조로 맞춘다.
       ko|en 은 DB 원본 필드, 그 외는 seo_translations(kind='article').
       번역이 없으면 /en/ 으로 302 — 빈 번역 페이지를 색인시키지 않는다. */
    const VALID_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];
    const lang = VALID_LANGS.includes(String(req.query.lang || '')) ? String(req.query.lang) : 'ko';

    let translation = null;
    let availableLangs = ['ko', 'en'];
    try {
      const { data: trs } = await supabaseAdmin
        .from('seo_translations')
        .select('lang, title, description, body')
        .eq('kind', 'article')
        .eq('content_id', data.id);
      for (const t of trs || []) {
        if (!availableLangs.includes(t.lang)) availableLangs.push(t.lang);
        if (t.lang === lang) translation = { title: t.title, description: t.description, body: t.body };
      }
    } catch (_) { /* 테이블 미생성 등 — ko/en 만으로 렌더 */ }

    if (lang !== 'ko' && lang !== 'en' && !translation) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800');
      res.setHeader('Location', '/en/article/' + encodeURIComponent(data.custom_url || data.slug || slug));
      return res.status(302).end();
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');

    /* 2026-07-23 (Ahrefs Tip #3: 내부 링크로 중요 페이지 강화) — 아티클 상세
       본문 내 "More Articles" 내부링크 블록. 이전/다음(발행일 체인) +
       같은 카테고리 발행일 인접(앞 2 + 뒤 2).

       2026-07-27 변경 (내부링크 그래프 개선):
       기존 related 는 "카테고리 최신 4건 고정"이라 최신 4개 기사만 대량
       인바운드를 받고 오래된 기사는 prev/next 2개뿐이었다 → 색인 우선순위가
       낮아 미색인의 원인(서치콘솔 크롤됨-미색인 다수 = 오래된 기사). related 를
       "발행일 인접(앞2+뒤2)"으로 바꿔 오래된 기사끼리도 상호 연결 →
       토픽 클러스터 밀도↑, 오래된 기사 인바운드 2→6. 렌더러 형식(4건)은 유지. */
    try {
      const pd = data.published_date || '1970-01-01';
      const ca = data.created_at || '1970-01-01T00:00:00Z';
      const sel = 'title, slug, id, published_date, thumbnail_url, hero_image_url, category';
      const catFilter = (q) => data.category ? q.eq('category', data.category) : q;
      const [prevR, nextR, relPrevR, relNextR] = await Promise.all([
        supabaseAdmin.from('articles').select(sel).eq('status','published')
          .or(`published_date.lt.${pd},and(published_date.eq.${pd},created_at.lt.${ca})`)
          .order('published_date',{ascending:false}).order('created_at',{ascending:false}).limit(1),
        supabaseAdmin.from('articles').select(sel).eq('status','published')
          .or(`published_date.gt.${pd},and(published_date.eq.${pd},created_at.gt.${ca})`)
          .order('published_date',{ascending:true}).order('created_at',{ascending:true}).limit(1),
        // 같은 카테고리, 발행일이 이 기사보다 앞선 최근 2건
        catFilter(supabaseAdmin.from('articles').select(sel).eq('status','published')
          .neq('id', data.id).lt('published_date', pd))
          .order('published_date',{ascending:false}).limit(2),
        // 같은 카테고리, 발행일이 이 기사보다 뒤인 가까운 2건
        catFilter(supabaseAdmin.from('articles').select(sel).eq('status','published')
          .neq('id', data.id).gt('published_date', pd))
          .order('published_date',{ascending:true}).limit(2),
      ]);
      const _norm = a => a && ({ title: a.title, slug: a.slug, id: a.id,
        thumbnail: a.thumbnail_url || a.hero_image_url || '' });
      // 인접(앞2+뒤2)을 합쳐 4건. 카테고리가 희소해 4건 미만이면 있는 만큼
      // (prev/next 체인이 최소 연결을 보장하므로 고아는 발생하지 않는다).
      let relAdj = [...(relPrevR.data || []), ...(relNextR.data || [])];
      if (relAdj.length < 4) {
        const fill = await catFilter(supabaseAdmin.from('articles').select(sel)
          .eq('status','published').neq('id', data.id))
          .order('published_date',{ascending:false}).limit(6);
        const seen = new Set(relAdj.map(a => a.id));
        for (const a of (fill.data || [])) { if (!seen.has(a.id)) { relAdj.push(a); seen.add(a.id); } }
      }
      data.more_articles = {
        prev: _norm(prevR.data && prevR.data[0]) || null,
        next: _norm(nextR.data && nextR.data[0]) || null,
        related: relAdj.filter(a => a && a.id !== data.id).slice(0,4).map(_norm),
      };
    } catch (_) { /* 내부링크 블록은 best-effort */ }

    return res.status(200).send(renderSeoHtml('article', data, { lang, translation, availableLangs }));

  } catch (err) {
    console.error('[seo/article] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('article', slug));
  }
};
