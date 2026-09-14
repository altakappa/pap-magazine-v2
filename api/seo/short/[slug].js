/**
 * PAP Magazine — Server-Side Rendered Shorts Page (SEO)
 * Route: /short/:slug   (rewritten in vercel.json)
 *
 * Same shape as /film/:slug but for the `shorts` table. YouTube Shorts
 * are short-form video, so we still emit VideoObject schema.
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
    return res.status(404).send(renderNotFoundHtml('short', ''));
  }

  const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
  // QA #222 — SPA encodes title with hyphens; reverse on the SSR side.
  const dehyphenated = decoded.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    let data = null;

    let r = await supabaseAdmin.from('shorts').select('*')
      .eq('title', decoded).eq('status', 'published').limit(1).maybeSingle();
    data = r.data;

    /* title with hyphens stripped — QA #222 */
    if (!data && dehyphenated !== decoded) {
      r = await supabaseAdmin.from('shorts').select('*')
        .eq('title', dehyphenated).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    /* title ilike — QA #222 */
    if (!data && dehyphenated.length >= 3) {
      const safe = dehyphenated.replace(/[\\%_]/g, ch => '\\' + ch);
      r = await supabaseAdmin.from('shorts').select('*')
        .ilike('title', safe).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    if (!data) {
      /* 2026-09-14 — DB 장애를 404 로 말하지 않는다 (_lib/dbOutage.js 머리말).
         supabase-js 는 실패를 throw 하지 않고 { data:null, error } 로 준다.
         error 를 안 보면 '전송량 초과로 잠김' 과 '그런 글 없음' 이 같은 404 가 되고,
         구글은 그걸 '페이지가 사라졌다' 로 읽어 색인에서 뺀다. */
      if (anyOutage(r)) return sendOutage(res, 'short ' + slug);
      r = await supabaseAdmin.from('shorts').select('*')
        .eq('youtube_id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    if (!data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) {
      r = await supabaseAdmin.from('shorts').select('*')
        .eq('id', slug).eq('status', 'published').limit(1).maybeSingle();
      data = r.data;
    }

    if (!data) {
      /* 장애면 404 로 넘기지 않는다 (2026-09-14, _lib/dbOutage.js) */
      if (anyOutage(r)) return sendOutage(res, 'short ' + slug);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(renderNotFoundHtml('short', slug));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    /* 2026-09-14 — 전송량 초과 사고 후속. 엣지 신선도 5분 → 1시간.
       같은 URL 을 반복해 긁는 함대가 5분마다 DB 를 한 번씩 깨우고 있었다.
       기사는 발행 뒤 거의 안 바뀌므로 1시간이면 충분하다. 수정이 급하면
       재배포하면 즉시 반영된다 (엣지 캐시는 배포마다 새로 시작한다). */
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large, max-video-preview:-1');
    return res.status(200).send(renderSeoHtml('short', data, { lang: req.query.lang === 'en' ? 'en' : 'ko' }));

  } catch (err) {
    console.error('[seo/short] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderNotFoundHtml('short', slug));
  }
};
