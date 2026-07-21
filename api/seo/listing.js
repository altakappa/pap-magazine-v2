/**
 * PAP Magazine — 목록 페이지 SSR (크롤러 전용 dynamic rendering)
 * Route: /api/seo/listing?kind=magazine|articles|films
 *
 * 2026-07-16 (SEO 감사 후속). /magazine /articles /films 는 SPA 셸이라
 * JS 를 렌더링하지 않는 크롤러(네이버 Yeti, 다음, 일부 AI 봇)에게는 빈
 * 페이지였다. vercel.json 에서 봇 User-Agent 일 때만 이 SSR 로 rewrite
 * — 사람 트래픽은 기존 SPA 그대로(성능 영향 0), 봇은 실제 콘텐츠 목록
 * + CollectionPage/ItemList 스키마를 받는다 (dynamic rendering 패턴).
 * SSR 내용은 SPA 가 렌더링하는 것과 동일한 목록 — 클로킹 아님.
 *
 * 캐시: 30분 edge + 24h SWR (archive.js 와 동일).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
// 2026-07-21 QA(표기 재발) — 표기 포맷터는 seoRenderer 하나에서 가져온다
const { fmtDisplayDate } = require('../_lib/seoRenderer');

const SITE = 'https://www.pap-magazine.com';
const LIMIT = 100; // 최근 100개 — 전량 인덱스는 /archive 허브가 담당

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function dateStr(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
}

/* seoRenderer.js 와 동일한 반응형 이미지 규칙 (허용 호스트만 변환). */
const IMG_OPT_HOSTS = [
  'pap-korea-bucket.s3.ap-northeast-2.amazonaws.com',
  'igcazquhkwxtqsaqpznx.supabase.co',
];
function thumbImg(url, alt) {
  if (!url) return '';
  let srcset = '';
  try {
    if (IMG_OPT_HOSTS.indexOf(new URL(url).hostname) !== -1) {
      srcset = ' srcset="' + esc([320, 640].map(w =>
        '/_vercel/image?url=' + encodeURIComponent(url) + '&w=' + w + '&q=75 ' + w + 'w'
      ).join(', ')) + '" sizes="(max-width:700px) 45vw, 260px"';
    }
  } catch (_) { /* 원본 유지 */ }
  return '<img src="' + esc(url) + '"' + srcset + ' alt="' + esc(alt) + '" loading="lazy" decoding="async" width="260" height="325">';
}

const KINDS = {
  magazine: {
    title: 'Magazine — Editorials | PAP Magazine',
    h1: 'Magazine',
    desc: 'PAP MAGAZINE 에디토리얼 아카이브 — 전 세계 크리에이티브 팀과 만드는 하이엔드 패션·뷰티·컬쳐 화보. Latest fashion editorials by PAP Magazine.',
    canonical: SITE + '/magazine',
    breadcrumb: 'Magazine',
  },
  articles: {
    title: 'Articles — Fashion, Beauty & Culture News | PAP Magazine',
    h1: 'Articles',
    desc: 'PAP MAGAZINE 아티클 — 패션·뷰티·컬쳐·셀럽 뉴스와 트렌드 큐레이션. Latest fashion, beauty and culture stories by PAP Magazine.',
    canonical: SITE + '/articles',
    breadcrumb: 'Articles',
  },
  films: {
    title: 'Films — Fashion Films & Shorts | PAP Magazine',
    h1: 'Films',
    desc: 'PAP MAGAZINE 패션 필름 & 쇼츠 — 무빙 이미지로 확장되는 에디토리얼. Fashion films and shorts by PAP Magazine.',
    canonical: SITE + '/films',
    breadcrumb: 'Films',
  },
};

async function fetchItems(kind) {
  const nowIso = new Date().toISOString();
  if (kind === 'magazine') {
    const { data } = await supabaseAdmin.from('editorials')
      .select('title, slug, id, published_date, cover_image, og_image, thumbnail, scheduled_publish_at')
      .eq('status', 'published')
      .or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${nowIso}`)
      .order('published_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return (data || []).filter(e => e.title).map(e => ({
      title: e.title,
      href: '/editorial/' + encodeURIComponent(e.slug || e.id),
      date: dateStr(e.published_date),
      img: e.og_image || e.cover_image || e.thumbnail || '',
    }));
  }
  if (kind === 'articles') {
    const { data } = await supabaseAdmin.from('articles')
      .select('title, custom_url, slug, id, published_date, hero_image_url, thumbnail_url')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    return (data || []).filter(a => a.title).map(a => ({
      title: a.title,
      href: '/article/' + encodeURIComponent(a.custom_url || a.slug || a.id),
      date: dateStr(a.published_date),
      img: a.thumbnail_url || a.hero_image_url || '',
    }));
  }
  // films: 필름 + 쇼츠 통합 (sitemap-films 와 동일 구성)
  const [films, shorts] = await Promise.all([
    supabaseAdmin.from('films')
      .select('title, slug, id, published_date, created_at, thumbnail_url, youtube_id')
      .eq('status', 'published').order('published_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(LIMIT),
    supabaseAdmin.from('shorts')
      .select('title, slug, id, published_date, created_at, thumbnail_url, youtube_id')
      .eq('status', 'published').order('published_date', { ascending: false })
      .order('created_at', { ascending: false }).limit(LIMIT),
  ]);
  return [].concat(films.data || [], shorts.data || [])
    .filter(f => f.title)
    // 2026-07-20 — published_date 는 DATE(시각 없음)이라 같은 날 항목의
    // 순서가 불확정. created_at(타임스탬프)을 2차 키로 써서 최신이 항상 위로.
    .sort((a, b) =>
      String(b.published_date || '').localeCompare(String(a.published_date || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, LIMIT)
    .map(f => ({
      title: f.title,
      href: '/film/' + encodeURIComponent(f.slug || f.id),
      date: dateStr(f.published_date),
      img: f.thumbnail_url || (f.youtube_id ? `https://img.youtube.com/vi/${f.youtube_id}/hqdefault.jpg` : ''),
    }));
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const kind = String(req.query.kind || '');
  const cfg = KINDS[kind];
  if (!cfg) return res.status(404).send('unknown kind');

  let items = [];
  try { items = await fetchItems(kind); } catch (e) {
    console.error('[seo/listing] fetch failed:', e);
    // DB 실패여도 메타·링크 프레임은 내보낸다 (크롤러에 500 대신 빈 목록)
  }

  const itemListSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: cfg.h1 + ' | PAP Magazine',
    url: cfg.canonical,
    description: cfg.desc,
    isPartOf: { '@type': 'WebSite', name: 'PAP Magazine', url: SITE },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: cfg.breadcrumb, item: cfg.canonical },
      ],
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.slice(0, 50).map((it, i) => ({
        '@type': 'ListItem', position: i + 1, name: it.title, url: SITE + it.href,
      })),
    },
  };

  const cards = items.map(it =>
    '<a class="card" href="' + esc(it.href) + '">' +
    thumbImg(it.img, it.title + ' — Cover') +
    '<span class="t">' + esc(it.title) + '</span>' +
    // 2026-07-21 QA(표기 재발) — 보이는 텍스트는 홈·목록·상세와 같은
    // "DD Mon YYYY". datetime 속성은 기계용이라 ISO 를 유지한다.
    (it.date ? '<time datetime="' + it.date + '">' + esc(fmtDisplayDate(it.date)) + '</time>' : '') +
    '</a>'
  ).join('\n');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(cfg.title)}</title>
<meta name="description" content="${esc(cfg.desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(cfg.canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(cfg.title)}">
<meta property="og:description" content="${esc(cfg.desc)}">
<meta property="og:url" content="${esc(cfg.canonical)}">
<meta property="og:site_name" content="PAP Magazine">
${items[0] && items[0].img ? `<meta property="og:image" content="${esc(items[0].img)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@papmagazine_">
<script type="application/ld+json">${JSON.stringify(itemListSchema)}</script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#000;color:#fff;line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1200px;margin:0 auto;padding:72px 20px}
  h1{font-size:34px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px}
  .sub{font-size:13px;color:rgba(255,255,255,.5);margin-bottom:44px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
  @media(min-width:700px){.grid{grid-template-columns:repeat(4,1fr);gap:24px}}
  .card{display:block;color:inherit;text-decoration:none}
  .card img{display:block;width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;background:#111}
  .card .t{display:block;margin-top:10px;font-size:13.5px;font-weight:600;line-height:1.45}
  .card time{display:block;margin-top:4px;font-size:11px;color:rgba(255,255,255,.35)}
  .home{display:inline-block;margin-bottom:30px;font-size:12px;letter-spacing:.1em;color:rgba(255,255,255,.6);text-decoration:none}
  footer{margin-top:72px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:rgba(255,255,255,.4)}
  footer a{color:rgba(255,255,255,.6);text-decoration:none;margin-right:12px}
</style>
</head>
<body>
<div class="wrap">
  <a class="home" href="/">&larr; PAP MAGAZINE</a>
  <h1>${esc(cfg.h1)}</h1>
  <p class="sub">${esc(cfg.desc)}</p>
  <div class="grid">
${cards}
  </div>
  <footer>
    <a href="/">Home</a><a href="/archive">Full Archive</a><a href="/magazine">Magazine</a><a href="/articles">Articles</a><a href="/films">Films</a><a href="/subscribe">Subscribe</a><a href="/rss.xml">RSS</a>
    <a href="https://www.instagram.com/pap_magazine/" rel="noopener">Instagram @pap_magazine →</a>
  </footer>
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
  return res.status(200).send(html);
};
