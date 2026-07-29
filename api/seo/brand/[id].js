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
const { parseBrandCredits } = require('../../_lib/fashionCredits');

const SITE = 'https://www.pap-magazine.com';
const IG = 'https://www.instagram.com/pap_magazine/';
// MAIL 상수는 2026-07-29 문의 CTA 를 폼(/business)으로 옮기며 미사용이 됐다.
// 남겨두면 다음 사람이 mailto 로 되돌릴 여지가 있어 제거한다.

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

    /* 2) 이 브랜드가 등장한 발행 에디토리얼 — 기사 자신의 fashion 크레딧에서 직접 읽는다.
     *
     * 왜 바꿨나 (2026-07-29): 기존엔 editorial_brands 매핑 테이블을 조회했는데
     * 그 테이블의 마지막 적재가 2026-05-04 다(실측). 즉 5월 이후 발행 화보는
     * 브랜드 페이지에 영영 안 뜬다 — 브랜드 담당자가 들어와도 "석 달 전 게
     * 마지막"으로 보인다. 인바운드 유입을 노리는 페이지에서 치명적이다.
     * 에디토리얼 SSR 이 같은 이유로 이미 크레딧 직접 조회로 옮겼고(489d359),
     * 여기도 같은 소스를 쓰면 매핑 테이블 의존이 사라져 항상 최신이 된다.
     *
     * 비용: 발행 기사의 fashion 만 읽어 메모리에서 필터한다. 브랜드당 전건
     * 스캔이라 페이지 캐시(1h edge + 24h SWR)가 이 비용을 흡수한다. */
    let eds = [];
    {
      const rows = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from('editorials')
          .select('title, slug, id, cover_image, og_image, thumbnail, published_date, fashion')
          .eq('status', 'published')
          .not('fashion', 'is', null)
          .order('published_date', { ascending: false, nullsFirst: false })
          .range(from, from + PAGE - 1);
        if (error) break;
        if (!data || !data.length) break;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      eds = rows
        .filter((e) => e.title && parseBrandCredits(e.fashion).some((b) => b.id === brandId))
        .slice(0, 300);
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
  .cta p.stats{color:rgba(255,255,255,.92);font-size:13px;letter-spacing:.01em;margin:-4px 0 16px}
  .cta p.stats b{color:#fff}
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
    <!-- 2026-07-29 매체 지표 (인스타 인사이트 실측, 최근 30일).
         브랜드 담당자가 "화보에 나왔네" 다음에 문의 버튼을 누를 근거가 없어
         이탈하던 구간이다. 숫자는 분기별로 갱신할 것. -->
    <p class="stats">월 도달 <b>430만</b> · 코어 <b>25–34세 52.6%</b> · <b>여성 58.7%</b> · 단일 도시 1위 <b>서울</b></p>
    <!-- mailto → 문의 폼(brand_inquiries)으로. mailto 는 메일 클라이언트가 안 열리면
         그대로 이탈이고, 어느 브랜드 페이지가 문의를 만들었는지도 남지 않는다.
         ?brand= 로 유입 브랜드를 넘겨 리드에 출처를 남긴다. -->
    <a class="btn" href="/business?inquiry=1&brand=${encodeURIComponent(brand.brand_id)}#inquiry">광고·파트너십 문의</a>
    <!-- 미디어킷도 계측 경유(경로형) — 어느 브랜드 담당자가 열어봤는지가 곧 영업 우선순위다 -->
    <a class="btn ghost" href="/mediakit/ko/brand_${encodeURIComponent(brand.brand_id)}">미디어킷 받기</a>
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
