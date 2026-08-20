/**
 * PAP Magazine — 언어별 진입 페이지 SSR
 * Route: /api/seo/locale-home?lang=ja|en   (공개 주소: /ja , /en)
 *
 * 왜 만드나 (2026-08-20, SEO 전면진단 후속):
 *   기사는 9개 언어로 나가는데 **홈·목록은 한국어뿐**이었다. `/ja` `/en` 은
 *   `/` 로 301 이었다(vercel.json redirects 52·53·72·73). 그래서 일본어 검색으로
 *   들어온 사람은 기사 한 장을 보고 나갈 수밖에 없었고, 구글 입장에서는
 *   "일본어 사이트"가 존재하지 않았다 — 기사 낱장만 있었을 뿐이다.
 *   실측: ja 는 유입 2위 언어(워터밤·카ッセイ·지미로콰이 등 상위 페이지 다수).
 *
 * listing.js 와 다른 점:
 *   · listing.js 는 봇 전용 dynamic rendering 이다. 이 페이지는 **사람도 본다.**
 *     그래서 링크·푸터가 실제로 이동 가능한 곳만 가리킨다.
 *   · 제목을 번역본에서 가져온다. ja 는 seo_translations(kind/lang),
 *     en 은 articles.title_en / editorials.title_en (en 은 번역표에 행이 없다).
 *   · hreflang 을 3방향(ko·ja·en + x-default)으로 건다. 홈(index.html)은
 *     2026-07-16 에 hreflang 을 뺐는데, 그때는 **언어별 URL 이 없어서** 맞는
 *     판단이었다. 이제 생기므로 그 결정의 전제가 바뀐다 (index.html 주석 참조).
 *
 * 캐시: 30분 edge + 24h SWR (listing.js 와 동일).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { fmtDisplayDate } = require('../_lib/seoRenderer');

const SITE = 'https://www.pap-magazine.com';
const LIMIT = 48;          // 언어별 최신 48편 (기사 + 에디토리얼 합산)
const PER_KIND = 60;       // 각 표에서 넉넉히 뽑아 번역 있는 것만 남긴다

/* 지원 언어. 여기 없는 값은 404 — 번역 품질이 확인된 언어만 연다.
   ja: 유입 2위. en: 영어권 진입. 나머지는 종전대로 `/` 로 301 유지. */
const LOCALES = {
  ja: {
    htmlLang: 'ja',
    title: 'PAP MAGAZINE — 韓国発ファッション・ビューティー・カルチャーマガジン',
    h1: 'PAP MAGAZINE',
    tagline: '韓国のファッション・ビューティー・カルチャーを日本語で',
    desc: 'PAP MAGAZINE はソウルとミラノを拠点とするデジタルマガジンです。世界中のクリエイティブチームと制作するエディトリアル、'
      + 'ファッションウィーク、ブランドコレクション、セレブリティスタイル、ビューティートレンドを日本語でお届けします。',
    latest: '最新の記事',
    aboutH: 'PAP MAGAZINE について',
    aboutP: '2018年1月にイタリア・ミラノで創刊し、現在はソウルに本社を置くデジタルマガジンです。'
      + '自社スタジオでの撮影ではなく、世界中のクリエイティブチームからの投稿を軸にした編集モデルを採用し、'
      + '毎月20本以上のオリジナルエディトリアルを9言語で公開しています。',
    more: 'もっと見る',
  },
  en: {
    htmlLang: 'en',
    title: 'PAP MAGAZINE — Korean Fashion, Beauty & Culture Magazine',
    h1: 'PAP MAGAZINE',
    tagline: 'Korean fashion, beauty and culture, in English',
    desc: 'PAP MAGAZINE is a digital magazine based in Seoul and Milan. Editorials made with creative teams worldwide, '
      + 'plus fashion week, brand collections, celebrity style and beauty trends — reported in English.',
    latest: 'Latest stories',
    aboutH: 'About PAP MAGAZINE',
    aboutP: 'Founded in Milan in January 2018 and now headquartered in Seoul, PAP MAGAZINE runs a submission-based '
      + 'editorial model — work comes from creative teams around the world rather than a single in-house studio. '
      + 'More than 20 original editorials a month, published in nine languages.',
    more: 'See more',
  },
};

/* hreflang 은 한 세트를 공유한다. 한 곳에서만 고치도록 상수로 둔다. */
const ALTERNATES = [
  /* ko 는 index.html 의 <link rel="canonical"> 과 **글자까지 같아야 한다**
     (끝의 슬래시 유무 포함). 다르면 구글이 짝을 못 짓는다. */
  ['ko', SITE],
  ['ja', SITE + '/ja'],
  ['en', SITE + '/en'],
  ['x-default', SITE],
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function dateStr(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
}

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

/** 번역 제목 표. ja 만 사용한다 (en 은 원본 표에 title_en 이 있다). */
async function translatedTitles(kind, lang, ids) {
  if (lang === 'en' || !ids.length) return new Map();
  const { data } = await supabaseAdmin.from('seo_translations')
    .select('content_id, title')
    .eq('kind', kind).eq('lang', lang)
    .in('content_id', ids);
  const m = new Map();
  for (const r of (data || [])) if (r.title) m.set(r.content_id, r.title);
  return m;
}

async function fetchItems(lang) {
  const nowIso = new Date().toISOString();
  const [artRes, ediRes] = await Promise.all([
    supabaseAdmin.from('articles')
      .select('id, title, title_en, slug, custom_url, published_date, created_at, thumbnail_url, hero_image_url')
      .eq('status', 'published')
      .order('published_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(PER_KIND),
    supabaseAdmin.from('editorials')
      .select('id, title, title_en, slug, published_date, created_at, cover_image, og_image, thumbnail, scheduled_publish_at')
      .eq('status', 'published')
      .or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${nowIso}`)
      .order('published_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(PER_KIND),
  ]);
  const arts = artRes.data || [];
  const edis = ediRes.data || [];

  const [artT, ediT] = await Promise.all([
    translatedTitles('article', lang, arts.map(a => a.id)),
    translatedTitles('editorial', lang, edis.map(e => e.id)),
  ]);

  /* 번역 제목이 없으면 그 항목은 **싣지 않는다.** 한국어 제목이 섞인
     일본어 페이지는 언어 신호를 흐리고, 사용자에게도 읽히지 않는다. */
  const pick = (row, map, hrefBase, img) => {
    const t = (lang === 'en') ? row.title_en : map.get(row.id);
    if (!t) return null;
    return {
      title: t,
      href: '/' + lang + hrefBase + encodeURIComponent(row.slug || row.custom_url || row.id),
      date: dateStr(row.published_date),
      created: String(row.created_at || ''),
      img,
    };
  };

  const items = []
    .concat(arts.map(a => pick(a, artT, '/article/', a.thumbnail_url || a.hero_image_url || '')))
    .concat(edis.map(e => pick(e, ediT, '/editorial/', e.og_image || e.cover_image || e.thumbnail || '')))
    .filter(Boolean);

  /* published_date 는 DATE(시각 없음)이라 같은 날 항목의 순서가 불확정.
     created_at 을 2차 키로 쓴다 — listing.js 와 같은 규칙. */
  items.sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
    || String(b.created).localeCompare(String(a.created)));
  return items.slice(0, LIMIT);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const lang = String(req.query.lang || '');
  const cfg = LOCALES[lang];
  if (!cfg) return res.status(404).send('unknown locale');

  const canonical = SITE + '/' + lang;

  let items = [];
  try { items = await fetchItems(lang); } catch (e) {
    console.error('[seo/locale-home] fetch failed:', e);
    // DB 가 죽어도 메타·링크 프레임은 내보낸다 (크롤러에 500 대신 빈 목록)
  }

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: cfg.title,
    url: canonical,
    description: cfg.desc,
    inLanguage: cfg.htmlLang,
    isPartOf: { '@type': 'WebSite', name: 'PAP Magazine', url: SITE },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'PAP MAGAZINE', item: SITE },
        { '@type': 'ListItem', position: 2, name: cfg.h1 + ' (' + cfg.htmlLang + ')', item: canonical },
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
    thumbImg(it.img, it.title) +
    '<span class="t">' + esc(it.title) + '</span>' +
    (it.date ? '<time datetime="' + it.date + '">' + esc(fmtDisplayDate(it.date)) + '</time>' : '') +
    '</a>'
  ).join('\n');

  const alts = ALTERNATES.map(([code, href]) =>
    '<link rel="alternate" hreflang="' + code + '" href="' + esc(href) + '">').join('\n');

  const html = `<!DOCTYPE html>
<html lang="${esc(cfg.htmlLang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(cfg.title)}</title>
<meta name="description" content="${esc(cfg.desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
${alts}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(cfg.title)}">
<meta property="og:description" content="${esc(cfg.desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="PAP Magazine">
<meta property="og:locale" content="${esc(cfg.htmlLang)}">
${items[0] && items[0].img ? `<meta property="og:image" content="${esc(items[0].img)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@papmagazine_">
<link rel="alternate" type="application/rss+xml" title="PAP MAGAZINE — Latest" href="${SITE}/rss.xml">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Hiragino Sans','Apple SD Gothic Neo',sans-serif;background:#000;color:#fff;line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1200px;margin:0 auto;padding:72px 20px}
  h1{font-size:34px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px}
  .tag{font-size:14px;color:rgba(255,255,255,.6);margin-bottom:14px}
  .sub{font-size:13px;color:rgba(255,255,255,.5);max-width:760px;margin-bottom:36px}
  h2{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin:0 0 18px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
  @media(min-width:700px){.grid{grid-template-columns:repeat(4,1fr);gap:24px}}
  .card{display:block;color:inherit;text-decoration:none}
  .card img{display:block;width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;background:#111}
  .card .t{display:block;margin-top:10px;font-size:13.5px;font-weight:600;line-height:1.45}
  .card time{display:block;margin-top:4px;font-size:11px;color:rgba(255,255,255,.35)}
  .about{margin-top:64px;max-width:760px}
  .about p{font-size:13.5px;color:rgba(255,255,255,.7)}
  .langs{margin-top:40px;font-size:12px;letter-spacing:.08em}
  .langs a{color:rgba(255,255,255,.6);text-decoration:none;margin-right:14px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:rgba(255,255,255,.4)}
  footer a{color:rgba(255,255,255,.6);text-decoration:none;margin-right:12px}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(cfg.h1)}</h1>
  <p class="tag">${esc(cfg.tagline)}</p>
  <p class="sub">${esc(cfg.desc)}</p>

  <h2>${esc(cfg.latest)}</h2>
  <div class="grid">
${cards}
  </div>

  <section class="about">
    <h2>${esc(cfg.aboutH)}</h2>
    <p>${esc(cfg.aboutP)}</p>
  </section>

  <p class="langs">
    <a href="/" hreflang="ko">한국어</a>
    <a href="/ja" hreflang="ja">日本語</a>
    <a href="/en" hreflang="en">English</a>
  </p>

  <footer>
    <a href="/">PAP MAGAZINE</a><a href="/archive">Archive</a><a href="/magazine">Magazine</a><a href="/articles">Articles</a><a href="/films">Films</a><a href="/subscribe">Subscribe</a><a href="/rss.xml">RSS</a>
    <a href="/api/ig-out?src=locale_home&amp;to=profile&amp;url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" rel="noopener">Instagram @pap_magazine &rarr;</a>
  </footer>
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
  return res.status(200).send(html);
};
