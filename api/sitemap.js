/**
 * PAP Magazine - Dynamic sitemap.xml
 *
 * Generates a sitemap.xml that includes ONLY the main static pages
 * (home / magazine / articles / films / about / legal ...).
 *
 * 2026-08-04 — 에디토리얼 2,293건을 여기서 빼냈다. 같은 URL 이
 * /sitemap-editorials.xml 에 이미 전량 들어 있어서 두 파일이 통째로
 * 중복됐고(색인 리포트 수치 왜곡 + 매 요청마다 불필요한 DB 전량 조회),
 * 이제 역할을 나눈다: sitemap.xml = 정적 페이지, sitemap-editorials*.xml =
 * 에디토리얼. 둘 다 /sitemap-index.xml 과 robots.txt 에 등재돼 있다.
 *
 * Served at /sitemap.xml via vercel.json rewrite. Cached at the CDN
 * for 1 hour so we don't hammer the database on every crawler hit.
 */

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
  // 2026-07-29: pap-studios.com 을 접고 /studio 로 일원화하면서 등재.
  // 그동안 사이트맵에도 내부 링크에도 없어 색인 경로가 아예 없었다.
  { path: '/studio',      priority: '0.7', changefreq: 'monthly' },
  // 2026-08-17: /digital-magazine — 카테고리 정의 페이지(GEO 핵심)가 사이트맵에도
  // 내부 링크(about 1곳)에도 거의 없어 /studio 때와 같은 '색인 경로 없음' 상태였다.
  { path: '/digital-magazine', priority: '0.7', changefreq: 'monthly' },
  { path: '/contact',     priority: '0.6', changefreq: 'monthly' },
  { path: '/submission',  priority: '0.7', changefreq: 'monthly' },
  { path: '/terms',       priority: '0.3', changefreq: 'yearly'  },
  { path: '/privacy',     priority: '0.3', changefreq: 'yearly'  },
  { path: '/refund',      priority: '0.3', changefreq: 'yearly'  },
];

function fmtDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  try { return new Date(d).toISOString().slice(0, 10); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  try {
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
