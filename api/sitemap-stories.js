/**
 * PAP Magazine — Web Stories 사이트맵 (Ⅵ-51, 2026-08-27)
 * Route: /sitemap-stories.xml → /api/sitemap-stories
 * 스토리는 발행 화보 1:1 (/stories/<slug>) — 커버나 갤러리가 있는 것만.
 */

'use strict';

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');
const { hasRealImagery } = require('./_lib/realImage');

const SITE = 'https://www.pap-magazine.com';

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function fmtDate(d) {
  try { return new Date(d || Date.now()).toISOString().slice(0, 10); }
  catch { return new Date().toISOString().slice(0, 10); }
}
/* sitemap-editorials 와 같은 원칙 — URL 이 깨끗한 slug 만 광고한다 */
function cleanHandle(h) {
  const s = String(h || '');
  return s && /^[a-z0-9-]+$/.test(s) ? s : null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('editorials')
      .select('slug, cover_image, thumbnail, gallery, updated_at, published_date')
      .eq('status', 'published')
      .not('published_date', 'is', null)
      .order('published_date', { ascending: false })
      .limit(1000);
    if (error) throw error;

    const urls = [];
    for (const e of (data || [])) {
      const slug = cleanHandle(e.slug);
      if (!slug) continue;
      /* 플레이스홀더·죽은 링크는 스토리를 만들지 않는다 — 구글에 그라데이션을
         광고하는 꼴이 된다 (2026-08-27 실사: 껍데기 14편). */
      if (!hasRealImagery(e)) continue;
      urls.push('  <url><loc>' + xmlEscape(SITE + '/stories/' + slug) + '</loc>'
        + '<lastmod>' + fmtDate(e.updated_at || e.published_date) + '</lastmod></url>');
    }

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.join('\n') + '\n</urlset>\n';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap-stories]', (err && err.message) || err);
    return res.status(500).send('temporary error');
  }
};
