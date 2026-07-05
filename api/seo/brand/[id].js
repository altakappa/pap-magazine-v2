/**
 * PAP Magazine — 브랜드 허브 / "브랜드 발견용" SEO 페이지
 * Route: /brand/:id  (rewritten in vercel.json → /api/seo/brand/:id)
 *
 * 목적(인식 심기): 특정 브랜드가 PAP에 소개된 모든 에디토리얼을 한 페이지에
 * 모아 SEO로 노출. 브랜드(또는 경쟁사·고객)가 "브랜드명 + 화보/PAP" 를
 * 검색하면 이 페이지가 잡혀 → "PAP가 우리를 이렇게 다뤘구나 / 저기가 그
 * 무대구나" 인식 + 광고·파트너십 문의 유입.
 *
 * 데이터: brands (마스터) + editorial_brands (브랜드↔에디토리얼 링크,
 *         editorial_title 로 조인) + editorials (상세: 커버·슬러그·날짜).
 *
 * ⚠️ 표현: "소개/등장(featured)" — 광고비 지불로 단정하지 않는다.
 * 캐시: 1h edge + 24h SWR.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');

const SITE = 'https://www.pap-magazine.com';
const IG = 'https://www.instagram.com/pap_magazine/';
const MAIL = 'contact@pap-magazine.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function dateStr(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
}
function notFound(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  return res.status(404).send('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
    '<meta name="robots" content="noindex"><title>Brand not found | PAP Magazine</title></head>' +
    '<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:80px">' +
    '<p>브랜드를 찾을 수 없습니다.</p><a href="/partners" style="color:#fff">← Brands &amp; Partners</a></body></html>');
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }

  const { id } = req.query;
  if (!id || typeof id !== 'string') return notFound(res);
  const brandId = decodeURIComponent(id).trim().toLowerCase();

  try {
    // 1) 브랜드 마스터
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('brand_id, display_name, category, tier, instagram_handle, status')
      .eq('brand_id', brandId).neq('status', 'archived')
      .limit(1).maybeSingle();

    if (!brand || !brand.display_name) return notFound(res);

    // 2) 이 브랜드가 등장한 에디토리얼 제목들 (distinct)
    const { data: eb } = await supabaseAdmin
      .from('editorial_brands')
      .select('editorial_title')
      .eq('brand_id', brandId)
      .limit(600);
    const titles = [...new Set((eb || []).map(r => r.editorial_title).filter(Boolean))];

    // 3) 에디토리얼 상세 (발행분만)
    let eds = [];
    if (titles.length) {
      const { data } = await supabaseAdmin
        .from('editorials')
        .select('title, slug, id, cover_image, og_image, thumbnail, published_date')
        .in('title', titles.slice(0, 300))
        .eq('status', 'published')
        .order('published_date', { ascending: false, nullsFirst: false })
        .limit(300);
      eds = (data || []).filter(e => e.title);
    }

    const name = esc(brand.display_name);
    const count = eds.length;
    const igHandle = brand.instagram_handle ? esc(brand.instagram_handle) : '';

    const cards = eds.map(e => {
      const handle = e.slug || e.id;
      const img = e.cover_image || e.og_image || e.thumbnail || '';
      const href = '/editorial/' + encodeURIComponent(handle);
      const d = dateStr(e.published_date);
      return '<a class="card" href="' + esc(href) + '">' +
        (img ? '<span class="ph"><img src="' + esc(img) + '" alt="' + esc(e.title) +
          ' — PAP Magazine editorial" loading="lazy"></span>' : '<span class="ph"></span>') +
        '<span class="ct"><span class="tt">' + esc(e.title) + '</span>' +
        (d ? '<time>' + d + '</time>' : '') + '</span></a>';
    }).join('');

    const metaTitle = name + ' in PAP Magazine' + (count ? ' — ' + count + ' editorials' : '');
    const metaDesc = name + ' — PAP 매거진(PAP매거진)에 소개된 ' + name + ' 에디토리얼' +
      (count ? ' ' + count + '편' : '') + '. 패션·뷰티·컬쳐 화보로 만나는 ' + name +
      '. Featured in PAP Magazine editorials. 브랜드 광고·파트너십 문의 환영.';

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: name + ' — PAP Magazine',
      url: SITE + '/brand/' + encodeURIComponent(brand.brand_id),
      about: {
        '@type': 'Brand', name: brand.display_name,
        sameAs: igHandle ? 'https://www.instagram.com/' + igHandle + '/' : undefined,
      },
      isPartOf: { '@type': 'WebSite', name: 'PAP Magazine', url: SITE },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Brands', item: SITE + '/partners' },
          { '@type': 'ListItem', position: 3, name: brand.display_name, item: SITE + '/brand/' + encodeURIComponent(brand.brand_id) },
        ],
      },
      mainEntity: {
        '@type': 'ItemList', numberOfItems: count,
        itemListElement: eds.slice(0, 100).map((e, i) => ({
          '@type': 'ListItem', position: i + 1, name: e.title,
          url: SITE + '/editorial/' + encodeURIComponent(e.slug || e.id),
        })),
      },
    };

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(metaTitle)} | PAP Magazine</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="${count ? 'index,follow' : 'noindex,follow'}">
<link rel="canonical" href="${SITE}/brand/${encodeURIComponent(brand.brand_id)}">
<meta property="og:title" content="${esc(name)} in PAP Magazine">
<meta property="og:description" content="${esc(name)} featured across ${count} PAP Magazine editorials.">
<meta property="og:url" content="${SITE}/brand/${encodeURIComponent(brand.brand_id)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PAP Magazine">
<meta property="og:locale" content="ko_KR">
<meta property="og:locale:alternate" content="en_US">
${eds[0] && (eds[0].cover_image || eds[0].og_image) ? '<meta property="og:image" content="' + esc(eds[0].cover_image || eds[0].og_image) + '">' : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(name)} in PAP Magazine">
<meta name="twitter:description" content="${esc(name)} featured across ${count} PAP Magazine editorials.">
${eds[0] && (eds[0].cover_image || eds[0].og_image) ? '<meta name="twitter:image" content="' + esc(eds[0].cover_image || eds[0].og_image) + '">' : ''}
<script type="application/ld+json">
${JSON.stringify(schema)}
</script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#000;color:#fff;line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1100px;margin:0 auto;padding:74px 22px 100px}
  .crumb{font-size:12px;letter-spacing:.06em;color:rgba(255,255,255,.45);margin-bottom:30px}
  .crumb a{color:rgba(255,255,255,.6);text-decoration:none}.crumb a:hover{color:#fff}
  h1{font-size:40px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;line-height:1.1;margin-bottom:12px}
  .meta{font-size:13px;color:rgba(255,255,255,.5);letter-spacing:.04em;margin-bottom:6px}
  .meta a{color:rgba(255,255,255,.7);text-decoration:none}.meta a:hover{color:#fff}
  .lede{font-size:14.5px;color:rgba(255,255,255,.62);max-width:620px;margin:12px 0 4px}
  .cta{margin:30px 0 26px;padding:24px 26px;background:linear-gradient(135deg,#111,#1c1c1c);border:1px solid rgba(255,255,255,.16);border-radius:4px}
  .cta p{font-size:13px;color:rgba(255,255,255,.7);margin-bottom:14px;max-width:640px}
  .cta a.btn{display:inline-block;background:#fff;color:#000;font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:12px 20px;border-radius:3px;text-decoration:none;margin-right:9px}
  .cta a.btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-top:26px}
  .card{text-decoration:none;color:#fff;display:flex;flex-direction:column;gap:9px}
  .card .ph{aspect-ratio:3/4;background:#141414;overflow:hidden;border:1px solid rgba(255,255,255,.06)}
  .card .ph img{width:100%;height:100%;object-fit:cover;transition:.4s;display:block}
  .card:hover .ph img{transform:scale(1.04)}
  .card .tt{display:block;font-size:13px;font-weight:600;letter-spacing:.01em;color:rgba(255,255,255,.9)}
  .card time{font-size:11px;color:rgba(255,255,255,.35)}
  .empty{padding:40px 0;color:rgba(255,255,255,.5);font-size:14px}
  footer{margin-top:74px;padding-top:22px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:rgba(255,255,255,.4)}
  footer a{color:rgba(255,255,255,.6);text-decoration:none;margin-right:14px}footer a:hover{color:#fff}
  @media(max-width:640px){h1{font-size:30px}.wrap{padding:56px 16px 80px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="crumb"><a href="/">PAP MAGAZINE</a> &nbsp;/&nbsp; <a href="/partners">Brands</a> &nbsp;/&nbsp; ${name}</div>
  <h1>${name}</h1>
  <p class="meta">${esc((brand.tier || '').toUpperCase())}${brand.tier ? ' · ' : ''}${esc((brand.category || '').toUpperCase())}${igHandle ? ' · <a href="https://www.instagram.com/' + igHandle + '/" rel="noopener" target="_blank">@' + igHandle + '</a>' : ''}</p>
  <p class="lede">${count ? '<b style="color:#fff">' + name + '</b> 이(가) PAP MAGAZINE 에디토리얼 <b style="color:#fff">' + count + '편</b>에 소개되었습니다.' : name + ' — PAP MAGAZINE.'}</p>
  <p class="lede">${count ? name + ' featured across ' + count + ' PAP Magazine editorials.' : ''}</p>

  <div class="cta">
    <p>${name} 브랜드와의 협업·게재·행사 취재 문의는 PAP MAGAZINE 으로. 브랜드 콘텐츠를 @pap_magazine 에 게재하고 웹 아카이브에 함께 남깁니다.</p>
    <a class="btn" href="mailto:${MAIL}?subject=PAP%20Magazine%20%EA%B4%91%EA%B3%A0%C2%B7%ED%8C%8C%ED%8A%B8%EB%84%88%EC%8B%AD%20%EB%AC%B8%EC%9D%98%20-%20${encodeURIComponent(brand.display_name)}">광고·파트너십 문의</a>
    <a class="btn ghost" href="/partners">전체 브랜드 보기</a>
  </div>

  ${count ? '<div class="grid">' + cards + '</div>' : '<p class="empty">아직 발행된 에디토리얼이 없습니다. 곧 업데이트됩니다.</p>'}

  <footer>
    <a href="/">Home</a><a href="/partners">Brands</a><a href="/magazine">Magazine</a><a href="/business">Business</a>
    <a href="${IG}" rel="noopener">Instagram @pap_magazine →</a>
  </footer>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[brand] error:', err);
    return res.status(500).send('brand page error');
  }
};
