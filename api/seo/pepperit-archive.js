/**
 * GET /pepperit/archive · (host pepperitmag.com) /archive
 * 페퍼릿 전체 기사 SSR 목록 — 크롤러 진입점.
 *
 * 왜 필요한가 (2026-07-29 SEO 감사):
 * pepperitmag 사이트 헬스 20점, 크롤 134페이지 중 107건이 오류인데 그 107건이
 * 전부 'Orphan page (has no incoming internal links)' 한 항목이었다.
 * 원인은 홈(frontend/pepperit.html)의 "지금 뜨는 이야기"·"방금 올라온 기사"
 * 두 섹션이 클라이언트 JS 로만 채워지는 빈 <div> 라는 것 — 크롤러가 받는 HTML
 * 에는 기사 링크가 한 줄도 없다. 기사 상세끼리는 서로 링크하지만 그것만으로는
 * 진입점이 없어 사이트맵에만 존재하는 페이지가 된다.
 *
 * 이 라우트는 발행 기사 전부를 서버에서 링크로 뿌려 진입점을 만든다.
 * 홈 푸터에 정적 <a> 로 걸어 두므로 크롤 경로는 홈 → archive → 개별 기사가 된다.
 * DB 는 읽기만 한다.
 */

const { supabaseAdmin } = require('../_lib/supabase');

const SITE = 'https://www.pepperitmag.com';
const PAGE_MAX = 500; // 페퍼릿은 현재 120건 — 한 페이지로 충분하다

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* JSON-LD 안의 '<' 를 이스케이프한다. 기사 제목에 "</script>" 가 들어 있으면
   <script type="application/ld+json"> 블록을 그대로 빠져나간다 —
   seoRenderer.escJson 과 같은 방어다. */
function escJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t)) return '';
  return t.toISOString().slice(0, 10).replace(/-/g, '.');
}

module.exports = async function handler(req, res) {
  try {
    const { data: rows } = await supabaseAdmin.from('pepperit_articles')
      .select('title, slug, id, thumbnail_url, category, published_date')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(PAGE_MAX);

    const list = rows || [];
    const url = SITE + '/archive';

    const itemsHtml = list.map((a) => {
      const href = '/article/' + encodeURIComponent(a.slug || a.id);
      return '<a class="it" href="' + href + '">'
        + (a.thumbnail_url ? '<img loading="lazy" src="' + esc(a.thumbnail_url) + '" alt="' + esc(a.title) + '">' : '<span class="ph"></span>')
        + '<span class="cat">' + esc(a.category || 'NEWS') + '</span>'
        + '<span class="t">' + esc(a.title) + '</span>'
        + '<span class="d">' + esc(fmtDate(a.published_date)) + '</span>'
        + '</a>';
    }).join('');

    // ItemList 로 목록임을 명시 — 리치 결과보다 '이 페이지는 색인 대상 목록'
    // 신호를 주는 것이 목적이다.
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      '@id': url,
      name: 'PEPPERIT 전체 기사',
      isPartOf: { '@id': SITE + '/pepperit' },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: list.length,
        itemListElement: list.slice(0, 100).map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: SITE + '/article/' + encodeURIComponent(a.slug || a.id),
          name: a.title || 'PEPPERIT',
        })),
      },
    };
    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'PAP Magazine', item: 'https://www.pap-magazine.com/' },
        { '@type': 'ListItem', position: 2, name: 'PEPPERIT', item: SITE + '/pepperit' },
        { '@type': 'ListItem', position: 3, name: '전체 기사', item: url },
      ],
    };

    const html = '<!DOCTYPE html><html lang="ko"><head>'
      + '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
      + '<title>전체 기사 — PEPPERIT 케이팝 셀럽 데일리 매거진</title>'
      + '<meta name="description" content="PEPPERIT(페퍼릿)에 올라온 케이팝 셀럽·패션·뷰티·컬쳐 기사 '
      + list.length + '건 전체 목록입니다. 컴백·콜라보·시상식 속보부터 오늘의 룩까지 날짜순으로 모아 봅니다.">'
      + '<meta name="robots" content="index, follow, max-image-preview:large">'
      + '<link rel="canonical" href="' + esc(url) + '">'
      + '<meta property="og:type" content="website">'
      + '<meta property="og:site_name" content="PEPPERIT">'
      + '<meta property="og:title" content="전체 기사 — PEPPERIT">'
      + '<meta property="og:url" content="' + esc(url) + '">'
      + '<meta property="og:image" content="' + SITE + '/pepperit-icon-512.png">'
      + '<script type="application/ld+json">' + escJson(ld) + '</' + 'script>'
      + '<script type="application/ld+json">' + escJson(breadcrumbLd) + '</' + 'script>'
      + '<style>'
      + ':root{--pink:#FF4F8B;--bg:#FAF6F0}'
      + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#231F20;'
      + "font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}"
      + '.wrap{max-width:1080px;margin:0 auto;padding:40px 20px 72px}'
      + 'a{color:inherit;text-decoration:none}'
      + 'h1{font-size:28px;margin:8px 0 4px}'
      + '.lead{opacity:.7;font-size:14px;margin:0 0 28px}'
      + '.chip{display:inline-block;background:var(--pink);color:#fff;font-size:11px;'
      + 'letter-spacing:.08em;padding:5px 10px;border-radius:999px}'
      + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}'
      + '.it{display:block;background:#fff;border:1px solid #FFD3E2;border-radius:14px;overflow:hidden}'
      + '.it img,.it .ph{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:#FFEFF5}'
      + '.it .cat{display:block;padding:10px 12px 0;font-size:11px;color:var(--pink);letter-spacing:.06em}'
      + '.it .t{display:block;padding:4px 12px 0;font-size:14px;line-height:1.5;font-weight:600}'
      + '.it .d{display:block;padding:6px 12px 12px;font-size:12px;opacity:.55}'
      + '.nav{margin-top:36px;font-size:13px;opacity:.75}'
      + '.nav a{border-bottom:1px solid var(--pink)}'
      + '</style></head><body><div class="wrap">'
      + '<span class="chip">ARCHIVE</span>'
      + '<h1>PEPPERIT 전체 기사</h1>'
      + '<p class="lead">케이팝 셀럽 · 패션 · 뷰티 · 컬쳐 기사 ' + list.length + '건 · 최신순</p>'
      + '<div class="grid">' + itemsHtml + '</div>'
      + '<p class="nav"><a href="/pepperit">← PEPPERIT 홈</a> · '
      + '<a href="https://www.pap-magazine.com/">PAP Magazine</a></p>'
      + '</div></body></html>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 목록은 자주 바뀌므로 짧게 캐시하되 stale 허용 (크롤러 폭주 시 DB 보호)
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(html);
  } catch (e) {
    console.error('[pepperit-archive] failed:', e && e.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">'
      + '<title>PEPPERIT</title><meta name="robots" content="noindex"></head>'
      + '<body style="font-family:sans-serif;background:#FAF6F0;text-align:center;padding:80px 24px">'
      + '<h1 style="color:#FF4F8B">PEPPERIT</h1><p>잠시 후 다시 시도해 주세요. '
      + '<a href="/pepperit" style="color:#FF4F8B">홈으로 →</a></p></body></html>');
  }
};
