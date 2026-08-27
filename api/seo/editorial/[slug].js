/**
 * PAP Magazine — Server-Side Rendered Editorial Page (SEO)
 * Route: /editorial/:slug   (rewritten in vercel.json)
 *
 * Returns full crawlable HTML with per-article meta tags, Open Graph,
 * Twitter Card, hreflang, schema.org Article + BreadcrumbList, and
 * the full editorial gallery (lazy-loaded).
 *
 * Lookup is 4-step: slug → decoded slug → title → UUID id.
 * (2026-08-04 대소문자 무시 슬러그 단계 추가 — 구 Wix URL 대응)
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { renderSeoHtml, renderNotFoundHtml } = require('../../_lib/seoRenderer');
const { PREVIEW_IMAGES } = require('../../_lib/editorialAccess');
const { logSocialInclick } = require('../../_lib/socialInclick');
// 2026-08-19 — AI 크롤러가 어떤 글을 읽어 갔는지 기록. 사람 유입(위)과 다른 신호다.
const { logAiCrawl } = require('../../_lib/aiCrawlLog');
const { parseBrandCredits } = require('../../_lib/fashionCredits');
const { overlayRelatedTitles } = require('../../_lib/relatedI18n');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).end();
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(renderNotFoundHtml('editorial', ''));
  }

  const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
  // QA #222 — SPA encodes titles with hyphens (자크뮈스가-담아낸-...).
  // Mirror that swap on the SSR side so URLs without a stored slug
  // still resolve to the right record.
  const dehyphenated = decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    let data = null;

    /* 1) slug match */
    let r = await supabaseAdmin.from('editorials').select('*')
      .eq('slug', slug).eq('status', 'published').limit(1).maybeSingle();
    data = r.data;

    /* 2) decoded slug (handles URL-encoded slugs that contain spaces) */
    if (!data && decoded !== slug) {
      r = await supabaseAdmin.from('editorials').select('*')
        .eq('slug', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2-b) 2026-08-08 — 슬러그에 공백이 낀 깨진 링크 관용 (GSC 실측:
       /editorial/donde -tdo-florece 가 404 — DB 슬러그는 donde-tdo-florece).
       공백을 걷어낸 형태가 정확히 존재하면 정규 URL 로 301. 콘텐츠를 그대로
       주지 않는 이유: 깨진 URL 이 200 을 받으면 그 주소로 계속 색인된다. */
    if (!data && /\s/.test(decoded)) {
      const despaced = decoded.replace(/\s+/g, '');
      const ds = await supabaseAdmin.from('editorials').select('slug')
        .eq('slug', despaced).eq('status', 'published').limit(1).maybeSingle();
      if (ds.data && ds.data.slug) {
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
        res.setHeader('Location', '/editorial/' + encodeURIComponent(ds.data.slug));
        return res.status(301).end();
      }
    }

    /* 2b) slug match with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('editorials').select('*')
        .eq('slug', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2c) 대소문자만 다른 슬러그 — 구 Wix URL 에는 대문자가 섞여 있다.
       (/ko/balloon-Tennis-from-9to5/ → DB 는 balloon-tennis-from-9to5)
       GSC '찾을 수 없음(404)' 표본에서 확인된 실제 패턴. 정확히 1건만
       매칭될 때 정본 소문자 주소로 301 (200 으로 그냥 렌더하면 대소문자
       변형 URL 이 중복 색인된다). 언어 접두어는 그대로 보존. 2026-08-04 */
    if (!data && !/%/.test(decoded)) {
      const safeSlugCi = decoded.replace(/[\\%_]/g, ch => '\\' + ch);
      const ci = await supabaseAdmin.from('editorials').select('slug')
        .ilike('slug', safeSlugCi).eq('status', 'published').limit(2);
      if (ci.data && ci.data.length === 1 && ci.data[0].slug && ci.data[0].slug !== decoded) {
        const ciLang = String((req.query && req.query.lang) || '');
        const ciPrefix = /^(en|it|fr|es|ja|de|zh|ru)$/.test(ciLang) ? '/' + ciLang : '';
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
        res.setHeader('Location', ciPrefix + '/editorial/' + encodeURIComponent(ci.data[0].slug));
        return res.status(301).end();
      }
    }

    /* 3) title (legacy URLs that used title in the path slot) */
    if (!data) {
      r = await supabaseAdmin.from('editorials').select('*')
        .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3b) title with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('editorials').select('*')
        .eq('title', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3c) title ilike — QA #222 (forgiving of trailing punctuation) */
    if (!data && dehyphenated.length >= 3) {
      const safe = dehyphenated.replace(/[\\%_]/g, ch => '\\' + ch);
      r = await supabaseAdmin.from('editorials').select('*')
        .ilike('title', safe).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 4) UUID id */
    if (!data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
      r = await supabaseAdmin.from('editorials').select('*')
        .eq('id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* Hide future-scheduled posts (filter in JS to keep SQL simple) */
    if (data && data.scheduled_publish_at) {
      const ms = Date.parse(data.scheduled_publish_at);
      if (!isNaN(ms) && ms > Date.now()) data = null;
    }

    /* 5) 레거시(구 Wix) 잘린 슬러그 — 'emergency' → 'emergency-landing'.
       접두 일치가 정확히 1건일 때만 301 (모호하면 404 유지). 2026-07-10 */
    if (!data && dehyphenated.length >= 3 && !/%/.test(decoded)) {
      const safePrefix = decoded.replace(/[\\%_]/g, ch => '\\' + ch);
      const pr = await supabaseAdmin.from('editorials').select('slug')
        .like('slug', safePrefix + '-%').eq('status', 'published').limit(2);
      if (pr.data && pr.data.length === 1 && pr.data[0].slug) {
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
        res.setHeader('Location', '/editorial/' + encodeURIComponent(pr.data[0].slug));
        return res.status(301).end();
      }
    }

    /* 6) 타 콘텐츠 타입 폴백 (2026-07-21).
       루트형 URL(/<slug>)은 이 핸들러로 rewrite 되는데, 에디토리얼에서 못 찾으면
       곧장 404 였다. 그런데 구 사이트의 루트 URL 에는 필름·기사도 섞여 있다 —
       서치콘솔 404 분석에서 m.pap-magazine.com/glacia-regina-film/ 이 실제로는
       films.glacia-regina-78 로 살아 있는 것을 확인했다.
       접두 일치가 정확히 1건일 때만 301 (모호하면 404 유지 — 위 5)와 같은 방침). */
    if (!data && decoded && !/%/.test(decoded)) {
      const esc = (s) => s.replace(/[\\%_]/g, ch => '\\' + ch);
      /* 구 URL 은 뒤에 타입 접미어가 붙어 있는 경우가 많다
         (glacia-regina-film → films.glacia-regina-78). 마지막 세그먼트를 떼고
         한 번 더 접두 일치를 시도한다. 남는 어간이 2세그먼트 이상일 때만 —
         한 단어까지 깎으면 엉뚱한 글로 보내기 쉽다. */
      const parts = decoded.split('-').filter(Boolean);
      const stem = parts.length >= 3 ? parts.slice(0, -1).join('-') : null;

      for (const [table, path] of [['films', '/film/'], ['articles', '/article/']]) {
        const exact = await supabaseAdmin.from(table).select('slug')
          .eq('slug', decoded).eq('status', 'published').limit(1).maybeSingle();
        if (exact.data && exact.data.slug) {
          res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
          res.setHeader('Location', path + encodeURIComponent(exact.data.slug));
          return res.status(301).end();
        }
        for (const base of [decoded, stem]) {
          if (!base) continue;
          const pr = await supabaseAdmin.from(table).select('slug')
            .like('slug', esc(base) + '-%').eq('status', 'published').limit(2);
          if (pr.data && pr.data.length === 1 && pr.data[0].slug) {
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
            res.setHeader('Location', path + encodeURIComponent(pr.data[0].slug));
            return res.status(301).end();
          }
        }
      }
      /* 에디토리얼도 같은 접미어 문제를 겪는다 (5)는 원형 접두만 본다). */
      if (stem) {
        const pr = await supabaseAdmin.from('editorials').select('slug')
          .like('slug', esc(stem) + '-%').eq('status', 'published').limit(2);
        if (pr.data && pr.data.length === 1 && pr.data[0].slug) {
          res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
          res.setHeader('Location', '/editorial/' + encodeURIComponent(pr.data[0].slug));
          return res.status(301).end();
        }
      }
    }

    if (!data) {
      /* 2026-08-08 — 내려간 화보는 404 가 아니라 410 Gone (기사와 동일 결정,
         GSC '찾을 수 없음' 839건 — draft 화보 213편이 큰 몫). 존재한 적
         없는 URL 은 그대로 404. */
      try {
        let g = await supabaseAdmin.from('editorials').select('id')
          .eq('slug', decoded).neq('status', 'published').limit(1).maybeSingle();
        let goneRow = g.data;
        if (!goneRow && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
          g = await supabaseAdmin.from('editorials').select('id')
            .eq('id', slug).neq('status', 'published').limit(1).maybeSingle();
          goneRow = g.data;
        }
        if (goneRow) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
          return res.status(410).send(renderNotFoundHtml('editorial', slug));
        }
      } catch (_) { /* 410 판별 실패 → 기존 404 로 진행 */ }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(renderNotFoundHtml('editorial', slug));
    }

    /* 루트 경로(/<slug>)로 들어온 요청은 표준 주소(/editorial/<slug>)로 301 —
       SPA가 만드는 루트형 URL·구 인덱스가 캐노니컬로 수렴한다. 2026-07-10 */
    if (req.query && req.query.root === '1') {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
      res.setHeader('Location', '/editorial/' + encodeURIComponent(data.slug || slug));
      return res.status(301).end();
    }

    /* 다국어 (2026-07-16, ja 추가 2026-07-21): ko|en 은 DB 원본 필드,
       it|fr|es|ja 는 seo_translations.
       번역이 아직 없으면 /en/ 으로 302 (빈 번역 페이지를 인덱싱시키지 않는다). */
    const VALID_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];
    const lang = VALID_LANGS.includes(String(req.query.lang || '')) ? String(req.query.lang) : 'ko';

    let translation = null;
    let availableLangs = ['ko', 'en'];
    try {
      const { data: trs } = await supabaseAdmin
        .from('seo_translations')
        .select('lang, title, description')
        .eq('kind', 'editorial')
        .eq('content_id', data.id);
      for (const t of trs || []) {
        if (!availableLangs.includes(t.lang)) availableLangs.push(t.lang);
        if (t.lang === lang) translation = { title: t.title, description: t.description };
      }
    } catch (_) { /* 테이블 미생성 등 — ko/en 만으로 렌더 */ }

    if (lang !== 'ko' && lang !== 'en' && !translation) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800');
      res.setHeader('Location', '/en/editorial/' + encodeURIComponent(data.slug || slug));
      return res.status(302).end();
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
    /* 2026-07-22 (Ahrefs 감사: 고아 페이지) — 본문 내 내부링크 블록용 데이터.
       · 이전/다음: 발행일 체인으로 '모든' 에디토리얼이 서로 연결되게 (고아 방지의 핵심)
       · 관련: 태그 겹침 상위 4건 (없으면 최신 4건) — 링크 에쿼티/체류 모두 기여
       실패해도 페이지는 정상 렌더 (try/catch·비어있으면 섹션 생략). */
    try {
      const pd = data.published_date || '1970-01-01';
      const ca = data.created_at || '1970-01-01T00:00:00Z';
      const sel = 'title, title_en, slug, id, published_date, thumbnail, cover_image, og_image';
      const [prevR, nextR, relR] = await Promise.all([
        supabaseAdmin.from('editorials').select(sel).eq('status','published')
          .or(`published_date.lt.${pd},and(published_date.eq.${pd},created_at.lt.${ca})`)
          .order('published_date',{ascending:false}).order('created_at',{ascending:false}).limit(1),
        supabaseAdmin.from('editorials').select(sel).eq('status','published')
          .or(`published_date.gt.${pd},and(published_date.eq.${pd},created_at.gt.${ca})`)
          .order('published_date',{ascending:true}).order('created_at',{ascending:true}).limit(1),
        (Array.isArray(data.tags) && data.tags.length
          ? supabaseAdmin.from('editorials').select(sel).eq('status','published')
              .neq('id', data.id).overlaps('tags', data.tags.slice(0,4))
              .order('published_date',{ascending:false}).limit(4)
          : supabaseAdmin.from('editorials').select(sel).eq('status','published')
              .neq('id', data.id).order('published_date',{ascending:false}).limit(4)),
      ]);
      data.more_editorials = {
        prev: (prevR.data && prevR.data[0]) || null,
        next: (nextR.data && nextR.data[0]) || null,
        related: (relR.data || []).filter(e => e && e.id !== data.id).slice(0,4),
      };
      /* 2026-08-04 (GSC '발견됨 - 현재 색인이 생성되지 않음' 4,474건) —
         내부링크 언어 프리픽스. 지금까지 /ja/editorial/x 안의 이전·다음·관련
         카드가 전부 /editorial/y (한국어)를 가리켰다. 그래서 en/ja/fr/it/es
         번역 페이지는 사이트맵에만 있는 고아였고, 구글이 '발견'만 하고 크롤
         우선순위를 계속 낮게 잡았다(표본 1,000건 중 914건이 번역 URL).
         실제 번역이 있는 항목에만 프리픽스를 붙인다 — 없는데 붙이면 302
         체인이 생겨 '리디렉션이 포함된 페이지'를 다시 키우기 때문.
         (en 은 DB 원본 필드라 항상 존재.) */
      if (lang !== 'ko') {
        const _mo = data.more_editorials;
        const _items = [_mo.prev, _mo.next, ...(_mo.related || [])].filter(Boolean);
        if (lang === 'en') {
          _items.forEach(e => { e._lang = 'en'; });
          /* 2026-08-25 — 카드 제목도 영어로. 언어판에 남는 한국어 제목은
             ko 정본과의 중복 신호(GSC 표준 태그 충돌 1,655건 진단). */
          overlayRelatedTitles(_items, 'en', null);
        } else if (_items.length) {
          const { data: _trRows } = await supabaseAdmin
            .from('seo_translations').select('content_id, title')
            .eq('kind', 'editorial').eq('lang', lang)
            .in('content_id', _items.map(e => e.id).filter(Boolean));
          const _have = new Set((_trRows || []).map(r => r.content_id));
          _items.forEach(e => { if (_have.has(e.id)) e._lang = lang; });
          /* 2026-08-25 — 같은 조회로 받아온 번역 제목을 카드에 입힌다.
             번역이 없으면 ko 원제 유지 (빈 제목 금지). */
          const _titleById = {};
          (_trRows || []).forEach(r => { if (r && r.title) _titleById[r.content_id] = r.title; });
          overlayRelatedTitles(_items, lang, _titleById);
        }
      }
    } catch (_) { /* 내부링크 블록은 best-effort */ }

    // 2026-07-28 — 브랜드 페이지 고아(orphan) 해소.
    // Ahrefs 크롤: 에러 1,365건 중 1,359건이 'Orphan page' 였고 전부 /brand/*.
    // 사이트맵에는 있는데 사이트 어디서도 링크되지 않아 구글이 크롤 우선순위를
    // 낮게 잡는다. 이 기사에 실제로 등장한 브랜드만 editorial_brands 에서 읽어
    // 렌더러가 /brand/<id> 내부 링크를 달게 한다. brands 에 실재하는 행만 조인해
    // 오므로 404 링크가 생기지 않는다(브랜드 SSR 은 없는 id 면 404).
    // ※ editorial_brands(매핑 테이블)를 쓰지 않는다 — 실측 결과 발행 2,490건 중
    //   798건만 있고 2026-05-04 이후 갱신이 멈춰 있어 신규 기사에는 링크가 안 붙는다.
    //   대신 기사 자신의 fashion 크레딧에서 핸들을 뽑아 brands 에 실재하는 것만 남긴다.
    //   → 옛 기사·새 기사 모두 자동 적용되고, 실재 확인을 거치므로 404 링크가 없다.
    try {
      /* 2026-07-29 — 크레딧 파싱을 공용 parseBrandCredits 로 교체.
         여기서 신형 { brands:[...] } 만 읽고 있었는데, 실제 DB 는 구형 배열
         [{ n, id }] 이 2,373건으로 다수였다. 그래서 실제 브랜드 크레딧을 가진
         발행 기사 788건(고유 브랜드 4,970개)의 링크가 통째로 0개였다.
         공용 파서가 두 형태와 더미 크레딧([{n:'Brand',id:'@brand'}] 1,559건)을
         함께 처리한다. */
      const ids = parseBrandCredits(data.fashion).map((b) => b.id);
      if (ids.length) {
        const { data: bRows } = await supabaseAdmin
          .from('brands')
          .select('brand_id, display_name')
          .in('brand_id', ids.slice(0, 40))
          .neq('status', 'archived');
        data.linked_brands = (bRows || []).filter(b => b && b.brand_id && b.display_name);
      }
    } catch (_) { /* 브랜드 링크도 best-effort — 실패해도 페이지는 정상 렌더 */ }

    /* 인바운드 계측 (2026-08-07 추가). 기사·페퍼릿에만 붙어 있어서
       **주력 콘텐츠인 에디토리얼로 들어오는 유입이 통째로 안 잡혔다.** */
    await logSocialInclick(req, 'editorial');
    await logAiCrawl(req);

    /* 2026-08-27 (도메니코 결정) — 비회원·무료 회원에게는 앞 2장만.
     * 이 페이지는 로그인 여부와 무관하게 모두에게 같은 HTML 이 나가고
     * CDN 에 공용 캐시된다. 전체 이미지는 로그인한 스탠다드 이상이
     * /api/editorials/:id 로 브라우저에서 채운다. 근거는
     * api/_lib/editorialAccess.js 의 PREVIEW_IMAGES 주석에 있다. */
    return res.status(200).send(renderSeoHtml('editorial', data, {
      lang, translation, availableLangs, galleryLimit: PREVIEW_IMAGES,
    }));

  } catch (err) {
    console.error('[seo/editorial] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('editorial', slug));
  }
};
