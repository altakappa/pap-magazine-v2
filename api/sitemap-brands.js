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
const { parseBrandCredits } = require('./_lib/fashionCredits');

const BASE = 'https://www.pap-magazine.com';

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    // 콘텐츠가 있는 브랜드 = 발행 에디토리얼의 fashion 크레딧에 실제로 등장하는 brand_id.
    // (2026-08-04) 예전엔 editorial_brands 매핑 테이블을 썼는데, 그 테이블은 2026-05-04
    // 이후 적재가 멈춰(실측) 브랜드 페이지의 실제 index/noindex 판단과 어긋났다. 브랜드
    // 페이지(api/seo/brand/[id].js)는 '발행 에디토리얼의 라이브 fashion 크레딧에 이 브랜드가
    // 있으면 index, 없으면 noindex' 로 판단한다. 사이트맵도 같은 소스를 써야
    // 'noindex 페이지가 사이트맵에 있음'(Ahrefs 511건) 모순이 사라진다. 에디토리얼·브랜드
    // SSR 과 동일하게 parseBrandCredits 로 구형/신형 크레딧 형식을 모두 읽는다.
    const credited = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('editorials')
        .select('fashion')
        .eq('status', 'published')
        .not('fashion', 'is', null)
        .range(from, from + 999);
      if (error) break;
      if (!data || !data.length) break;
      data.forEach(e => parseBrandCredits(e.fashion).forEach(b => credited.add(b.id)));
      if (data.length < 1000) break;
    }

    // archived 제외한 유효 브랜드 중, 실제 크레딧에 등장하는 것만
    const { data: brands } = await supabaseAdmin
      .from('brands').select('brand_id, status').neq('status', 'archived').limit(5000);

    const ids = (brands || [])
      .map(b => b.brand_id)
      .filter(id => id && credited.has(String(id).toLowerCase()));

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
