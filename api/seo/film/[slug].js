/**
 * PAP Magazine — Server-Side Rendered Film Page (SEO)
 * Route: /film/:slug   (rewritten in vercel.json)
 *
 * Films don't have slugs (only id + title + youtube_id), so we match
 * against title (URL-decoded) and id. The renderer emits a VideoObject
 * schema using the YouTube thumbnail + embed URL — gives Google a
 * proper video card in search.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { anyOutage, sendOutage } = require('../../_lib/dbOutage');
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
    return res.status(404).send(renderNotFoundHtml('film', ''));
  }

  const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
  // QA #222 — match the SPA's title-as-URL transform: hyphens → spaces.
  const dehyphenated = decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    let data = null;

    /* 1) Try slug column (some films do have slugs) */
    let r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
      .eq('slug', slug).eq('status', 'published').limit(1).maybeSingle();
    data = r.data;

    /* 1b) decoded slug (URL-encoded slugs) */
    if (!data && decoded !== slug) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('slug', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 1c) 대소문자만 다른 슬러그 → 정본 주소로 301. 에디토리얼(0a13776)과 동일 규칙.
       films 에도 대문자 섞인 슬러그가 실재한다(예: 'Selects-bts'). 정확히 1건만
       매칭될 때만 301 하고, 아니면 아래 title 폴백으로 넘긴다. 2026-08-05 */
    if (!data && !/%/.test(decoded)) {
      const safeSlugCi = decoded.replace(/[\\%_]/g, ch => '\\' + ch);
      const ci = await supabaseAdmin.from('films').select('slug')
        .ilike('slug', safeSlugCi).eq('status', 'published').limit(2);
      if (ci.data && ci.data.length === 1 && ci.data[0].slug && ci.data[0].slug !== decoded) {
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
        res.setHeader('Location', '/film/' + encodeURIComponent(ci.data[0].slug));
        return res.status(301).end();
      }
    }

    /* 2) Title match (films are commonly addressed by title) */
    if (!data) {
      /* 2026-09-14 — DB 장애를 404 로 말하지 않는다 (_lib/dbOutage.js 머리말).
         supabase-js 는 실패를 throw 하지 않고 { data:null, error } 로 준다.
         error 를 안 보면 '전송량 초과로 잠김' 과 '그런 글 없음' 이 같은 404 가 되고,
         구글은 그걸 '페이지가 사라졌다' 로 읽어 색인에서 뺀다. */
      if (anyOutage(r)) return sendOutage(res, 'film ' + slug);
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2b) title with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('title', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 2c) title ilike — QA #222 */
    if (!data && dehyphenated.length >= 3) {
      const safe = dehyphenated.replace(/[\\%_]/g, ch => '\\' + ch);
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .ilike('title', safe).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 3) youtube_id match (legacy URLs sometimes use the YT video id) */
    if (!data) {
      /* 장애면 404 로 넘기지 않는다 (2026-09-14, _lib/dbOutage.js) */
      if (anyOutage(r)) return sendOutage(res, 'film ' + slug);
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('youtube_id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* 4) UUID id (admin-share links) */
    if (!data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
      r = await supabaseAdmin.from('films').select('*, related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date,credits)')
        .eq('id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    if (!data) {
      /* 장애면 404 로 넘기지 않는다 (2026-09-14, _lib/dbOutage.js) */
      if (anyOutage(r)) return sendOutage(res, 'film ' + slug);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(renderNotFoundHtml('film', slug));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large, max-video-preview:-1');
    return res.status(200).send(renderSeoHtml('film', data, { lang: req.query.lang === 'en' ? 'en' : 'ko' }));

  } catch (err) {
    console.error('[seo/film] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('film', slug));
  }
};
