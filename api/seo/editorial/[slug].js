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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
    return res.status(200).send(renderSeoHtml('editorial', data, { lang: req.query.lang === 'en' ? 'en' : 'ko' }));

  } catch (err) {
    console.error('[seo/editorial] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('editorial', slug));
  }
};
