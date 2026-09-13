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
/* 2026-09-13 도메니코(5번 장치) — PAP 프리미엄 크리에이터(프로필 인스타 아이디 = 활성 프리미엄 회원)는
   첫 화보부터 프로필이 생기고, 인증 배지·활동 도시/국가·참여 화보 전체·연락 버튼이 붙는다. */
const MIN_EDITORIALS_PREMIUM = 1;
const HANDLE_RE = /^[A-Za-z0-9._]{2,60}$/;
const SITE = 'https://www.pap-magazine.com';
const { isPremiumProfile } = require('./collaborators');
const { countryName } = require('./countries');

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
    + '<meta name="pap-ui-i18n" content="contributors" data-v="5">\n'
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
    + '.pbadge{display:inline-flex;align-items:center;gap:6px;margin:0 0 14px;padding:5px 10px;border:1px solid #c9a86a;color:#c9a86a;font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;border-radius:2px}\n'
    + '.pbadge-s{display:inline-block;margin-left:8px;padding:1px 6px;border:1px solid #c9a86a;color:#c9a86a;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;border-radius:2px;vertical-align:middle}\n'
    + '.loc{display:block;font-size:12px;color:rgba(255,255,255,.6);margin-top:6px}\n'
    + '.bio{font-size:13px;color:rgba(255,255,255,.7);line-height:1.8;margin-top:12px;max-width:640px;white-space:pre-line}\n'
    + '.contact{margin-top:28px;padding:20px;border:1px solid rgba(201,168,106,.45);max-width:640px}\n'
    + '.contact h2{font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#c9a86a;margin-bottom:8px}\n'
    + '.contact p{font-size:12px;color:rgba(255,255,255,.6);line-height:1.8}\n'
    + '.contact textarea{width:100%;min-height:110px;margin-top:12px;padding:10px;background:#0a0a0a;border:1px solid rgba(255,255,255,.2);color:#fff;font:inherit;font-size:13px;resize:vertical}\n'
    + '.contact button{margin-top:10px;background:#c9a86a;color:#000;border:none;padding:12px 26px;font-size:11px;font-weight:700;letter-spacing:.1em;cursor:pointer;border-radius:2px}\n'
    + '.contact button[disabled]{opacity:.5;cursor:default}\n'
    + '.contact .msg{font-size:12px;margin-top:10px;color:#c9a86a;min-height:18px}\n'
    /* 2026-09-13 — 9999a3d 가 여기 문자열 안에 진짜 줄바꿈을 넣어 파일이 SyntaxError 로 죽었고,
       /contributors · /contributor/:handle 이 하루 동안 500(FUNCTION_INVOCATION_FAILED) 이었다.
       tests/contributor-profile 이 이제 이 모듈을 실제로 require 한다. */
    + '</style>\n<script src="/pap-ui-i18n.js?v=5" defer></script>\n'
    + '<script src="/pap-profile-prompt.js?v=1" defer></script>\n</head>\n<body>\n<div class="wrap">\n'
    + '<div class="logo"><a href="/">PAP MAGAZINE</a></div>\n'
    + bodyHtml
    + '\n</div>\n</body>\n</html>';
}

/** 프로필 인스타 아이디가 이 handle 이고 활성 프리미엄인 회원 — 없거나 조회 실패면 null (혜택은 확실할 때만). */
async function findPremiumCreator(db, handle) {
  const h = normHandle(handle);
  if (!db || !h) return null;
  try {
    const { data } = await db
      .from('profiles')
      .select('id, email, display_name, instagram, activity_country, activity_city, bio, subscription_plan, subscription_status, role')
      .eq('instagram', h)
      .limit(2);
    const rows = (data || []).filter(isPremiumProfile);
    return rows.length ? rows[0] : null;
  } catch (_) { return null; }
}

/** 활성 프리미엄 회원의 인스타 아이디 목록 → { handle: profile }. 목록 페이지가 1편 기여자를 채우는 데 쓴다. */
async function premiumCreatorsByHandle(db) {
  const out = {};
  if (!db) return out;
  try {
    const { data } = await db
      .from('profiles')
      .select('id, display_name, instagram, activity_country, activity_city, subscription_plan, subscription_status')
      .not('instagram', 'is', null)
      .like('subscription_plan', 'premium%')
      .in('subscription_status', ['active', 'trialing']);
    for (const p of (data || [])) {
      const h = normHandle(p.instagram);
      if (h && isPremiumProfile(p)) out[h] = p;
    }
  } catch (_) { /* 목록은 그대로 */ }
  return out;
}

/** "Hamburg, Germany" 꼴. 둘 다 없으면 ''. */
function locationLabel(profile) {
  if (!profile) return '';
  return [profile.activity_city, countryName(profile.activity_country) || profile.activity_country].filter(Boolean).join(', ');
}

function premiumBadgeHtml() {
  return '<div class="pbadge" translate="no">✓ PAP PREMIUM CREATOR</div>\n';
}

/* 연락 버튼 — 로그인 회원이 메시지를 쓰면 POST /api/contributors/contact 가 크리에이터 메일로 전달한다.
   크리에이터의 이메일은 화면에 나오지 않는다. 하루 3건. 인라인 스크립트의 한글은 contributors 사전이 번역한다. */
function contactHtml(handle) {
  const h = escAttr(handle);
  /* 안내 문구는 숨긴 span 에 둔다 — pap-ui-i18n 이 텍스트 노드로 번역하고, 스크립트는 그 텍스트를 읽는다.
     (스크립트 문자열 안의 한글은 런타임이 못 바꾼다.) */
  return '<div class="contact" id="pcContact" data-handle="' + h + '">\n'
    + '<h2>연락하기</h2>\n'
    + '<p>협업·촬영 문의를 PAP가 이 크리에이터에게 전달합니다. 답장은 회원님의 가입 이메일로 옵니다. 하루 3건까지 보낼 수 있습니다.</p>\n'
    + '<textarea id="pcMsg" maxlength="2000"></textarea>\n'
    + '<button type="button" id="pcSend">메시지 보내기</button>\n'
    + '<div class="msg" id="pcOut"></div>\n'
    + '<span hidden id="pcT-login">로그인 후 보낼 수 있습니다.</span>'
    + '<span hidden id="pcT-short">메시지를 10자 이상 적어 주세요.</span>'
    + '<span hidden id="pcT-sent">전송되었습니다. 크리에이터가 회원님의 이메일로 답할 수 있습니다.</span>'
    + '<span hidden id="pcT-limit">하루 3건까지 보낼 수 있습니다. 내일 다시 시도해 주세요.</span>'
    + '<span hidden id="pcT-fail">전송에 실패했습니다. 잠시 후 다시 시도해 주세요.</span>\n'
    + '</div>\n'
    + '<script>(function(){\n'
    + 'var b=document.getElementById("pcSend"),o=document.getElementById("pcOut"),m=document.getElementById("pcMsg");\n'
    + 'function T(k){var e=document.getElementById("pcT-"+k);return e?e.textContent:k;}\n'
    + 'b.addEventListener("click",function(){\n'
    + ' var t="";try{t=localStorage.getItem("pap-token")||"";}catch(_){}\n'
    + ' if(!t){o.textContent=T("login");setTimeout(function(){location.href="/auth?next="+encodeURIComponent(location.pathname);},900);return;}\n'
    + ' var v=(m.value||"").trim(); if(v.length<10){o.textContent=T("short");return;}\n'
    + ' b.disabled=true;o.textContent="";\n'
    + ' fetch("/api/contributors/contact",{method:"POST",headers:{"Authorization":"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({handle:document.getElementById("pcContact").getAttribute("data-handle"),message:v})})\n'
    + ' .then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,j:j};});})\n'
    + ' .then(function(x){ if(x.ok){o.textContent=T("sent");m.value="";}\n'
    + '   else if(x.status===429){o.textContent=T("limit");b.disabled=false;}\n'
    + '   else if(x.status===401){o.textContent=T("login");b.disabled=false;}\n'
    + '   else {o.textContent=T("fail");b.disabled=false;} })\n'
    + ' .catch(function(){o.textContent=T("fail");b.disabled=false;});\n'
    + '});})();</script>\n';
}

module.exports = { MIN_EDITORIALS, MIN_EDITORIALS_PREMIUM, HANDLE_RE, SITE, escText, escAttr, normHandle, isPersonRole, pageShell,
  findPremiumCreator, premiumCreatorsByHandle, locationLabel, premiumBadgeHtml, contactHtml };
