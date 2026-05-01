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
const STATIC_PAGES = [
  { path: '/',                priority: '1.0', changefreq: 'daily'   },
  { path: '/magazine.html',   priority: '0.9', changefreq: 'weekly'  },
  { path: '/articles.html',   priority: '0.9', changefreq: 'weekly'  },
  { path: '/films.html',      priority: '0.8', changefreq: 'weekly'  },
  { path: '/community.html',  priority: '0.8', changefreq: 'weekly'  },
  { path: '/subscribe.html',  priority: '0.9', changefreq: 'monthly' },
  { path: '/pullletter.html', priority: '0.7', changefreq: 'monthly' },
  { path: '/about.html',      priority: '0.7', changefreq: 'monthly' },
  { path: '/business.html',   priority: '0.6', changefreq: 'monthly' },
  { path: '/contact.html',    priority: '0.6', changefreq: 'monthly' },
  { path: '/submission.html', priority: '0.7', changefreq: 'monthly' },
  { path: '/terms.html',      priority: '0.3', changefreq: 'yearly'  },
  { path: '/privacy.html',    priority: '0.3', changefreq: 'yearly'  },
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

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
    // Pull every published editorial. Cap at 5000 to keep XML size sane —
    // sitemaps over 50MB / 50k URLs need to be split, and we're nowhere
    // near that. Adjust if PAP ever crosses that threshold.
    const { data: eds, error } = await supabaseAdmin
      .from('editorials')
      .select('title, slug, published_date, updated_at')
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

    // Editorial deep-links — uses the same hash format the SPA reads
    // (#editorial/<Title>). encodeURIComponent so titles with spaces /
    // unicode are valid URLs in the sitemap.
    (eds || []).forEach(ed => {
      const title = ed.title || '';
      if (!title) return;
      const loc = BASE + '/#editorial/' + encodeURIComponent(title);
      const lastmod = fmtDate(ed.updated_at || ed.published_date);
      urls.push(
        '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.8</priority>\n' +
        '  </url>'
      );
    });

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
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
