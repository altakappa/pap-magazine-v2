/**
 * PAP Magazine — HTML Archive (크롤러블 전체 콘텐츠 인덱스)
 * Route: /archive  (rewritten in vercel.json)
 *
 * SEO Phase 2 #5 — 네이버/다음 등 JS 를 렌더링하지 않는 크롤러가
 * 사이트의 모든 상세페이지에 도달할 수 있는 서버 렌더 링크 허브.
 * 홈(정적) → /archive(SSR) → 모든 /editorial /article /film 상세(SSR)
 * 로 2홉 링크 그래프가 완성된다. 사람에게는 심플한 아카이브 페이지.
 *
 * 캐시: 30분 edge + 24h SWR — 콘텐츠 발행 후 30분 내 반영.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');

const SITE = 'https://www.pap-magazine.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function dateStr(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
}

function section(title, items) {
  if (!items.length) return '';
  return (
    '<section>\n<h2>' + esc(title) + ' <span class="cnt">(' + items.length + ')</span></h2>\n<ul>\n' +
    items.map(it =>
      '<li><a href="' + esc(it.href) + '">' + esc(it.title) + '</a>' +
      (it.date ? ' <time datetime="' + it.date + '">' + it.date + '</time>' : '') + '</li>'
    ).join('\n') +
    '\n</ul>\n</section>\n'
  );
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    const nowIso = new Date().toISOString();
    const [eds, arts, films] = await Promise.all([
      supabaseAdmin.from('editorials')
        .select('title, slug, id, published_date, scheduled_publish_at')
        .eq('status', 'published')
        .or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${nowIso}`)
        .order('published_date', { ascending: false, nullsFirst: false })
        .limit(3000),
      supabaseAdmin.from('articles')
        .select('title, slug, custom_url, id, published_date')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
        .limit(1000),
      supabaseAdmin.from('films')
        .select('title, slug, id, published_date')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
        .limit(1000),
    ]);

    const edItems = (eds.data || []).filter(e => e.title).map(e => ({
      title: e.title,
      href: '/editorial/' + encodeURIComponent(e.slug || e.id),
      date: dateStr(e.published_date),
    }));
    const artItems = (arts.data || []).filter(a => a.title).map(a => ({
      title: a.title,
      href: '/article/' + encodeURIComponent(a.slug || a.custom_url || a.id), // 2026-07-22 정식 slug 우선 (내부 301 링크 제거)
      date: dateStr(a.published_date),
    }));
    const filmItems = (films.data || []).filter(f => f.title).map(f => ({
      title: f.title,
      href: '/film/' + encodeURIComponent(f.slug || f.id),
      date: dateStr(f.published_date),
    }));

    const total = edItems.length + artItems.length + filmItems.length;

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Archive — All Editorials, Articles &amp; Films | PAP Magazine</title>
<meta name="description" content="PAP MAGAZINE 전체 아카이브 — 에디토리얼 ${edItems.length}편, 기사 ${artItems.length}건, 패션 필름 ${filmItems.length}편의 전체 목록. Browse the complete index of PAP Magazine editorials, articles and fashion films.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${SITE}/archive">
<meta property="og:title" content="Archive | PAP Magazine">
<meta property="og:description" content="The complete index of PAP Magazine — ${total} editorials, articles and fashion films.">
<meta property="og:url" content="${SITE}/archive">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PAP Magazine">
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'PAP Magazine Archive',
  url: SITE + '/archive',
  description: 'Complete index of PAP Magazine editorials, articles and fashion films.',
  isPartOf: { '@type': 'WebSite', name: 'PAP Magazine', url: SITE },
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Archive', item: SITE + '/archive' },
    ],
  },
})}
</script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#000;color:#fff;line-height:1.8;-webkit-font-smoothing:antialiased}
  .wrap{max-width:860px;margin:0 auto;padding:89px 21px}
  h1{font-size:34px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:13px}
  .sub{font-size:13px;color:rgba(255,255,255,.5);margin-bottom:55px}
  h2{font-size:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:55px 0 21px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.15)}
  .cnt{color:rgba(255,255,255,.35);font-weight:400}
  ul{list-style:none}
  li{padding:5px 0;font-size:14px;display:flex;justify-content:space-between;gap:13px}
  li a{color:rgba(255,255,255,.85);text-decoration:none}
  li a:hover{color:#fff;text-decoration:underline;text-underline-offset:3px}
  time{color:rgba(255,255,255,.3);font-size:12px;flex-shrink:0}
  .home{display:inline-block;margin-bottom:34px;font-size:12px;letter-spacing:.1em;color:rgba(255,255,255,.6);text-decoration:none}
  .home:hover{color:#fff}
  footer{margin-top:89px;padding-top:21px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:rgba(255,255,255,.4)}
  footer a{color:rgba(255,255,255,.6);text-decoration:none;margin-right:13px}
</style>
</head>
<body>
<div class="wrap">
  <a class="home" href="/">&larr; PAP MAGAZINE</a>
  <h1>Archive</h1>
  <p class="sub">에디토리얼 ${edItems.length} · 기사 ${artItems.length} · 필름 ${filmItems.length} — PAP MAGAZINE 전체 콘텐츠 인덱스</p>
  ${section('Editorials', edItems)}
  ${section('Articles', artItems)}
  ${section('Films', filmItems)}
  <footer>
    <a href="/">Home</a><a href="/articles">Articles</a><a href="/films">Films</a><a href="/subscribe">Subscribe</a><a href="/about">About</a><a href="/rss.xml">RSS</a>
    <a href="/api/ig-out?src=archive&amp;to=profile&amp;url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" rel="noopener">Instagram @pap_magazine →</a>
  </footer>
</div>
<!-- 인바운드 계측 (2026-08-12). 이 페이지는 30분 edge 캐시라 서버에서 세면
     캐시 히트가 전부 누락된다 — 브라우저에서 재는 비콘이 맞다. -->
<script src="/pap-inclick.js?v=1" defer></script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[archive] error:', err);
    return res.status(500).send('archive error');
  }
};
