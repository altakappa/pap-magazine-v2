/**
 * PAP Magazine — Shared SEO Page Renderer
 *
 * One reusable HTML/schema builder for every server-rendered content type
 * (editorial, article, film, short). Keeping the template here avoids
 * 4×500-line duplicates and makes meta-tag/schema improvements one-edit.
 *
 * Each content endpoint passes a `kind` plus a normalized record and gets
 * back a full <!doctype html> string ready to send.
 */

const SITE = 'https://www.pap-magazine.com';
const SITE_NAME = 'PAP Magazine';
const DEFAULT_OG_IMAGE = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/c_1_7c42a14014.jpg';
const ORG_LOGO = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_LOGO.png';

/* ── escape helpers ─────────────────────────────────── */
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escJson(obj) {
  return JSON.stringify(obj, (k, v) => v === undefined ? undefined : v).replace(/</g, '\\u003c');
}
function fmtIsoDate(d) {
  if (!d) return new Date().toISOString();
  try { return new Date(d).toISOString(); } catch { return new Date().toISOString(); }
}
function truncate(s, n) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed; } catch {}
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function extractContributors(record) {
  const names = new Set();
  let c = record.credits;
  if (!c) return [];
  try {
    const obj = typeof c === 'string' ? JSON.parse(c) : c;
    if (Array.isArray(obj)) {
      obj.forEach(entry => {
        if (entry && typeof entry === 'object' && entry.name) names.add(String(entry.name));
        else if (typeof entry === 'string') names.add(entry);
      });
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(v => {
        if (Array.isArray(v)) v.forEach(x => x && names.add(String(x.name || x)));
        else if (typeof v === 'string') names.add(v);
      });
    }
  } catch { /* free-form text — ignore */ }
  return Array.from(names).slice(0, 30);
}

/* ── per-kind config: route prefix, breadcrumb labels, default schema ── */
const KIND = {
  editorial: {
    pathPrefix: '/editorial/',
    breadcrumb: { name: 'Magazine', url: SITE + '/magazine.html' },
    schemaType: 'Article',
    sectionFallback: 'Editorial'
  },
  article: {
    pathPrefix: '/article/',
    breadcrumb: { name: 'Articles', url: SITE + '/articles.html' },
    schemaType: 'NewsArticle',
    sectionFallback: 'Article'
  },
  film: {
    pathPrefix: '/film/',
    breadcrumb: { name: 'Films', url: SITE + '/films.html' },
    schemaType: 'VideoObject',
    sectionFallback: 'Film'
  },
  short: {
    pathPrefix: '/short/',
    breadcrumb: { name: 'Films', url: SITE + '/films.html' },
    schemaType: 'VideoObject',
    sectionFallback: 'Short'
  }
};

/* ── main render function ───────────────────────────── */
function renderSeoHtml(kind, record) {
  const cfg = KIND[kind] || KIND.editorial;
  const slug = record.slug || record.custom_url || record.id;

  const titleKo = record.title || SITE_NAME;
  const titleEn = record.title_en || titleKo;
  const seoTitle = record.seo_title || `${titleKo} | ${SITE_NAME}`;
  const descKo = record.seo_description || record.description || record.subtitle || `${titleKo} — ${SITE_NAME}`;
  const descEn = record.description_en || descKo;
  const desc = truncate(descKo, 160);

  /* Cover image: per-kind preferred fields */
  const ogImage = record.og_image
    || record.cover_image
    || record.hero_image_url
    || record.thumbnail_url
    || record.thumbnail
    || (record.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id)
        ? `https://img.youtube.com/vi/${record.youtube_id}/maxresdefault.jpg`
        : null)
    || DEFAULT_OG_IMAGE;

  const canonical = `${SITE}${cfg.pathPrefix}${encodeURIComponent(slug)}`;
  const published = fmtIsoDate(record.published_date);
  const modified = fmtIsoDate(record.updated_at || record.published_date);

  const tags = asArray(record.tags);
  const contributors = extractContributors(record);

  /* Gallery for editorials/articles */
  const gallery = asArray(record.gallery).filter(u => typeof u === 'string').slice(0, 60);
  const allImages = [ogImage, ...gallery].filter(Boolean);

  /* Build the primary schema (Article / NewsArticle / VideoObject).
   * Only emit VideoObject when the stored id is in the canonical 11-char
   * shape — anything else would produce a broken contentUrl/embedUrl that
   * Google rejects from the rich-result. */
  let primarySchema;
  if (cfg.schemaType === 'VideoObject' && record.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id)) {
    primarySchema = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: titleKo,
      description: descKo,
      thumbnailUrl: [ogImage].filter(Boolean),
      uploadDate: published,
      contentUrl: `https://www.youtube.com/watch?v=${record.youtube_id}`,
      embedUrl: `https://www.youtube.com/embed/${record.youtube_id}`,
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        logo: { '@type': 'ImageObject', url: ORG_LOGO }
      },
      keywords: tags.length ? tags.join(', ') : undefined,
      inLanguage: 'ko-KR'
    };
  } else {
    primarySchema = {
      '@context': 'https://schema.org',
      '@type': cfg.schemaType,
      headline: titleKo,
      alternativeHeadline: titleEn,
      description: descKo,
      image: allImages,
      datePublished: published,
      dateModified: modified,
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
      articleSection: record.issue || record.category || cfg.sectionFallback,
      inLanguage: 'ko-KR'
    };
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: cfg.breadcrumb.name, item: cfg.breadcrumb.url },
      { '@type': 'ListItem', position: 3, name: titleKo, item: canonical }
    ]
  };

  /* HTML pieces */
  const tagHtml = tags.length
    ? '<ul class="seo-tags">' + tags.map(t => `<li>#${escText(t)}</li>`).join('') + '</ul>'
    : '';

  const creditsHtml = contributors.length
    ? '<section class="seo-credits"><h2>Credits</h2><ul>' +
        contributors.map(n => `<li>${escText(n)}</li>`).join('') +
      '</ul></section>'
    : '';

  /* QA #162 — Related Editorial card (films only). The /api/films join
   * embeds editorials!related_editorial_id under record.related_editorial,
   * so when a film has one we render a link card to /editorial/<slug>.
   * Hidden when absent so editorials / articles (which don't carry the
   * field) get no empty section. */
  const rel = record.related_editorial && typeof record.related_editorial === 'object'
    ? record.related_editorial : null;
  const relatedEditorialHtml = (cfg.schemaType === 'VideoObject' && rel && rel.title)
    ? `<section class="seo-related"><h2>Related Editorial</h2>
        <a class="seo-related-card" href="/editorial/${escAttr(rel.slug || rel.id || '')}">
          ${rel.cover_image || rel.thumbnail ? `<img src="${escAttr(rel.cover_image || rel.thumbnail)}" alt="${escAttr(rel.title)} — Cover" loading="lazy" width="240" height="160">` : ''}
          <div class="seo-related-meta">
            <div class="seo-related-tagline">RELATED EDITORIAL</div>
            <div class="seo-related-title">${escText(rel.title)}</div>
          </div>
        </a></section>`
    : '';

  /* Hero — image for editorial/article, YouTube embed for film/short.
   *
   * youtube_id has to match the canonical 11-char id shape before we
   * concatenate it into the embed URL. Without this guard, a legacy row
   * whose youtube_id is a full URL ("https://www.youtube.com/<id>")
   * produces an iframe src like
   *   https://www.youtube-nocookie.com/embed/https://www.youtube.com/<id>
   * which YouTube serves as a blank page (QA #160 — "Selects" film).
   * The new admin form (saveFilm + savePost) refuses to insert non-id-
   * shaped values, but historical rows still need this defence. */
  const isValidYtId = typeof record.youtube_id === 'string'
    && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id);
  const heroHtml = (cfg.schemaType === 'VideoObject' && isValidYtId)
    ? `<div class="seo-video"><iframe src="https://www.youtube-nocookie.com/embed/${escAttr(record.youtube_id)}?rel=0" title="${escAttr(titleKo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : ogImage
      ? `<div class="seo-hero"><img src="${escAttr(ogImage)}" alt="${escAttr(titleKo)} — Cover" loading="eager" fetchpriority="high" width="1200" height="800"></div>`
      : '';

  const galleryHtml = gallery.length
    ? '<section class="seo-gallery" aria-label="Gallery">' +
        gallery.map((src, i) =>
          `<figure><img src="${escAttr(src)}" alt="${escAttr(titleKo)} — Look ${i + 1}" loading="lazy" decoding="async"></figure>`
        ).join('') +
      '</section>'
    : '';

  /* Content body for articles (rich text from `content` field) */
  const bodyHtml = record.content
    ? `<div class="seo-body">${typeof record.content === 'string'
        ? record.content
        : escText(JSON.stringify(record.content))}</div>`
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
<meta name="googlebot" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">

<link rel="canonical" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="x-default" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="ko" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="en" href="${escAttr(canonical)}">

<meta property="og:type" content="${cfg.schemaType === 'VideoObject' ? 'video.other' : 'article'}">
<meta property="og:title" content="${escAttr(seoTitle)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:site_name" content="${escAttr(SITE_NAME)}">
<meta property="og:image" content="${escAttr(ogImage)}">
<meta property="og:image:alt" content="${escAttr(titleKo)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:locale:alternate" content="en_US">
<meta property="article:published_time" content="${escAttr(published)}">
<meta property="article:modified_time" content="${escAttr(modified)}">
${tags.map(t => `<meta property="article:tag" content="${escAttr(t)}">`).join('\n')}

<meta name="twitter:card" content="${cfg.schemaType === 'VideoObject' ? 'player' : 'summary_large_image'}">
<meta name="twitter:title" content="${escAttr(seoTitle)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${escAttr(ogImage)}">

<script type="application/ld+json">${escJson(primarySchema)}</script>
<script type="application/ld+json">${escJson(breadcrumbSchema)}</script>

<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#000000">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/pap-styles.css?v=15">

<style>
  body.seo-loading{background:#000;color:#fff;font-family:Inter,-apple-system,sans-serif;margin:0;padding:0}
  .seo-hero,.seo-video{display:block;width:100%;max-width:1200px;margin:0 auto}
  .seo-hero img{display:block;width:100%;height:auto}
  .seo-video{aspect-ratio:16/9;background:#111}
  .seo-video iframe{width:100%;height:100%;display:block;border:0}
  .seo-meta{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.6}
  .seo-meta h1{font-family:'Playfair Display',serif;font-size:clamp(28px,5vw,56px);margin:0 0 12px}
  .seo-meta .alt{opacity:.65;font-style:italic;margin:0 0 24px}
  .seo-meta time{opacity:.55;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
  .seo-tags{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:24px 0}
  .seo-tags li{padding:4px 10px;border:1px solid rgba(255,255,255,.2);font-size:12px}
  .seo-credits{max-width:800px;margin:48px auto;padding:0 24px}
  .seo-credits h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7}
  .seo-credits ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:16px}
  .seo-credits li{font-size:13px;opacity:.8}
  /* Related editorial card (films only) — QA #162 */
  .seo-related{max-width:800px;margin:36px auto;padding:0 24px}
  .seo-related h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:14px}
  .seo-related-card{display:flex;align-items:center;gap:16px;padding:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02);text-decoration:none;color:inherit;transition:background .2s}
  .seo-related-card:hover{background:rgba(255,255,255,.05)}
  .seo-related-card img{width:120px;height:80px;object-fit:cover;background:#222;flex-shrink:0}
  .seo-related-meta{flex:1;min-width:0}
  .seo-related-tagline{font-size:9px;font-weight:700;letter-spacing:.2em;color:rgba(201,169,110,.9);text-transform:uppercase;margin-bottom:6px}
  .seo-related-title{font-size:15px;font-weight:600;letter-spacing:.02em;line-height:1.4}
  .seo-gallery{max-width:1200px;margin:48px auto;padding:0 16px;display:grid;grid-template-columns:1fr;gap:24px}
  .seo-gallery figure{margin:0}
  .seo-gallery img{display:block;width:100%;height:auto;background:#111}
  @media(min-width:900px){.seo-gallery{grid-template-columns:1fr 1fr;gap:32px}}
  .seo-body{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.7;font-size:16px}
  .seo-body p{margin:0 0 1.2em}
  .seo-body img{max-width:100%;height:auto;display:block;margin:24px auto}
  .seo-back{max-width:800px;margin:48px auto 80px;padding:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
  .seo-back a{color:#fff;text-decoration:none;margin-right:8px}
  .seo-back a:hover{opacity:.7}
</style>
</head>
<body class="seo-loading">
<main class="seo-content">
  <article>
    ${heroHtml}
    <div class="seo-meta">
      <h1>${escText(titleKo)}</h1>
      ${titleEn !== titleKo ? `<p class="alt">${escText(titleEn)}</p>` : ''}
      <time datetime="${escAttr(published)}">${escText(published.slice(0, 10))}${record.issue ? ' · ' + escText(record.issue) : record.category ? ' · ' + escText(record.category) : ''}</time>
      <p>${escText(descKo)}</p>
      ${descEn && descEn !== descKo ? `<p>${escText(descEn)}</p>` : ''}
      ${tagHtml}
    </div>
    ${bodyHtml}
    ${galleryHtml}
    ${creditsHtml}
    ${relatedEditorialHtml}
  </article>
</main>

<nav class="seo-back" aria-label="Site navigation">
  <a href="${SITE}/">← ${escText(SITE_NAME)}</a> ·
  <a href="${SITE}/magazine.html">Magazine</a> ·
  <a href="${SITE}/articles.html">Articles</a> ·
  <a href="${SITE}/films.html">Films</a>
</nav>

<script>
  window._papServerRendered = true;
  window._papInitialContent = ${JSON.stringify({ kind, slug })};
</script>
<script src="/pap-geo-lang.js"></script>
<script src="/cookie-consent.js" defer></script>
</body>
</html>`;
}

/* ── 404 page ───────────────────────────────────────── */
function renderNotFoundHtml(kind, slug) {
  const cfg = KIND[kind] || KIND.editorial;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Not Found | PAP Magazine</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${cfg.breadcrumb.url}">
<style>body{background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#fff}</style>
</head><body>
<main>
  <h1>404 — Not Found</h1>
  <p>The ${kind} you're looking for may have been removed or renamed.</p>
  <p><a href="${cfg.breadcrumb.url}">Browse ${cfg.breadcrumb.name} →</a></p>
</main></body></html>`;
}

module.exports = { renderSeoHtml, renderNotFoundHtml, KIND, SITE, SITE_NAME };
