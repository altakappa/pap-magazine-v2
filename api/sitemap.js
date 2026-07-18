/**
 * PAP Magazine - Dynamic sitemap.xml
 *
 * Generates a sitemap.xml that includes:
 *   - All main static pages (home / magazine / articles / films / etc.)
 *   - Every published editorial as `/#editorial/<title>` deep-link
 *
 * Served at /sitemap.xml via vercel.json rewrite. Cached at the CDN
 * for 1 hour so we don't hammer the database on every crawler hit.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const BASE = 'https://www.pap-magazine.com';

// Static pages with their priorities and change frequencies. Tuned for a
// magazine — home and listing pages refresh weekly, legal/about monthly.
// 구조 최적화 (2026-07) — QA #325 의 "순차 전환 예정"을 완결. 전 페이지
// 클린 URL 통일: 내부 링크·canonical·사이트맵 모두 클린 경로만 사용하고
// .html 은 vercel.json 301 로 수렴한다 (auth.html 만 리다이렉트 제외 —
// Supabase 복구 메일 해시 보존 이슈).
const STATIC_PAGES = [
  { path: '/',            priority: '1.0', changefreq: 'daily'   },
  { path: '/magazine',    priority: '0.9', changefreq: 'weekly'  },
  { path: '/articles',    priority: '0.9', changefreq: 'weekly'  },
  { path: '/films',       priority: '0.8', changefreq: 'weekly'  },
  { path: '/community',   priority: '0.8', changefreq: 'weekly'  },
  { path: '/subscribe',   priority: '0.9', changefreq: 'monthly' },
  { path: '/pullletter',  priority: '0.7', changefreq: 'monthly' },
  { path: '/archive',     priority: '0.8', changefreq: 'daily'   },
  { path: '/partners',    priority: '0.7', changefreq: 'weekly'  },
  { path: '/network',     priority: '0.7', changefreq: 'monthly' },
  { path: '/about',       priority: '0.7', changefreq: 'monthly' },
  { path: '/business',    priority: '0.6', changefreq: 'monthly' },
  { path: '/contact',     priority: '0.6', changefreq: 'monthly' },
  { path: '/submission',  priority: '0.7', changefreq: 'monthly' },
  { path: '/terms',       priority: '0.3', changefreq: 'yearly'  },
  { path: '/privacy',     priority: '0.3', changefreq: 'yearly'  },
  { path: '/refund',      priority: '0.3', changefreq: 'yearly'  },
];

// XML-escape special characters in URLs (mostly ampersands and Unicode)
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  try { return new Date(d).toISOString().slice(0, 10); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

function safeSitemapHandle(h) {
  // SEO 2026-07 — only advertise URL-clean handles. Malformed slugs (spaces,
  // control chars, %, apostrophes, ligatures, etc.) emit %20-encoded duplicate
  // URLs Google flags as "duplicate / page with redirect". Skip them; the page
  // stays reachable, it just isn't advertised until the slug is cleaned in DB.
  if (h == null) return null;
  const s = String(h);
  return /^[A-Za-z0-9._~-]+$/.test(s) ? s : null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    // Pull every published editorial. Cap at 5000 to keep XML size sane —
    // sitemaps over 50MB / 50k URLs need to be split, and we're nowhere
    // near that. Adjust if PAP ever crosses that threshold.
    const { data: eds, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, slug, published_date, updated_at, cover_image, og_image, thumbnail')
      .eq('status', 'published')
      .or('scheduled_publish_at.is.null,scheduled_publish_at.lte.' + new Date().toISOString())
      .order('published_date', { ascending: false })
      .limit(5000);

    if (error) throw error;

    const urls = [];

    // Static pages
    const today = fmtDate(new Date());
    STATIC_PAGES.forEach(p => {
      urls.push(
        '  <url>\n' +
        '    <loc>' + BASE + p.path + '</loc>\n' +
        '    <lastmod>' + today + '</lastmod>\n' +
        '    <changefreq>' + p.changefreq + '</changefreq>\n' +
        '    <priority>' + p.priority + '</priority>\n' +
        '  </url>'
      );
    });

    // Editorial pages — server-rendered at /editorial/:slug for SEO.
    // Using slug (stable, URL-safe) instead of title (changes, needs encoding).
    // Falls back to id when slug is missing on legacy rows.
    // Includes <image:image> child so Google Images can index the cover.
    (eds || []).forEach(ed => {
      const handle = safeSitemapHandle(ed.slug || ed.id);
      if (!handle) return;
      const loc = BASE + '/editorial/' + encodeURIComponent(handle);
      const lastmod = fmtDate(ed.updated_at || ed.published_date);
      const img = ed.og_image || ed.cover_image || ed.thumbnail;
      const imgBlock = img
        ? '    <image:image>\n' +
          '      <image:loc>' + xmlEscape(img) + '</image:loc>\n' +
          '      <image:title>' + xmlEscape(ed.title || '') + '</image:title>\n' +
          '    </image:image>\n'
        : '';
      urls.push(
        '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.8</priority>\n' +
        imgBlock +
        '  </url>'
      );
    });

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
      urls.join('\n') + '\n' +
      '</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Cache for 1 hour at the CDN, allow 24h stale-while-revalidate so
    // a cold cache doesn't block crawlers waiting for a fresh build.
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (err) {
    console.error('Sitemap generation error:', err);
    // Fallback: serve just the static pages if DB lookup fails so we
    // never return a 500 to a crawler.
    const today = fmtDate(new Date());
    const fallback =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      STATIC_PAGES.map(p =>
        '  <url><loc>' + BASE + p.path + '</loc><lastmod>' + today +
        '</lastmod><changefreq>' + p.changefreq + '</changefreq>' +
        '<priority>' + p.priority + '</priority></url>'
      ).join('\n') + '\n' +
      '</urlset>\n';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(fallback);
  }
};
