/**
 * PAP Magazine — Server-Side Rendered Editorial Page (SEO)
 * Route: /editorial/:slug   (rewritten in vercel.json)
 *
 * Returns full crawlable HTML with per-article meta tags, Open Graph,
 * Twitter Card, hreflang, schema.org Article + BreadcrumbList, and
 * the full editorial gallery (lazy-loaded).
 *
 * Lookup is 4-step: slug → decoded slug → title → UUID id.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { renderSeoHtml, renderNotFoundHtml } = require('../../_lib/seoRenderer');

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

    /* 2b) slug match with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('editorials').select('*')
        .eq('slug', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
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
    const VALID_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja'];
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
    return res.status(200).send(renderSeoHtml('editorial', data, { lang, translation, availableLangs }));

  } catch (err) {
    console.error('[seo/editorial] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('editorial', slug));
  }
};
