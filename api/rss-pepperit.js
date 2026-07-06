/**
 * PEPPERIT — RSS 2.0 Feed
 * Route: pepperitmag.com/rss.xml  (vercel.json 호스트 라우팅)
 *
 * 페퍼릿 기사 최신 50건. 네이버 서치어드바이저 RSS 제출용
 * (네이버는 RSS 기반 수집이 가장 확실) + 피드 리더 구독.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pepperitmag.com';
const FEED_TITLE = 'PEPPERIT';
const FEED_DESC = 'PEPPERIT(페퍼릿) — K-POP을 중심으로 패션·뷰티·컬쳐의 모든 모먼트를 가장 가볍고 빠르게. 잘파세대 데일리 컬쳐 매거진. Instagram @pepperitmag';

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function rfc822(d) {
  try { return new Date(d || Date.now()).toUTCString(); }
  catch { return new Date().toUTCString(); }
}
function cleanDesc(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const { data } = await supabaseAdmin
      .from('pepperit_articles')
      .select('id, title, slug, category, content, thumbnail_url, published_date')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(50);

    const itemXml = (data || []).map((a) => {
      const handle = a.slug || a.id;
      if (!handle || !a.title) return '';
      const link = SITE + '/article/' + encodeURIComponent(handle);
      const desc = cleanDesc(a.content);
      return '    <item>\n' +
        '      <title>' + xmlEscape(a.title) + '</title>\n' +
        '      <link>' + xmlEscape(link) + '</link>\n' +
        '      <guid isPermaLink="true">' + xmlEscape(link) + '</guid>\n' +
        '      <pubDate>' + rfc822(a.published_date) + '</pubDate>\n' +
        (a.category ? '      <category>' + xmlEscape(a.category) + '</category>\n' : '') +
        (desc ? '      <description>' + xmlEscape(desc) + '</description>\n' : '') +
        (a.thumbnail_url ? '      <media:content url="' + xmlEscape(a.thumbnail_url) + '" medium="image" />\n' : '') +
        '    </item>';
    }).filter(Boolean).join('\n');

    const newest = data && data.length ? data[0].published_date : null;
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
      '  <channel>\n' +
      '    <title>' + xmlEscape(FEED_TITLE) + '</title>\n' +
      '    <link>' + SITE + '</link>\n' +
      '    <description>' + xmlEscape(FEED_DESC) + '</description>\n' +
      '    <language>ko</language>\n' +
      '    <lastBuildDate>' + rfc822(newest) + '</lastBuildDate>\n' +
      '    <atom:link href="' + SITE + '/rss.xml" rel="self" type="application/rss+xml" />\n' +
      itemXml + '\n' +
      '  </channel>\n' +
      '</rss>\n';

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[rss-pepperit] error:', err);
    return res.status(500).send('feed error');
  }
};
