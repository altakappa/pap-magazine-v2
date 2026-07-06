/**
 * GET /article/:slug (host: pepperitmag.com) · /pepperit/article/:slug (모든 호스트)
 * 페퍼릿 기사 SSR — 핑크 브랜딩, NewsArticle JSON-LD, IG 임베드 + 팔로우/반응 CTA.
 * canonical 은 항상 https://www.pepperitmag.com/article/<slug> (브랜드 도메인).
 */

const { supabaseAdmin } = require('../../_lib/supabase');

const SITE = 'https://www.pepperitmag.com';
const IG = 'https://www.instagram.com/pepperitmag/';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

module.exports = async function handler(req, res) {
  try {
    const slug = req.query && req.query.slug;
    if (!slug) return res.status(400).send('slug required');

    let { data: a } = await supabaseAdmin.from('pepperit_articles')
      .select('*').eq('slug', String(slug)).eq('status', 'published').maybeSingle();
    if (!a) {
      const r2 = await supabaseAdmin.from('pepperit_articles')
        .select('*').eq('id', String(slug)).eq('status', 'published').maybeSingle();
      a = r2.data;
    }
    if (!a) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>PEPPERIT — 기사를 찾을 수 없어요</title><meta name="robots" content="noindex"></head><body style="font-family:sans-serif;background:#FAF6F0;text-align:center;padding:80px 24px"><h1 style="color:#FF4F8B">PEPPERIT</h1><p>기사를 찾을 수 없어요. <a href="/pepperit" style="color:#FF4F8B">홈으로 →</a></p></body></html>');
    }

    const url = SITE + '/article/' + encodeURIComponent(a.slug || a.id);
    const title = a.title || 'PEPPERIT';
    const descr = stripHtml(a.content).slice(0, 155);
    const thumb = a.thumbnail_url || '';
    const gallery = Array.isArray(a.gallery) ? a.gallery : [];
    const pub = a.published_date || a.created_at;
    const tags = Array.isArray(a.tags) ? a.tags : [];

    // 최신 기사 4개 (현재 글 제외)
    const { data: latest } = await supabaseAdmin.from('pepperit_articles')
      .select('title, slug, id, thumbnail_url, category, published_date')
      .eq('status', 'published').neq('id', a.id)
      .order('published_date', { ascending: false }).limit(4);

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      headline: title,
      image: [thumb].concat(gallery).filter(Boolean).slice(0, 5),
      datePublished: pub,
      dateModified: pub,
      articleSection: a.category || 'NEWS',
      keywords: tags.join(', '),
      inLanguage: 'ko-KR',
      author: { '@type': 'Organization', name: 'PEPPERIT', url: SITE + '/pepperit' },
      publisher: {
        '@type': 'Organization', name: 'PEPPERIT',
        logo: { '@type': 'ImageObject', url: SITE + '/pepperit-icon-512.png' },
        sameAs: [IG],
        parentOrganization: { '@id': 'https://www.pap-magazine.com/#organization' },
      },
    };

    const galleryHtml = gallery.slice(1, 10).map((g) =>
      '<img class="g" loading="lazy" src="' + esc(g) + '" alt="' + esc(title) + '">').join('');

    const igEmbed = a.source_instagram_url ? (
      '<div class="igbox">' +
      '<p class="igbox-t">이 소식, 인스타그램에서 반응 남기기</p>' +
      '<p class="igbox-d">좋아요 · 댓글 · 저장 · 친구에게 보내기는 원본 게시물에서!</p>' +
      '<blockquote class="instagram-media" data-instgrm-permalink="' + esc(a.source_instagram_url) + '" data-instgrm-version="14" style="background:#fff;border:1px solid #FFD3E2;margin:16px auto 0;max-width:540px;min-width:280px;width:100%"></blockquote>' +
      '<a class="btn" href="' + esc(a.source_instagram_url) + '" target="_blank" rel="noopener">게시물에서 반응 남기기 →</a>' +
      '<a class="btn ghost" href="' + IG + '" target="_blank" rel="noopener">Follow @pepperitmag</a>' +
      '</div><script async src="https://www.instagram.com/embed.js"></' + 'script>'
    ) : '';

    const latestHtml = (latest || []).map((l) =>
      '<a class="lat" href="/article/' + encodeURIComponent(l.slug || l.id) + '">' +
      (l.thumbnail_url ? '<img loading="lazy" src="' + esc(l.thumbnail_url) + '" alt="' + esc(l.title) + '">' : '') +
      '<span class="lat-cat">' + esc(l.category || 'NEWS') + '</span>' +
      '<span class="lat-t">' + esc(l.title) + '</span></a>').join('');

    const html = '<!DOCTYPE html><html lang="ko"><head>' +
      '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + esc(title) + ' | PEPPERIT — 케이팝 셀럽 데일리 매거진</title>' +
      '<meta name="description" content="' + esc(descr) + '">' +
      '<meta name="keywords" content="' + esc(tags.join(', ')) + ', 페퍼릿, PEPPERIT, 케이팝 뉴스">' +
      '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">' +
      '<link rel="canonical" href="' + esc(url) + '">' +
      '<link rel="shortcut icon" href="/pepperit-favicon-192.png?v=2">' +
      '<link rel="icon" type="image/png" sizes="192x192" href="/pepperit-favicon-192.png?v=2">' +
      '<link rel="icon" type="image/png" sizes="32x32" href="/pepperit-favicon-32.png?v=2">' +
      '<link rel="apple-touch-icon" href="/pepperit-apple-touch.png?v=2">' +
      '<meta property="og:type" content="article"><meta property="og:site_name" content="PEPPERIT">' +
      '<meta property="og:title" content="' + esc(title) + '">' +
      '<meta property="og:description" content="' + esc(descr) + '">' +
      '<meta property="og:url" content="' + esc(url) + '">' +
      (thumb ? '<meta property="og:image" content="' + esc(thumb) + '">' : '') +
      '<meta property="og:locale" content="ko_KR">' +
      '<meta property="article:published_time" content="' + esc(pub) + '">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<script type="application/ld+json">' + JSON.stringify(ld) + '</' + 'script>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">' +
      '<style>*{margin:0;padding:0;box-sizing:border-box}:root{--pink:#FF4F8B;--powder:#FFE5EE;--cream:#FAF6F0;--ink:#1A1A1A;--lemon:#FFE94F}' +
      'body{font-family:Inter,Pretendard,"Apple SD Gothic Neo",sans-serif;background:var(--cream);color:var(--ink);line-height:1.75;-webkit-font-smoothing:antialiased}' +
      'a{color:inherit;text-decoration:none}.wrap{max-width:680px;margin:0 auto;padding:0 24px}' +
      'header{background:var(--pink);color:#fff;padding:18px 0;text-align:center}' +
      '.logo{font-family:Fraunces,serif;font-style:italic;font-weight:600;font-size:26px}.logo .h{color:var(--lemon)}' +
      '.cat{display:inline-block;background:var(--powder);color:var(--pink);font-size:11px;font-weight:900;letter-spacing:.1em;padding:6px 14px;border-radius:100px;margin:36px 0 14px}' +
      'h1{font-size:27px;line-height:1.35;font-weight:900;letter-spacing:-.01em}' +
      '.date{font-size:12px;color:#8a8a8a;margin-top:10px}' +
      '.hero{width:100%;border-radius:14px;margin-top:24px}' +
      '.body{font-size:15.5px;margin-top:26px}.body br+br{display:block;content:"";margin-top:.5em}' +
      '.g{width:100%;border-radius:14px;margin-top:14px}' +
      '.igbox{background:#fff;border:2px solid var(--powder);border-radius:18px;padding:26px;margin-top:38px;text-align:center}' +
      '.igbox-t{font-weight:900;font-size:16px;color:var(--pink)}.igbox-d{font-size:12.5px;color:#777;margin-top:6px}' +
      '.btn{display:inline-block;background:var(--pink);color:#fff;font-size:13px;font-weight:900;padding:13px 26px;border-radius:100px;margin:16px 6px 0}' +
      '.btn.ghost{background:#fff;color:var(--pink);border:2px solid var(--pink)}' +
      '.lat-wrap{margin:44px 0 60px}.lat-h{font-size:13px;font-weight:900;letter-spacing:.12em;color:var(--pink);margin-bottom:14px}' +
      '.lat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}' +
      '.lat img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:12px}' +
      '.lat-cat{display:block;font-size:10px;font-weight:900;color:var(--pink);margin-top:8px;letter-spacing:.08em}' +
      '.lat-t{display:block;font-size:13.5px;font-weight:700;line-height:1.4;margin-top:3px}' +
      'footer{background:var(--pink);color:#fff;text-align:center;padding:34px 24px;font-size:12px}footer a{font-weight:900}' +
      '</style></head><body>' +
      '<header><a href="/pepperit"><img src="/pepperit-logo-white.png" alt="Pepperit" style="height:34px;width:auto;display:block;margin:0 auto"></a></header>' +
      '<main class="wrap"><article>' +
      '<span class="cat">' + esc(a.category || 'NEWS') + '</span>' +
      '<h1>' + esc(title) + '</h1>' +
      '<p class="date">' + esc(String(pub).slice(0, 10)) + ' · PEPPERIT</p>' +
      (thumb ? '<img class="hero" src="' + esc(thumb) + '" alt="' + esc(title) + '">' : '') +
      '<div class="body">' + String(a.content || '') + '</div>' +
      galleryHtml + igEmbed +
      '</article>' +
      ((latest || []).length ? '<div class="lat-wrap"><p class="lat-h">MORE PEPPERIT</p><div class="lat-grid">' + latestHtml + '</div></div>' : '') +
      '</main>' +
      '<footer>PEPPERIT — 케이팝 · 패션 · 뷰티 · 컬쳐의 모든 순간, 가장 가볍게 · <a href="' + IG + '" target="_blank" rel="noopener">@pepperitmag</a><br><br>PAP Magazine 자매지 · <a href="https://www.pap-magazine.com/">pap-magazine.com</a> · 제휴 문의 hello@pepperitmag.com</footer>' +
      '</body></html>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[seo/pepperit] error:', err);
    return res.status(500).send('server error');
  }
};
