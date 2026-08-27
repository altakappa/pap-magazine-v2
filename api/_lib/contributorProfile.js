/**
 * PAP Magazine — 기여자 프로필 공용 헬퍼 (Ⅲ-30, 2026-08-27 신설)
 *
 * 기준 (도메니코 위임 "추천대로" — 실측 근거):
 *   화보 3편 이상은 5계정뿐이고 그중 3이 브랜드(Zara·Balenciaga·Swarovski)였다.
 *   → **2편 이상 + 인물 크레딧만** (Fashion by/Brand/Agency 역할 제외) = 44명.
 *   전원 페이지 자동 생성은 씬페이지 리스크라 이 기준을 관문으로 둔다.
 *   집계·필터는 DB RPC(top_contributors / contributor_editorials)가 한다.
 */

'use strict';

const MIN_EDITORIALS = 2;
const HANDLE_RE = /^[A-Za-z0-9._]{2,60}$/;
const SITE = 'https://www.pap-magazine.com';

function escText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escText(s).replace(/"/g, '&quot;');
}
function normHandle(raw) {
  const h = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
}
/* 브랜드성 역할은 프로필 표시에서도 제외 — RPC 필터와 같은 정의 */
function isPersonRole(r) {
  const s = String(r || '').toLowerCase();
  return !(s.includes('fashion by') || s.includes('brand') || s.includes('agency'));
}

function pageShell(title, desc, canonical, jsonLd, bodyHtml) {
  return '<!DOCTYPE html>\n<html lang="ko">\n<head>\n'
    + '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>' + escText(title) + '</title>\n'
    + '<meta name="description" content="' + escAttr(desc) + '">\n'
    + '<link rel="canonical" href="' + escAttr(canonical) + '">\n'
    + '<meta name="robots" content="index,follow,max-image-preview:large">\n'
    + '<meta property="og:type" content="profile">\n'
    + '<meta property="og:title" content="' + escAttr(title) + '">\n'
    + '<meta property="og:description" content="' + escAttr(desc) + '">\n'
    + '<meta property="og:url" content="' + escAttr(canonical) + '">\n'
    + '<meta property="og:site_name" content="PAP MAGAZINE">\n'
    + '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>\n'
    + '<style>\n'
    + '*{margin:0;padding:0;box-sizing:border-box}\n'
    + "body{font-family:'Montserrat','Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#000;color:#fff;-webkit-font-smoothing:antialiased}\n"
    + 'a{color:inherit;text-decoration:none}\n'
    + '.wrap{max-width:860px;margin:0 auto;padding:90px 24px 120px}\n'
    + '.logo{font-size:12px;font-weight:800;letter-spacing:.35em;text-transform:uppercase;margin-bottom:56px}\n'
    + '.eyebrow{font-size:10px;font-weight:700;letter-spacing:.4em;text-transform:uppercase;color:#c33b3b;margin-bottom:16px}\n'
    + 'h1{font-size:clamp(26px,5vw,40px);font-weight:800;line-height:1.25;margin-bottom:14px}\n'
    + '.sub{font-size:13px;color:rgba(255,255,255,.55);line-height:1.9;margin-bottom:8px}\n'
    + '.ig{display:inline-block;margin:10px 0 0;font-size:12px;letter-spacing:.06em;border-bottom:1px solid rgba(255,255,255,.35);color:rgba(255,255,255,.8)}\n'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px;margin-top:44px}\n'
    + '.card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;border-radius:2px;background:#111}\n'
    + '.card .t{font-size:13px;font-weight:600;margin-top:10px;line-height:1.5}\n'
    + '.card .d{font-size:11px;color:rgba(255,255,255,.45);margin-top:4px}\n'
    + '.list{margin-top:40px}\n'
    + '.row{display:flex;justify-content:space-between;gap:14px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,.1);flex-wrap:wrap}\n'
    + '.row .n{font-size:14.5px;font-weight:700}\n'
    + '.row .r{font-size:12px;color:rgba(255,255,255,.5)}\n'
    + '.row .c{font-size:12px;color:rgba(255,255,255,.65);white-space:nowrap}\n'
    + '.foot{margin-top:80px;padding-top:24px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;color:rgba(255,255,255,.45);line-height:1.9}\n'
    + '</style>\n</head>\n<body>\n<div class="wrap">\n'
    + '<div class="logo"><a href="/">PAP MAGAZINE</a></div>\n'
    + bodyHtml
    + '\n</div>\n</body>\n</html>';
}

module.exports = { MIN_EDITORIALS, HANDLE_RE, SITE, escText, escAttr, normHandle, isPersonRole, pageShell };
