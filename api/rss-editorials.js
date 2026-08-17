/**
 * PAP Magazine — 에디토리얼 전용 RSS 2.0  (Pinterest 자동 발행용)
 * Route: /rss-editorials.xml  (rewritten in vercel.json)
 *
 * /rss.xml 은 기사+에디토리얼 통합이지만, 이 피드는 **에디토리얼만**
 * 담는다. 핀터레스트 비즈니스 계정의 "RSS 자동 발행"에 이 URL 을
 * 등록하면 새 에디토리얼이 발행될 때마다 자동으로 핀이 생성된다.
 *
 * Pinterest 최적화:
 *   - 큰 커버 이미지 우선 (cover_image → og_image → thumbnail).
 *     핀터레스트는 세로 대형 이미지를 선호하므로 썸네일보다 커버.
 *   - media:content + enclosure 양쪽에 이미지 (핀터레스트 파서 호환).
 *   - 설명 첫 줄에 키워드("... — PAP Magazine editorial")로 검색 대응.
 *   - 최신 에디토리얼 50건 (핀터레스트가 이미 핀된 항목은 자동 스킵).
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const FEED_TITLE = 'PAP MAGAZINE — Editorials';
const FEED_DESC = 'PAP Magazine editorials — global fashion, beauty & culture. 전 세계 크리에이티브 팀과 만드는 패션 에디토리얼.';

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
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/* 신디케이션 utm (2026-08-17) — 도메니코 결정: 핀터레스트·플립보드에는
 * 에디토리얼만. 그래서 플립보드 등록 주소가 바로 이 피드다:
 * /rss-editorials.xml?src=flipboard  (규칙·이유는 _lib/rssUtm.js) */
const { srcParam, withRssUtm } = require('./_lib/rssUtm');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const src = srcParam(req);

  try {
    const { data: eds } = await supabaseAdmin
      .from('editorials')
      .select('id, title, title_en, slug, published_date, description, description_en, thumbnail, cover_image, og_image, issue')
      .eq('status', 'published')
      .not('published_date', 'is', null)
      .lte('published_date', new Date().toISOString())
      .order('published_date', { ascending: false })
      .limit(100);  // 최근 100건 — 네이버/신디케이션용. Pinterest 대량 발행은 API 크론(sync-pinterest)이 담당.

    const items = (eds || []).map(e => {
      const handle = e.slug || e.id;
      if (!handle || !e.title) return null;
      // Pinterest 는 세로 대형 이미지를 선호 → 커버 우선
      const img = e.cover_image || e.og_image || e.thumbnail || '';
      // 설명 첫 줄에 키워드. 본문 설명(ko→en) 이어붙임.
      const baseDesc = cleanDesc(e.description) || cleanDesc(e.description_en);
      const kw = e.title + ' — PAP Magazine editorial'
        + (e.issue ? ' · ' + e.issue : '');
      const desc = baseDesc ? (kw + '. ' + baseDesc) : kw;
      return {
        title: e.title,
        link: SITE + '/editorial/' + encodeURIComponent(handle),
        desc,
        date: e.published_date,
        img,
      };
    }).filter(Boolean);

    const itemXml = items.map(it =>
      '    <item>\n' +
      '      <title>' + xmlEscape(it.title) + '</title>\n' +
      '      <link>' + xmlEscape(withRssUtm(it.link, src)) + '</link>\n' +
      '      <guid isPermaLink="true">' + xmlEscape(it.link) + '</guid>\n' +
      '      <pubDate>' + rfc822(it.date) + '</pubDate>\n' +
      '      <category>Editorial</category>\n' +
      '      <description>' + xmlEscape(it.desc) + '</description>\n' +
      (it.img
        ? '      <media:content url="' + xmlEscape(it.img) + '" medium="image" />\n' +
          '      <enclosure url="' + xmlEscape(it.img) + '" type="image/jpeg" />\n'
        : '') +
      '    </item>'
    ).join('\n');

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
      '  <channel>\n' +
      '    <title>' + xmlEscape(FEED_TITLE) + '</title>\n' +
      '    <link>' + SITE + '/magazine</link>\n' +
      '    <description>' + xmlEscape(FEED_DESC) + '</description>\n' +
      '    <language>ko</language>\n' +
      '    <lastBuildDate>' + rfc822(items.length ? items[0].date : null) + '</lastBuildDate>\n' +
      '    <atom:link href="' + SITE + '/rss-editorials.xml" rel="self" type="application/rss+xml" />\n' +
      itemXml + '\n' +
      '  </channel>\n' +
      '</rss>\n';

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[rss-editorials] error:', err);
    return res.status(500).send('feed error');
  }
};
