/**
 * PAP Magazine — 브랜드 허브 사이트맵 (sitemap-brands.xml)
 * Route: /sitemap-brands.xml  (rewritten in vercel.json → /api/sitemap-brands)
 *
 * /brand/:id (브랜드 허브 페이지) 를 검색엔진에 색인시킨다. 에디토리얼이
 * 하나라도 있는(=indexable) 브랜드만 포함 — thin/noindex 페이지 제외.
 * sitemap-index.xml 에서 참조.
 *
 * 캐시: 6h edge + 24h SWR.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const BASE = 'https://www.pap-magazine.com';

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    // 콘텐츠가 있는 브랜드 = editorial_brands 에 등장하는 brand_id
    const { data: eb } = await supabaseAdmin
      .from('editorial_brands').select('brand_id').limit(20000);
    const withContent = new Set((eb || []).map(r => r.brand_id).filter(Boolean));

    // archived 제외한 유효 브랜드
    const { data: brands } = await supabaseAdmin
      .from('brands').select('brand_id, status').neq('status', 'archived').limit(5000);

    const ids = (brands || [])
      .map(b => b.brand_id)
      .filter(id => id && withContent.has(id));

    const today = new Date().toISOString().slice(0, 10);
    const urls = ids.map(id =>
      '  <url>\n' +
      '    <loc>' + BASE + '/brand/' + xmlEscape(encodeURIComponent(id)) + '</loc>\n' +
      '    <lastmod>' + today + '</lastmod>\n' +
      '    <changefreq>weekly</changefreq>\n' +
      '    <priority>0.6</priority>\n' +
      '  </url>'
    ).join('\n');

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls + '\n</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap-brands] error:', err);
    return res.status(500).send('sitemap error');
  }
};
