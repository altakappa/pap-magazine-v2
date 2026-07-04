/**
 * PAP Magazine — Google News Sitemap  (SEO Phase 2 #4)
 * Route: /sitemap-news.xml  (rewritten in vercel.json)
 *
 * Google News/Top Stories 는 news 사이트맵의 <news:news> 항목 중
 * "최근 2일(48시간) 내 발행" 기사만 수집한다. 그래서 이 사이트맵은
 * 항상 최근 48시간의 기사만 노출하고, 기사가 없으면 빈 urlset 을
 * 반환한다 (빈 사이트맵도 유효 — 크롤러가 주기적으로 재방문).
 *
 * 캐시 10분 — 새 기사 발행 후 빠르게 반영.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const PUB_NAME = 'PAP MAGAZINE';

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: arts } = await supabaseAdmin
      .from('articles')
      .select('id, title, custom_url, published_date')
      .eq('status', 'published')
      .gte('published_date', cutoff)
      .order('published_date', { ascending: false })
      .limit(100);

    const urls = (arts || []).map(a => {
      const handle = a.custom_url || a.id;
      if (!handle || !a.title) return '';
      const loc = SITE + '/article/' + encodeURIComponent(handle);
      const pubDate = new Date(a.published_date).toISOString();
      return '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <news:news>\n' +
        '      <news:publication>\n' +
        '        <news:name>' + xmlEscape(PUB_NAME) + '</news:name>\n' +
        '        <news:language>ko</news:language>\n' +
        '      </news:publication>\n' +
        '      <news:publication_date>' + pubDate + '</news:publication_date>\n' +
        '      <news:title>' + xmlEscape(a.title) + '</news:title>\n' +
        '    </news:news>\n' +
        '  </url>';
    }).filter(Boolean);

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
      'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n' +
      urls.join('\n') + (urls.length ? '\n' : '') +
      '</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap-news] error:', err);
    return res.status(500).send('sitemap error');
  }
};
