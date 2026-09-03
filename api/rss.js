/**
 * PAP Magazine — RSS 2.0 Feed  (SEO Phase 2 #3)
 * Route: /rss.xml  (rewritten in vercel.json)
 *
 * 기사 + 에디토리얼 최신 50건 통합 피드.
 * 용도:
 *   - 네이버 서치어드바이저 RSS 제출 (네이버는 RSS 기반 수집이 가장 확실)
 *   - Google Discover/뉴스 수집 보조, 피드 리더 구독
 *   - 서드파티 신디케이션
 *
 * media:content 로 대표 이미지 포함 (이미지 검색·리치 피드 대응).
 */

const { HTML_TAG_RE, dropKnownTags } = require('./_lib/stripHtml');
const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const FEED_TITLE = 'PAP MAGAZINE';
const FEED_DESC = 'PAP Magazine — global fashion, editorial & film. 패션·아트·뷰티·컬쳐 매거진 PAP의 최신 에디토리얼과 기사. Instagram @pap_magazine';

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function rfc822(d) {
  try { return new Date(d || Date.now()).toUTCString(); }
  catch { return new Date().toUTCString(); }
}
// 설명문 정리: HTML 태그 제거 + 300자 컷
function cleanDesc(s) {
  return String(s || '').replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/* Ⅱ-23 (확장전략55, 2026-08-27) — RSS 풀텍스트.
   요약만 나가면 LLM 수집기·피드 리더가 본문을 못 가져간다. 기사 본문을
   content:encoded(CDATA)로 싣는다. 블록 JSON([{...}])이면 텍스트만 뽑아
   문단으로 잇고, HTML 이면 그대로 둔다(리더가 렌더). 40KB 컷 — 피드 전체가
   수 MB 가 되면 수집기가 통째로 버린다. 에디토리얼은 본문이 이미지라 제외. */
function fullContent(raw) {
  if (raw == null) return '';
  let s = String(raw);
  const t = s.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const blocks = JSON.parse(t);
      const arr = Array.isArray(blocks) ? blocks : [blocks];
      s = arr.map(b => {
        if (!b) return '';
        if (typeof b === 'string') return b;
        return b.text || b.content || b.caption || '';
      }).filter(Boolean).map(x => '<p>' + String(x) + '</p>').join('\n');
    } catch (_) { /* JSON 이 아니면 원문 그대로 */ }
  }
  s = s.trim();
  if (!s) return '';
  return s.length > 40000 ? s.slice(0, 40000) + '…' : s;
}
function cdata(s) {
  /* CDATA 안에 ]]> 가 오면 섹션이 깨진다 — 표준 분할 이스케이프 */
  return '<![CDATA[' + String(s).split(']]>').join(']]]]><![CDATA[>') + ']]>';
}

/* 신디케이션 utm — 규칙·이유는 _lib/rssUtm.js (rss-editorials.js 와 공유) */
const { srcParam, withRssUtm } = require('./_lib/rssUtm');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const src = srcParam(req);

  try {
    const [artsR, edsR] = await Promise.all([
      supabaseAdmin
        .from('articles')
        /* 2026-08-27 실측: articles 에는 description 컬럼이 없다(seo_description·
           description_en 뿐). 종전 select 가 그 유령 컬럼 때문에 400으로 죽는데
           error 를 안 봐서 **피드에서 기사가 조용히 전멸**해 있었다 — 에디토리얼만
           나가는 피드를 아무도 눈치 못 챘다. 실재 컬럼으로 교정 + 아래 error 가시화. */
        .select('id, title, slug, custom_url, published_date, seo_description, description_en, content, hero_image_url, thumbnail_url')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
      .order('created_at', { ascending: false })
        .limit(30),
      supabaseAdmin
        .from('editorials')
        .select('id, title, slug, published_date, description, thumbnail, cover_image')
        .eq('status', 'published')
        .not('published_date', 'is', null)
        .lte('published_date', new Date().toISOString())
        .order('published_date', { ascending: false })
      .order('created_at', { ascending: false })
        .limit(30),
    ]);

    /* 한쪽 소스가 죽으면 로그에 이유를 남긴다 — 조용한 반쪽 피드 금지 */
    if (artsR.error) console.error('[rss] articles query failed:', artsR.error.message);
    if (edsR.error) console.error('[rss] editorials query failed:', edsR.error.message);

    const items = [];

    (artsR.data || []).forEach(a => {
      const handle = a.slug || a.custom_url || a.id; // 2026-07-22 정식 slug 우선 (RSS 링크 301 제거)
      if (!handle || !a.title) return;
      items.push({
        title: a.title,
        link: SITE + '/article/' + encodeURIComponent(handle),
        desc: cleanDesc(a.seo_description || a.description_en),
        body: fullContent(a.content),
        date: a.published_date,
        img: a.hero_image_url || a.thumbnail_url || '',
        category: 'Article',
      });
    });

    (edsR.data || []).forEach(e => {
      const handle = e.slug || e.id;
      if (!handle || !e.title) return;
      items.push({
        title: e.title,
        link: SITE + '/editorial/' + encodeURIComponent(handle),
        desc: cleanDesc(e.description),
        date: e.published_date,
        img: e.thumbnail || e.cover_image || '',
        category: 'Editorial',
      });
    });

    // 최신순 통합 정렬 → 상위 50
    items.sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
    const top = items.slice(0, 50);

    const itemXml = top.map(it =>
      '    <item>\n' +
      '      <title>' + xmlEscape(it.title) + '</title>\n' +
      '      <link>' + xmlEscape(withRssUtm(it.link, src)) + '</link>\n' +
      '      <guid isPermaLink="true">' + xmlEscape(it.link) + '</guid>\n' +
      '      <pubDate>' + rfc822(it.date) + '</pubDate>\n' +
      '      <category>' + xmlEscape(it.category) + '</category>\n' +
      (it.desc ? '      <description>' + xmlEscape(it.desc) + '</description>\n' : '') +
      (it.body ? '      <content:encoded>' + cdata(it.body) + '</content:encoded>\n' : '') +
      (it.img ? '      <media:content url="' + xmlEscape(it.img) + '" medium="image" />\n' : '') +
      '    </item>'
    ).join('\n');

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n' +
      '  <channel>\n' +
      '    <title>' + xmlEscape(FEED_TITLE) + '</title>\n' +
      '    <link>' + SITE + '</link>\n' +
      '    <description>' + xmlEscape(FEED_DESC) + '</description>\n' +
      '    <language>ko</language>\n' +
      '    <lastBuildDate>' + rfc822(top.length ? top[0].date : null) + '</lastBuildDate>\n' +
      '    <atom:link href="' + SITE + '/rss.xml" rel="self" type="application/rss+xml" />\n' +
      itemXml + '\n' +
      '  </channel>\n' +
      '</rss>\n';

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    // 새 글 반영 10분 내 — 피드 소비자(네이버 봇 등)에 충분히 신선.
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[rss] error:', err);
    return res.status(500).send('feed error');
  }
};
