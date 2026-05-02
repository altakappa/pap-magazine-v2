/**
 * PAP Magazine — Server-Side Rendered Editorial Page (SEO)
 *
 * Why this exists:
 *   The SPA serves editorials at `/#editorial/<slug>`, but the `#` makes
 *   the route invisible to search engines. This endpoint returns a full
 *   crawlable HTML page for the same content at `/editorial/:slug`, with
 *   per-article meta tags, Open Graph, Twitter Card, hreflang, and
 *   schema.org Article structured data.
 *
 *   Once the page hydrates, pap-app.js takes over and the overlay opens
 *   so the user gets the normal SPA experience — but Google indexes the
 *   server-rendered HTML.
 *
 * Route: /editorial/:slug   (rewritten from this in vercel.json)
 *
 * Returns:
 *   200 + full HTML  → editorial found and published
 *   404 + error HTML → slug missing or unpublished
 *   500 + error HTML → DB error (logged)
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const SITE_NAME = 'PAP Magazine';
const DEFAULT_OG_IMAGE = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/c_1_7c42a14014.jpg';
const ORG_LOGO = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_LOGO.png';

/* ── Utilities ──────────────────────────────────────── */

function escAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escJson(obj) {
  /* JSON inside <script> needs </script> sequences neutralized */
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function fmtIsoDate(d) {
  if (!d) return new Date().toISOString();
  try { return new Date(d).toISOString(); }
  catch { return new Date().toISOString(); }
}

/* Trim and ellipsize for meta descriptions (search engines truncate ~155ch) */
function truncate(s, n) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

/* Pull a list of credits/contributors out of the credits JSON for schema */
function extractContributors(ed) {
  const names = new Set();
  const c = ed.credits;
  if (!c) return [];
  try {
    const obj = typeof c === 'string' ? JSON.parse(c) : c;
    Object.values(obj || {}).forEach(v => {
      if (Array.isArray(v)) v.forEach(x => x && names.add(String(x)));
      else if (typeof v === 'string') names.add(v);
    });
  } catch { /* credits may be free text */ }
  return Array.from(names).slice(0, 20);
}

/* ── HTML Template ──────────────────────────────────── */

function renderEditorialHtml(ed) {
  const slug = ed.slug || ed.id;
  const titleKo = ed.title || SITE_NAME;
  const titleEn = ed.title_en || titleKo;
  const seoTitle = ed.seo_title || `${titleKo} | ${SITE_NAME}`;
  const descKo = ed.seo_description || ed.description || `${titleKo} — PAP Magazine 에디토리얼`;
  const descEn = ed.description_en || descKo;
  const desc = truncate(descKo, 155);
  const ogImage = ed.og_image || ed.cover_image || ed.thumbnail || DEFAULT_OG_IMAGE;
  const canonical = `${SITE}/editorial/${encodeURIComponent(slug)}`;
  const published = fmtIsoDate(ed.published_date);
  const tags = Array.isArray(ed.tags) ? ed.tags : (ed.tags ? String(ed.tags).split(',').map(s => s.trim()).filter(Boolean) : []);
  const contributors = extractContributors(ed);

  /* Schema.org Article — gives Google rich-result eligibility */
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: titleKo,
    alternativeHeadline: titleEn,
    description: descKo,
    image: [ogImage].filter(Boolean),
    datePublished: published,
    dateModified: fmtIsoDate(ed.updated_at || ed.published_date),
    author: contributors.length
      ? contributors.map(name => ({ '@type': 'Person', name }))
      : [{ '@type': 'Organization', name: SITE_NAME, url: SITE }],
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: ORG_LOGO }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    keywords: tags.length ? tags.join(', ') : undefined,
    articleSection: ed.issue || 'Editorial',
    inLanguage: 'ko-KR'
  };

  /* Breadcrumb — second rich-result type Google likes */
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Magazine', item: `${SITE}/magazine.html` },
      { '@type': 'ListItem', position: 3, name: titleKo, item: canonical }
    ]
  };

  /* Tag list as renderable HTML for crawlers (and humans without JS) */
  const tagHtml = tags.length
    ? '<ul class="seo-tags">' + tags.map(t => `<li>#${escText(t)}</li>`).join('') + '</ul>'
    : '';

  /* Credits block (visible HTML for crawlers) */
  const creditsHtml = contributors.length
    ? '<section class="seo-credits"><h2>Credits</h2><ul>' +
        contributors.map(n => `<li>${escText(n)}</li>`).join('') +
      '</ul></section>'
    : '';

  /* Cover image — wrapped in <noscript> too so it always renders */
  const heroImg = ogImage
    ? `<img src="${escAttr(ogImage)}" alt="${escAttr(titleKo)}" loading="eager" fetchpriority="high" width="1200" height="800">`
    : '';

  return `<!DOCTYPE html>
<html lang="ko" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escText(seoTitle)}</title>
<meta name="description" content="${escAttr(desc)}">
${tags.length ? `<meta name="keywords" content="${escAttr(tags.join(', '))}">` : ''}
<meta name="author" content="${escAttr(SITE_NAME)} - ALTAKAPPA Co., Ltd.">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="googlebot" content="index, follow, max-image-preview:large, max-snippet:-1">

<link rel="canonical" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="x-default" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="ko" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="en" href="${escAttr(canonical)}">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(seoTitle)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:site_name" content="${escAttr(SITE_NAME)}">
<meta property="og:image" content="${escAttr(ogImage)}">
<meta property="og:image:alt" content="${escAttr(titleKo)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:locale:alternate" content="en_US">
<meta property="article:published_time" content="${escAttr(published)}">
<meta property="article:modified_time" content="${escAttr(fmtIsoDate(ed.updated_at || ed.published_date))}">
${ed.issue ? `<meta property="article:section" content="${escAttr(ed.issue)}">` : ''}
${tags.map(t => `<meta property="article:tag" content="${escAttr(t)}">`).join('\n')}

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(seoTitle)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${escAttr(ogImage)}">

<!-- Schema.org structured data -->
<script type="application/ld+json">${escJson(articleSchema)}</script>
<script type="application/ld+json">${escJson(breadcrumbSchema)}</script>

<!-- PWA / Favicon -->
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#000000">

<!-- Performance hints -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/pap-styles.css?v=15">
<link rel="stylesheet" href="/pap-social.css">

<style>
  /* Minimal SEO-only styles — full app styles take over after hydration */
  .seo-only{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  body.seo-loading{background:#000;color:#fff;font-family:Inter,-apple-system,sans-serif}
  body.seo-loading .seo-hero{display:block;width:100%;max-width:1200px;margin:0 auto}
  body.seo-loading .seo-hero img{display:block;width:100%;height:auto}
  body.seo-loading .seo-meta{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.6}
  body.seo-loading .seo-meta h1{font-family:'Playfair Display',serif;font-size:clamp(28px,5vw,56px);margin:0 0 12px}
  body.seo-loading .seo-meta .alt{opacity:.65;font-style:italic;margin:0 0 24px}
  body.seo-loading .seo-meta time{opacity:.55;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
  body.seo-loading .seo-tags{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:24px 0}
  body.seo-loading .seo-tags li{padding:4px 10px;border:1px solid rgba(255,255,255,.2);font-size:12px}
  body.seo-loading .seo-credits{max-width:800px;margin:48px auto;padding:0 24px}
  body.seo-loading .seo-credits h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7}
  body.seo-loading .seo-credits ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:16px}
  body.seo-loading .seo-credits li{font-size:13px;opacity:.8}
</style>
</head>
<body class="seo-loading">

<!-- Crawler-visible content. Hidden once SPA hydrates. -->
<main class="seo-content">
  <article>
    <div class="seo-hero">${heroImg}</div>
    <div class="seo-meta">
      <h1>${escText(titleKo)}</h1>
      ${titleEn !== titleKo ? `<p class="alt">${escText(titleEn)}</p>` : ''}
      <time datetime="${escAttr(published)}">${escText(published.slice(0, 10))}${ed.issue ? ' · ' + escText(ed.issue) : ''}</time>
      <p>${escText(desc)}</p>
      ${descEn && descEn !== descKo ? `<p>${escText(truncate(descEn, 280))}</p>` : ''}
      ${tagHtml}
    </div>
    ${creditsHtml}
  </article>
</main>

<nav class="seo-back" aria-label="Site navigation">
  <a href="${SITE}/">← ${escText(SITE_NAME)}</a> ·
  <a href="${SITE}/magazine.html">All Editorials</a> ·
  <a href="${SITE}/articles.html">Articles</a> ·
  <a href="${SITE}/films.html">Films</a>
</nav>
<style>
  body.seo-loading .seo-back{max-width:800px;margin:48px auto 80px;padding:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
  body.seo-loading .seo-back a{color:#fff;text-decoration:none;margin-right:8px}
  body.seo-loading .seo-back a:hover{opacity:.7}
</style>

<!-- Hint for the SPA bundle if it later runs (e.g. user clicks an internal
     anchor that triggers SPA hydration). Bots and JS-disabled users get
     the static content above; that's the SEO surface area. -->
<script>
  window._papServerRendered = true;
  window._papInitialEditorialSlug = ${JSON.stringify(slug)};
</script>

<!-- Cookie consent + GA4 + Meta Pixel/CAPI (consent-gated) — same instrumentation
     the SPA uses, so analytics & ad-tracking work on direct landings too. -->
<script src="/pap-geo-lang.js"></script>
<script src="/cookie-consent.js" defer></script>

</body>
</html>`;
}

/* ── 404 page (still SEO-clean) ─────────────────────── */

function render404Html(slug) {
  const canonical = `${SITE}/editorial/${encodeURIComponent(slug || '')}`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Editorial Not Found | PAP Magazine</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${SITE}/magazine.html">
<style>body{background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#fff}</style>
</head>
<body>
<main>
  <h1>404 — Editorial not found</h1>
  <p>The editorial you're looking for may have been removed or renamed.</p>
  <p><a href="${SITE}/magazine.html">Browse all editorials →</a></p>
</main>
</body>
</html>`;
}

/* ── Handler ────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).end();
  }

  const { slug } = req.query;
  if (!slug || typeof slug !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(render404Html(''));
  }

  try {
    /* Look up by slug; fall back to id for legacy links */
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('editorials')
      .select('*')
      .or(`slug.eq.${slug},id.eq.${slug}`)
      .eq('status', 'published')
      .or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${nowIso}`)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(404).send(render404Html(slug));
    }

    /* Cache for 5min at the CDN, allow stale-while-revalidate for 1 day. */
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
    return res.status(200).send(renderEditorialHtml(data));

  } catch (err) {
    console.error('[seo/editorial] error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(render404Html(slug));
  }
};
