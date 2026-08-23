// PAP Magazine — Content harness, Editorial sub-module (extracted from
// pap-app.js per HARNESS_CHECKLIST.md mission 8a — Content body sub-divided
// into per-content-type files starting with editorials).
//
// Owns:
//   - edData (editorial dataset, populated from /api/editorials at boot)
//   - edDetails (per-editorial detail map, populated lazily)
//   - openEditorial / _openEditorialInner / _openEditorialInner_noPush
//   - closeEditorial
//   - openAllEditorials / closeAllEditorials / filterEditorialsByCategory
//   - SEO meta updater (per-editorial title / OG / canonical / JSON-LD)
//     [stays in pap-app.js for now — covers article + film too]
//   - edImgError (editorial card image error fallback)
//
// Public surface (consumed cross-script via globals):
//   var edData                       editorial dataset
//   var edDetails                    per-editorial detail map
//   window.openEditorial(title,thumb)   open detail overlay (with interstitial)
//   window._openEditorialInner_noPush  popstate restoration (popstate handler
//                                      lives in pap-app.js)
//   window.closeEditorial(skipHistory)
//   window.openAllEditorials()       grid overlay
//   window.closeAllEditorials()
//   window.filterEditorialsByCategory(cat)
//   window.edImgError(img)           card image fallback (also called from
//                                    articles.html / films.html inline)
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js        → lockScroll/unlockScroll, escapeHtml, _decHtml,
//                           _normWs, buildPagination
//   - pap-i18n.js         → lang, T (some labels read T directly)
//   - pap-subscription.js → showPremiumInterstitial, isStandardOrAbove
// Dependencies that resolve at CALL time (load order doesn't matter):
//   - pap-app.js          → openCreatorPopup (creator), openArticleDetail
//                           (article), openFilmDetail (film), other open*
//                           cross-content navigations called at click time
//
// The `popstate` overlay-restore handler stays in pap-app.js because it
// dispatches across editorial / article / film / creator overlays — splitting
// it would cross-couple all four sub-modules.

// ======== SCRAP-FROM-EDITORIAL (community playground bridge) ========
// One-click "Save to my scrapbook" button on each editorial gallery image.
// Injects CSS once at module load; the button HTML is appended inside each
// `.ed-gallery-item` by the gallery-render code further down.
// Calls /api/community/scraps with sourceType='editorial' so the API can
// later cross-reference scraps to their PAP source content.
// 2026-08-05 — 언어 접두어 유지 헬퍼 (다인).
// 하드코딩된 '/editorial/<slug>' 점프가 /en, /ja 등에서 언어 접두어를 버리고
// 한국어 경로로 튕기면 GSC 가 이를 "리디렉션이 포함된 페이지"로 집계한다.
// 정의는 idempotent — 어느 파일이 먼저 로드돼도 안전하다.
if (!window._papLangPrefix) {
  window._papLangPrefix = function(){
    try{
      var m = String(location.pathname||'').match(/^\/(en|it|fr|es|ja|de|zh|ru)(\/|$)/);
      if (m) return '/' + m[1];
      if (window.__papDeepLinkLang) return '/' + window.__papDeepLinkLang;
    }catch(_){}
    return '';
  };
}

(function _injectScrapBtnCss(){
  if(document.getElementById('papScrapBtnStyle')) return;
  var s=document.createElement('style');
  s.id='papScrapBtnStyle';
  s.textContent=''
    + '.ed-gallery-item{position:relative;}'
    + '.ed-scrap-btn{position:absolute;top:10px;right:10px;background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:999px;padding:6px 12px;font-size:11px;font-weight:600;letter-spacing:.05em;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;opacity:0;transform:translateY(-4px);transition:opacity .2s,transform .2s,background .2s;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:2}'
    + '.ed-gallery-item:hover .ed-scrap-btn{opacity:1;transform:translateY(0)}'
    + '.ed-scrap-btn:hover{background:rgba(0,0,0,.85)}'
    + '.ed-scrap-btn.saved{background:rgba(81,207,102,.85);color:#fff}'
    + '.ed-scrap-btn svg{width:12px;height:12px;stroke:currentColor;stroke-width:2;fill:none}';
  document.head.appendChild(s);
})();

// One-click scrap: POST to /api/community/scraps. Updates the button to
// "Saved ✓" (or shows a toast) on success; toast on failure.
window._papScrapFromImage = function(url, title, btn){
  // Login gate — uses pap-token directly (sync, reliable from page load)
  var token=null;
  try { token=localStorage.getItem('pap-token'); } catch(_){}
  if(!token){
    var lang=(localStorage.getItem('pap-lang')||'ko');
    alert(_edL9('로그인 후 스크랩할 수 있어요','Please log in to save scraps'));
    return;
  }
  if(btn) btn.disabled=true;
  fetch('/api/community/scraps', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
    credentials:'include',
    body: JSON.stringify({
      imageUrl: url,
      sourceUrl: window.location.origin + window.location.pathname + '?editorial=' + encodeURIComponent(title||''),
      sourceType: 'editorial',
      note: title || null,
    }),
  }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(out){
      if(btn) btn.disabled=false;
      var lang=(localStorage.getItem('pap-lang')||'ko');
      if(!out.ok){
        var msg = (out.j && out.j.message) || (_edL9('스크랩 실패','Scrap failed'));
        if(typeof window.showToast==='function') window.showToast(msg);
        else alert(msg);
        return;
      }
      // Success — flip the button to "Saved" state
      if(btn){
        btn.classList.add('saved');
        btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'+(_edL9('저장됨','Saved'));
        // Keep the saved state visible — it'll reset on next page load
      }
      if(typeof window.showToast==='function'){
        window.showToast(_edL9('스크랩북에 저장됐어요','Saved to your scrapbook'));
      }
    }).catch(function(){
      if(btn) btn.disabled=false;
      var lang=(localStorage.getItem('pap-lang')||'ko');
      var msg = _edL9('스크랩 실패','Scrap failed');
      if(typeof window.showToast==='function') window.showToast(msg);
      else alert(msg);
    });
};

// Tiny helper for inline render — emits the button HTML with safely-escaped
// title for the JS string-arg context. Inline so the gallery template stays
// readable.
function _scrapBtnHtml(url, title){
  var t = (title||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  var lang=(localStorage.getItem('pap-lang')||'ko');
  var label = _edL9('스크랩','Save');
  return '<button class="ed-scrap-btn" onclick="event.stopPropagation();_papScrapFromImage(\''+url+'\',\''+t+'\',this)" title="Save to scrapbook"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'+label+'</button>';
}

// ======== EDITORIAL DATA + DETAIL + OPEN/CLOSE FAMILY ========
// ======== EDITORIAL SEARCH DATA SLOT ========
// edData (editorial dataset) is owned by Content. The search algorithm itself
// lives in pap-search.js (mission 4) and reads edData as a global at call time.
var edData=[];

// ======== EDITORIAL DETAIL DATA ========
var edDetails={};

// QA #96 — credits can arrive in three shapes depending on where they come
// from: the legacy admin dict ({role: {name, instagram}}), the new admin
// array ([{roles: [...], name, instagram}]), or the curated display
// array ([{r, h: [...]}]) baked into editorial-details.json. Display
// code below all expects {r, h}, so normalise once at the read site.
function _normalizeCreditsForDisplay(raw){
  var rows;
  if(!raw) return [];
  // Already in display format — items have an `r` field.
  if(Array.isArray(raw) && raw.length && raw[0] && raw[0].r !== undefined){
    rows = raw;
  }
  // New admin array format — items have `roles` (array) or `name`.
  else if(Array.isArray(raw)){
    rows = raw.map(function(c){
      var roles = Array.isArray(c.roles) ? c.roles
                : (c.role ? [c.role] : []);
      var n = c.name || '';
      var id = c.instagram || '';
      // {n, id} preserves both display name and handle so the existing
      // renderer (typeof h==='object'&&h.n) takes the high-fidelity branch.
      return { r: roles.join(', '), h: [{ n: n, id: id }] };
    });
  }
  // Legacy admin dict — keys are roles, values are {name, instagram} or string.
  else if(typeof raw === 'object'){
    rows = Object.keys(raw).map(function(role){
      var val = raw[role];
      var n = '', id = '';
      if(val && typeof val === 'object'){
        n = val.name || ''; id = val.instagram || '';
      } else if(typeof val === 'string'){
        n = val;
      }
      return { r: role, h: [{ n: n, id: id }] };
    });
  }
  else {
    return [];
  }
  // Merge rows that share the same role (case-insensitive). The new admin
  // array format produces one row per credited person/brand, so a piece
  // with 18 "Fashion By" entries used to render as 18 separate "FASHION BY"
  // labels stacked on top of each other. Now we collapse them so the role
  // label appears once and the handles are joined together — same data,
  // half the visual noise.
  return _mergeCreditsBySameRole(rows);
}
// Group consecutive-or-not rows by their role label so the renderer
// outputs one row per role. Order of first appearance is preserved.
// Casing of the first occurrence of each role wins (e.g. "Fashion By"
// vs "FASHION BY" → whichever was seen first is kept).
function _mergeCreditsBySameRole(rows){
  if(!Array.isArray(rows) || rows.length === 0) return rows || [];
  var byKey = {};
  var order = [];
  for(var i = 0; i < rows.length; i++){
    var c = rows[i];
    if(!c || !c.r) continue;
    var key = String(c.r).trim().toLowerCase();
    if(!key) continue;
    if(byKey[key]){
      // Concat handles; downstream renderer joins them with ", "
      var existing = byKey[key];
      var addH = Array.isArray(c.h) ? c.h : [];
      existing.h = existing.h.concat(addH);
    } else {
      byKey[key] = { r: c.r, h: Array.isArray(c.h) ? c.h.slice() : [] };
      order.push(key);
    }
  }
  return order.map(function(k){ return byKey[k]; });
}
// Editorial logo distribution folder map. Single source of truth lives in
// pap-logos-data.js (window.PAP_LOGO_FOLDERS) so mypage and pap-app.js
// stay in sync. The inline fallback below is kept for safety in case the
// data script fails to load — both should have the same content.
var edLogoFolders = (typeof window !== 'undefined' && window.PAP_LOGO_FOLDERS) ? window.PAP_LOGO_FOLDERS : {
'2Much':'1vc8OQ6k1Kf4-_u7B6DRZMsnc8dBbrQO8',
'A Mertale':'10r1p_jWraQExWqVyx_SVPYc60sjq0fz6',
'A knights Tale':'13CH4Bmw65dVcR5wtDewzT-2owfQmzliD',
'Aerial':'16jJ3wDDgOc_d08tm1z_CadchsU2mxPGK',
'Air Bag':'1MnlZ3u7IlWIwoiZoPgYgkXofjQzUmYYc',
'Becoming Form':'11E4pYzVD9RpMTm8aPNIsYJYWzAedXAL2',
'Birds Don\'t Cry':'1-K4fJrzi6sAV8x8_6HIpqBq9DrpbbORH',
'Black Radiance':'1Mt7lv_nxCvMToHz4DKGLCx4jrFFGNSvD',
'Bloom of Silence':'1PC7A2Yyip8_R-iM6URqGzWLpxwy03256',
'Blooming Flesh':'1GEn7Gx6RmjLPz73_Og49MnVtShgEB3J3',
'Candelaria del Desierto':'1sj9u3RPRfLDpl-oY3XhvYbhZq6Zw0fxO',
'Constructed Fantasies':'13qw0hjxEpqoKTVXs60Wq2KjRTb6FJy8z',
'Couture Macabre':'1lqevxzZ5Xn5JGjXefELvoswGEfci9oT3',
'Cyber Love':'1QDs9X7NgAfg8p2v_ugZvuea-M69ZdYNj',
'Dates to Remember':'1Mz-6VO-wqPIpO_RI1IvECKJNTaupNJIZ',
'Distorted Memories':'1ayOA8Qji_tGrI6Ftc6AIyOu4Y9ogVikZ',
'Doll':'1zVVSOdgg_TrnsfJd0jOFOUqNMp86f77_',
'Echo of the Souls':'1qH0JH_bt0_KMaIk4EFGWISbA6wmOf5QL',
'Echoes of the forgotten':'1sEQ4cl63Mzk3ojbB0_6pRc7LY2pT1t4v',
'Eclat':'1cjHIht8hcTSiWfwB-fUxVkZX65lnw2lY',
'Eidolon':'1GPkOHx4ewWsHgWnLlyql71PLFSaRPhzp',
'Equipoise':'1V8UjzPFqvhRvVbuL5Yt09bDuXmWf9emX',
'Folie':'1XZGqAPOuN9jAnwNpfFlESIqrpCGmKLVQ',
'For I Have Sinned':'1WyoH47h-YVlsRgYFHTc6qrtpQG3OGbCY',
'GODLESS':'1JwzshZTubdzVLLo3t_0dNNplrroWAtTX',
'Haunted':'1QxaiazFCfYDBC9au0JxVt7wFEAf0tYqj',
'Her and The Hair':'1gMecao9j3qfIHr2S3Zm3PnyqXZ3ZlCM4',
'I daydream about you online':'1fJRKpjq_DZ4PMjPDzuiplseY8-X1-QWI',
'Inner Eclipse':'1SZCdOaLzaNZ8e_HU_MoN0VT62u78gWcE',
'Insecta':'1G4wC88dB8QFWE7NpLVc9bpQiBpveCthK',
'Inside The Castle':'10iOsuVcwXNkDb605bVtALugaSNmBmxXe',
'L\'AN 01':'1pyMVmYkZoGM-WwDbxTMlGeBkS7JZOzCx',
'Life After':'17SXzwP1XNjR3WMHZLd8YtNAE-7WrKMXs',
'Love Lasts Three Years':'181rsfPfGsRC59J-up_bDcOLppAk_K5Eg',
'Lune Blanche':'1MMg9v2EA0oBflvhwOHByCFyCgWYMGboT',
'Metamorphosis of the Armour':'1Ce1fAMGx0PPYMlrIGJKt9_999_y2A2ch',
'Modern Samurai':'1CHQHgKeYTNoPhnBG0QvoC6sL2VoqozeC',
'Multicolour Dreams Of You':'1U4h2nUlYM4uxcHKgtsL1qq0AOL5Vm77l',
'Neo Goth Me':'1nmBsM6KFvSQqIooLG01YvYfSl7nudTs9',
'Nightmare':'1P4nGQ8EmP751gOUTPQetgSejUNefgK0V',
'Noir':'1Bk_0278jzBQGnSblnxd9YLshpylOMIYK',
'Power Play':'1AGWaaoDlRangKKDRZURTxBsfc_NBNUwH',
'Primal Spectrum':'1TBgZ9U2-ftRnjS8sJJshPRhK3g9_UrUD',
'Radiance':'126AD4JTDkvxcZYcoYd_E9jo8c2rfvIDw',
'Salvia':'1glcyq6lhFI3rF3THZyZMTMB8DZdR_oP7',
'Scarlet Blossom':'1UcfN11qWoWFVVHbMjpM4SVU1lJfkZTTF',
'Sculpted Silence':'1wmK_Pe2Uw9bCzxGoQwIv0raHMi3vI0w8',
'Second Surface':'1_m5zGtlPPNYlzUIKkd_M9CCTisCy2wvD',
'Severance':'1oEBOSSHaObGwHdfIQhQQh69jAMSmBN26',
'Shadow':'1FVWQ0Pqew7et7gD32ghC8F-NpCmC7oOb',
'Sharp Objects':'1J-BtXY2DrRiec41db-Metjo2VGWU5L72',
'She Was Never a Myth':'1YVUSUxvhxWN9UXle9b9meLR5A4bRBbtU',
'Shiny Darks':'1vQTr9zthES5pVF9Zfcx4mqVitqoUBLjq',
'Silent Gaze':'1xIaMemz0XL8BSE_acZBha874oXVcAOx0',
'Silenzio Ottico':'1tlgvz5uQZHf632DD65qsq2T3m8y5Yg4p',
'Silver':'1x4TO1rcQd-PjcDcF3hBA7UPi_z8INnro',
'Slash':'13yExNZIpJMXxhd1M86-PTrrbLOWUz-cR',
'Subliminal':'13rx75tvSsn7D7aBokdrWcUM4HIj248lq',
'Take A Bow':'1PCcf3IhAu62cDbr4Nr-n1bog9NCE_iMD',
'The Many Faces of Nina':'1yLM-sliFUt7UVa87iTxMOzJKJVNTrUOL',
'The Modern Muse':'1y-PMMA0yyXxaB28b4AIW_XACIO1f88OI',
'The Order of Her':'1su_fIVWmJvDX-jTAxu79SgdWfCDM_RYU',
'The Weight of Control':'1YKPOlZLPTRszp-11eptB9ZyLIHpF17hF',
'Theatrical Honor':'1F0SM86OsHBVYzW-1wvd1hS49Pf4PoSem',
'Voyage in the Box':'1jLPqFnyzxVTyd8dXLitVtCVL6638IHnq',
'Welcome to the Circus':'1XbirV_4OTXN4fcJqgBVnF2mi0WQIOCK4',
'Whilst the Lights are Burning':'1IEJeOIc3VwPI2_U1fB43bVGURVTc6lfY',
'geOmetry':'1e9ATGQ4x4WhZ07Mkp6MyS5XEmB8cynoE'
};
// Case-insensitive lookup helper for edLogoFolders
function getLogoFolderId(t){if(edLogoFolders[t])return edLogoFolders[t];var tL=t.toLowerCase();for(var k in edLogoFolders){if(k.toLowerCase()===tL)return edLogoFolders[k];}return null;}

// isPremium / isStandardOrAbove and the entire interstitial-ad subsystem
// (showPremiumInterstitial, navigateWithInterstitial, _showBrandAdInterstitial,
// _showPremiumUpsellInterstitial, _brandAds + API loader, _getNextBrandAd, and
// the right-click image-protection IIFE) are extracted to pap-subscription.js
// (mission 6). pap-subscription.js MUST be loaded before this file — the
// openEditorial / openAllX / openFilmDetail / openArticleDetail call sites
// below reference these functions as bare globals at click time.

// (Interstitial state vars and functions extracted to pap-subscription.js — mission 6.)

function openEditorial(title,thumb){
  // Show interstitial for free users (session limited).
  // 2026-08-21 — 단, 어차피 잠금화면이 뜰 화보에는 붙이지 않는다.
  // '광고 보고 → 못 봄' 은 수익도 전환도 아니고 이탈만 만든다.
  var _edWillLock = (typeof _papWillLock === 'function')
    && _papWillLock((typeof edDetails !== 'undefined' && edDetails[title]) || {});
  if(!_edWillLock && !isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){
      _openEditorialInner(title,thumb);
    });
    return;
  }
  _openEditorialInner(title,thumb);
}

// ──────────────────────────────────────────────────────────────────────
// Editorial video section renderer. Consumed by both _openEditorialInner
// and _openEditorialInner_noPush so the two render paths stay in sync.
//
// Resolves the editorial's url field through normaliseEmbedUrl
// (pap-utils.js, also shared with the film admin form). One of three
// outcomes:
//   • iframe match  → fill #edDetailVideoFrame with <iframe src=…> and
//                     un-hide the wrapping <section>.
//   • link match    → fill #edDetailVideoFrame with a styled <a> card
//                     (Instagram fallback) and un-hide the section.
//   • null / no slot present → leave hidden, clear any prior content
//                     so re-opens of a different editorial don't carry
//                     over a stale player.
// ──────────────────────────────────────────────────────────────────────
function _renderEditorialVideo(rawUrl){
  var wrap = document.getElementById('edDetailVideoWrap');
  var frame = document.getElementById('edDetailVideoFrame');
  if (!wrap || !frame) return;
  // Always clear first — prevents the iframe from hanging around when
  // navigating from an editorial-with-video to one without.
  frame.innerHTML = '';
  wrap.hidden = true;

  if (typeof normaliseEmbedUrl !== 'function') return;
  var info = normaliseEmbedUrl(rawUrl);
  if (!info) return;

  if (info.kind === 'iframe') {
    // Allow list mirrors YouTube's documented embed permissions; the
    // attribute is required for fullscreen + autoplay-on-tap to work
    // inside iOS Safari, and is harmless for Vimeo.
    // 사용자 요청 — 재생 버튼 클릭 없이 자동재생. 브라우저 정책상 mute 필수.
    var _autoSrc = (typeof appendAutoplayParams === 'function')
      ? appendAutoplayParams(info.src, info.provider)
      : info.src;
    frame.innerHTML =
      '<iframe src="' + _autoSrc + '" loading="lazy" '
      + 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
      + 'allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    wrap.hidden = false;
    return;
  }

  if (info.kind === 'link') {
    // Instagram doesn't iframe-embed reliably — render a card link that
    // opens in a new tab. The .ed-video-link CSS handles the play-icon
    // affordance so the slot still reads as "video here".
    var label = info.provider === 'instagram' ? 'Watch on Instagram' : 'Watch external';
    frame.innerHTML =
      '<a class="ed-video-link" href="' + info.href + '" target="_blank" rel="noopener noreferrer">'
      + label + '</a>';
    wrap.hidden = false;
  }
}

// QA #163 — Related Films card list. Films link to editorials via
// films.related_editorial_id; /api/editorials embeds the reverse-FK
// list under editorial.related_films, and apiEditorialToLocal +
// _populateEdDetailsFromApi pass it through as det.relatedFilms.
//
// Renders a horizontal row of thumbnail+title cards. Clicking a card
// navigates to /film/<slug> (server-rendered film page); we don't try
// to hand off to the overlay because the overlay state lives in the
// film page, not the editorial overlay.
// QA #246 — Render clickable hashtag chips on the editorial detail.
// Routes through the same /articles?tag=<value> URL the article
// detail uses, so a single tag-filter pipeline (and active-chip UI)
// services both content types. Looks up tags off edData by title — the
// detail-cache (edDetails) is a partial mirror that doesn't always
// include the tag list, but edData (the list row source) always does.
// QA #271 v2 — 커버 + PAP 로고 합성 갤러리 이미지 다운로드 영역.
//
// 베타 운영 기간 동안 모든 사용자에게 다운로드 허용 (정식 출시 후 isStandardOrAbove() 게이트 활성).
//   • 커버 이미지: cover_image URL을 fetch → blob → 다운로드
//   • 로고 이미지: 각 갤러리 이미지에 PAP 로고를 1080×1350 4:5 캔버스로
//                  합성 후 ZIP으로 묶어 다운로드 (어드민 IG 생성기와 동일 합성 로직)
//
// `det`는 _normaliseEditorialDetail 결과, `d`는 raw API row.
function _renderEditorialDownloads(det, d){
  var box = document.getElementById('edDetailDownloads');
  if (!box) { console.warn('[downloads] #edDetailDownloads not found'); return; }
  // 커버 URL: det / d / DOM의 actual rendered cover img 순서로 시도
  // 커버 필드 (2026-08-09 버그 수정 — 도메니코: "커버가 아닌 다른 이미지가
  // 다운됐다"): 관리자 편집의 cover_image 는 apiEditorialToLocal 에서
  // d.hero 로 이름이 바뀐다. 옛 이름(cover_image·thumbnail)만 찾다가 못
  // 찾고 DOM/갤러리 폴백으로 떨어져 엉뚱한 이미지가 나갔다.
  // 우선순위: 관리자 커버(d.hero) → 구필드 → 썸네일.
  var coverUrl = (d && d.hero) ||
                 (det && (det.coverImage || det.cover_image)) ||
                 (d && (d.cover_image || d.thumbnail)) ||
                 (d && d.img) || (det && det.thumb) || '';
  if (!coverUrl) {
    var heroImg = document.querySelector('#edDetailCover img, #edDetailHero img, .ed-cover img');
    if (heroImg && heroImg.src) coverUrl = heroImg.src;
  }
  // 갤러리 URL: det / d / DOM의 actual rendered gallery imgs 순서로 시도
  var gallery = (det && Array.isArray(det.gallery) && det.gallery.length) ? det.gallery
              : (d && Array.isArray(d.gallery)   && d.gallery.length)   ? d.gallery
              : [];
  if (!gallery.length) {
    var galleryImgs = document.querySelectorAll('#edDetailGallery img, .ed-gallery-item img');
    gallery = Array.prototype.slice.call(galleryImgs).map(function(img){ return img.src; }).filter(Boolean);
  }
  var title = (det && det.title) || (d && d.title) ||
              (document.getElementById('edDetailTitle') && document.getElementById('edDetailTitle').textContent) ||
              'editorial';
  var safeTitle = String(title).replace(/[^a-zA-Z0-9가-힯 ]/g, '').replace(/\s+/g, '-').toLowerCase() || 'editorial';

  // 2026-07-28 — 관리자가 인스타 편집 모달에서 조정해 저장한 로고/프레이밍 설정.
  // edDetails 엔트리(instaLogoSettings) → raw API row(insta_logo_settings) 순으로
  // 찾는다. 없으면 null 이고, 그 경우 합성은 종전 기본값(15%/1%/85%)을 쓴다.
  var logoSettings = (d && (d.instaLogoSettings || d.insta_logo_settings)) ||
                     (det && (det.instaLogoSettings || det.insta_logo_settings)) || null;
  if (logoSettings && typeof logoSettings !== 'object') logoSettings = null;

  console.log('[downloads] rendering', { coverUrl: !!coverUrl, galleryCount: gallery.length, title: title });

  // 항상 박스 표시 — 커버/갤러리 없는 에지 케이스에도 회원가입 CTA는 보여줌.
  box.style.display = '';

  // (2026-08-10 도메니코) 비로그인·무료 회원도 버튼 3종을 그대로 본다 —
  // 누르는 순간 유료 전용 팝업(_papDlPaywall)이 뜬다. "쓰려는 순간이
  // 전환의 순간" (댓글 401 → 로그인 유인과 같은 원칙).
  // QA #284 Phase 2 — 로그인 사용자라도 role에 따라 분기.
  //   admin/staff             → 다운로드 버튼 노출
  //   user + 본인 참여 editorial → 다운로드 버튼 노출
  //   user + 그 외             → 안내 메시지 노출
  // 권한 체크는 서버 호출 → loading 상태 먼저 표시.
  box.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' +
      '<div style="font-size:12px;color:#666">'+(_edL9('권한 확인 중...','Checking access...'))+'</div>' +
    '</div>';

  var edId = (d && d.id) || (det && det.id) || '';
  // 2026-08-03 — 다운로드 로그에 content_id 가 비어 있어 서버가 '본인 참여작(owner)'
  // 판정을 못 하고, 참여 크리에이터의 정상 다운로드가 위반(consented:false)으로
  // 기록되던 버그 수정. 현재 보고 있는 에디토리얼 id 를 전역에 보관해 둔다.
  try { window._papDlContentId = edId || ''; } catch (_) {}
  window._papCheckDownloadPerm('editorial', edId).then(function(perm){
    // 권한과 무관하게 버튼 3종 렌더 — perm.allowed 가 아니면 버튼 함수가
    // 잠금 모드(클릭 시 유료 전용 팝업)로 그린다.
    // 티어시트 메타는 det/d/title 이 보이는 여기서 만들어 넘긴다
    // (2026-08-09 버그 수정 — 버튼 함수 안에서 det 를 참조해 조용히 실패했었다).
    var tsMeta = null;
    try {
      // 문자열만 통과 — 객체가 String() 을 타면 "[object Object]" 가
      // PDF 에 그대로 찍힌다 (2026-08-10 도메니코 실측 신고).
      var _str = function(v){ return (typeof v === 'string') ? v : ''; };
      tsMeta = {
        title: _str(title),
        issue: _str(det && det.issue) || _str(d && d.issue),
        cover: _str(coverUrl) || _str(gallery && gallery[0]),
        desc: _str(det && det.desc) || _str(d && d.description),
        gallery: (gallery || []).slice(0, 30),
        /* 잡지식 페이지 크레딧 — 관리자가 저장한 이미지별 패션 크레딧
           ("@handle Item, ..." → "Item: @handle") 을 갤러리 순서대로 */
        imageCredits: (gallery || []).slice(0, 30).map(function(u, i){
          var raw = (det && det.imageCredits && det.imageCredits['img_' + (i + 1)]) || '';
          return String(raw).split(',').map(function(t){
            t = t.trim();
            var mm = t.match(/^(@[A-Za-z0-9._]+)\s*(.*)$/);
            return mm ? ((mm[2] ? mm[2].trim() + ': ' : '') + mm[1]) : t;
          }).filter(Boolean).join('    ');
        }),
        credits: ((det && det.credits) || []).map(function(c){
          var names = (c.h || []).map(function(h){
            if (h && typeof h === 'object') return (typeof h.n === 'string' && h.n) ? h.n : String(h.id || '').replace(/^@/, '');
            return String(h || '').replace(/^@/, '');
          }).filter(Boolean).join(', ');
          return { r: _str(c && c.r), n: names };
        }).filter(function(x){ return x.r && x.n && x.r.indexOf('[object') < 0 && x.n.indexOf('[object') < 0; }).slice(0, 12),
      };
    } catch (_) { tsMeta = null; }
    _renderEditorialDownloadButtons(box, coverUrl, gallery, safeTitle, perm, logoSettings, tsMeta);
  });
  return;
}

// QA #284 Phase 2 — 권한 OK인 사용자에게 실제 버튼 노출.
/* 유료 전용 다운로드 팝업 (2026-08-10 도메니코: "비회원도 버튼은 보이게,
   클릭할 때마다 유료 회원만 가능하다는 팝업"). 오버레이는 1회 주입 후 재사용. */
window._papDlPaywall = window._papDlPaywall || function(){
  var old = document.getElementById('papDlPaywall');
  if (old) { old.style.display = 'flex'; return; }
  var wrap = document.createElement('div');
  wrap.id = 'papDlPaywall';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:20px';
  wrap.innerHTML =
    '<div style="max-width:400px;width:100%;background:#111;border:1px solid rgba(255,255,255,.2);padding:34px 28px;text-align:center" role="dialog" aria-modal="true">'
    + '<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:14px">Members Only</div>'
    + '<div style="font-size:15px;line-height:1.7;color:#eee;margin-bottom:22px">'
    + _edL9('티어시트·커버·로고 이미지 다운로드는<br><b style="color:#fff">스탠다드 멤버십</b>부터 가능합니다.',
            'Tearsheet, cover & logo image downloads<br>require a <b style="color:#fff">Standard membership</b>.')
    + '</div>'
    + '<a href="/subscribe" style="display:inline-block;background:#fff;color:#000;padding:12px 28px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;margin:0 5px 10px">'
    + _edL9('스탠다드 구독하기 →','Subscribe to Standard →') + '</a>'
    + '<a href="/auth?next=' + encodeURIComponent(location.pathname) + '" style="display:inline-block;background:none;color:#fff;border:1px solid rgba(255,255,255,.3);padding:12px 28px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;margin:0 5px 10px">'
    + _edL9('로그인','Log in') + '</a>'
    + '<div><button type="button" onclick="document.getElementById(\'papDlPaywall\').style.display=\'none\'" style="background:none;border:0;color:#777;font-size:12px;cursor:pointer;margin-top:10px;font-family:inherit;text-decoration:underline">'
    + _edL9('닫기','Close') + '</button></div>'
    + '</div>';
  wrap.addEventListener('click', function(e){ if (e.target === wrap) wrap.style.display = 'none'; });
  document.body.appendChild(wrap);
};

function _renderEditorialDownloadButtons(box, coverUrl, gallery, safeTitle, perm, logoSettings, tsMeta){
  // 잠금 모드 (2026-08-10): 비회원·무료 회원도 버튼은 그대로 보되,
  // 클릭하면 유료 전용 팝업이 뜬다.
  var locked = !(perm && perm.allowed);
  // 커버 폴백 (2026-08-09) — 커버 필드가 빈 화보는 갤러리 1번이 사실상 커버다.
  // 커버 버튼이 통째로 사라지는 것보다 낫다.
  if (!coverUrl && gallery && gallery.length) coverUrl = gallery[0];
  var coverHtml = '';
  if (coverUrl) {
    coverHtml =
      '<a href="#" onclick="event.preventDefault();' + (locked ? '_papDlPaywall();' : '_papDownloadAsFile(\'' + coverUrl.replace(/'/g, "\\'") + '\',\'' + safeTitle + '-cover\');') + 'return false;" ' +
      'style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:1px solid #555;color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .2s" ' +
      'onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">'+(_edL9('⬇️ 커버 이미지','⬇️ Cover image'))+'</a>';
  }
  var logoBtnHtml = '';
  if (gallery.length) {
    var galleryJson = encodeURIComponent(JSON.stringify(gallery));
    // 2026-07-28 — 관리자 저장 설정을 버튼에 실어 보낸다. data-gallery 와 동일하게
    // encodeURIComponent(JSON) 이라 따옴표·꺾쇠가 속성 밖으로 새지 않는다.
    var logoSettingsAttr = '';
    try {
      if (logoSettings) logoSettingsAttr = encodeURIComponent(JSON.stringify(logoSettings));
    } catch (_) { logoSettingsAttr = ''; }
    logoBtnHtml =
      '<button id="edLogoDlBtn" type="button" onclick="' + (locked ? '_papDlPaywall()' : '_papDownloadLogoZip(this)') + '" ' +
      'data-gallery="' + galleryJson + '" data-title="' + safeTitle + '" ' +
      'data-logosettings="' + logoSettingsAttr + '" ' +
      'style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:1px solid #555;background:transparent;color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;cursor:pointer;transition:all .2s" ' +
      'onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">'+(_edL9('⬇️ 로고 이미지 (','⬇️ Logo images ('))+'' + gallery.length + (_edL9('장 ZIP)',' images ZIP)'))+'</button>';
  }
  // 티어시트 PDF 버튼 (2026-08-09 도메니코: "로고 이미지 다운로드 옆에
  // 티어시트 다운로드 버튼을 새롭게") — ZIP 동봉안을 폐기하고 별도 버튼.
  var tearsheetBtnHtml = '';
  var tearsheetAttr = '';
  try { if (tsMeta) tearsheetAttr = encodeURIComponent(JSON.stringify(tsMeta)); } catch (_) { tearsheetAttr = ''; }
  if (typeof tearsheetAttr === 'string' && tearsheetAttr) {
    tearsheetBtnHtml =
      '<button id="edTearsheetBtn" type="button" onclick="' + (locked ? '_papDlPaywall()' : '_papDownloadTearsheet(this)') + '" ' +
      'data-tearsheet="' + tearsheetAttr + '" data-title="' + safeTitle + '" ' +
      'style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:1px solid #555;background:transparent;color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;cursor:pointer;transition:all .2s" ' +
      'onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">' +
      (_edL9('📄 티어시트 (PDF)','📄 Tearsheet (PDF)')) + '</button>';
  }

  // QA #284 Phase 2 — role 배지 (어느 권한으로 노출되는지 명확하게).
  var roleBadge = '';
  if (!locked && perm && perm.reason){
    var badgeText = ({ admin:_edL9('대표 관리자','Editor-in-Chief'), staff:_edL9('서브 관리자','Editor'), owner:_edL9('참여 크리에이터','Contributing creator'), subscriber:_edL9('멤버십 회원','Member') })[perm.reason] || '';
    var badgeColor = { admin:'#e74c3c', staff:'#f39c12', owner:'#27ae60', subscriber:'#3498db' }[perm.reason] || '#888';
    if (badgeText){
      roleBadge = '<span style="display:inline-block;padding:2px 8px;background:' + badgeColor + ';color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;border-radius:2px">' + badgeText + (_edL9(' 권한',' access'))+'</span>';
    }
  }
  box.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' + roleBadge + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + tearsheetBtnHtml + coverHtml + logoBtnHtml + '</div>' +
      '<div id="edLogoDlStatus" style="font-size:11px;color:#888;min-height:14px"></div>' +
      '<div style="font-size:11px;color:#666">'+(_edL9('개인 사용 및 비상업적 용도에 한해 사용 가능 · 다운로드 이력이 기록됩니다.','For personal, non-commercial use only · downloads are logged.'))+'</div>' +
    '</div>';
}

// QA #284 Phase 2 — 다운로드 권한 조회 헬퍼. role + 본인 참여 여부를
// 백엔드 /api/downloads/check로 위임 (UI와 log 엔드포인트가 동일 정책 공유).
// 결과 캐싱: 같은 (type, id) 쌍에 대해서는 페이지 세션 내 1회만 조회.
window._papCheckDownloadPerm = window._papCheckDownloadPerm || function(type, id){
  if (!window._papDlPermCache) window._papDlPermCache = {};
  var key = type + '|' + (id || '');
  if (window._papDlPermCache[key]) return window._papDlPermCache[key];
  var p = new Promise(function(resolve){
    try {
      // 2026-07-28 수정 — 토큰 조회가 깨져 있어 유료 회원도 다운로드를 못 받았다.
      //   · getToken() 은 pap-api.js 의 클로저 내부 함수라 공개 사이트에서 전역이 아니다
      //     (전역 getToken 은 pap-admin.js 에만 존재 → 관리자 페이지 전용).
      //   · 폴백 키도 'token' 이었는데 실제 저장 키는 'pap-token' 이다.
      // 결과: token 이 항상 빈 값 → 서버 권한 조회(/api/downloads/check)에 닿지도 못하고
      // guest 로 떨어져 스탠다드·프리미엄 회원 전원에게 '구독 필요' 안내가 떴다.
      // 실제 저장 키(pap-token)를 직접 읽고, 전역 getToken 이 있으면 그것도 존중한다.
      var token = '';
      try { token = (typeof getToken === 'function' && getToken()) || localStorage.getItem('pap-token') || ''; }
      catch(_) { token = ''; }
      if (!token) return resolve({ allowed: false, role: 'guest', reason: 'guest' });
      fetch('/api/downloads/check?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id || ''), {
        headers: { 'Authorization': 'Bearer ' + token }
      })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          if (!j) return resolve({ allowed: false, role: 'user', reason: 'not-owner' });
          resolve(j);
        })
        .catch(function(){ resolve({ allowed: false, role: 'user', reason: 'not-owner' }); });
    } catch(_) {
      resolve({ allowed: false, role: 'user', reason: 'not-owner' });
    }
  });
  window._papDlPermCache[key] = p;
  return p;
};

// QA #277 — 회원 식별자로 파일명을 personalize. 유출 시 출처 추적용.
// 형식: pap-{basename}-u{short8}-{timestamp}.{ext}
window._papPersonalizeFilename = window._papPersonalizeFilename || function(basename, ext){
  var short = '';
  try {
    // user.id가 UUID이면 처음 8자만, 없으면 email hash 흉내
    var u = (window.PAP && PAP.auth && PAP.auth.getUser && PAP.auth.getUser()) ||
            (window._currentUser) || null;
    if (u && u.id) short = String(u.id).replace(/-/g, '').slice(0, 8);
    else if (u && u.email) {
      var s = 0;
      for (var i = 0; i < u.email.length; i++) s = (s * 31 + u.email.charCodeAt(i)) >>> 0;
      short = s.toString(16).slice(0, 8);
    }
  } catch(_) {}
  var ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  var safe = (basename || 'pap-download').replace(/[^a-zA-Z0-9가-힯 _-]/g, '').replace(/\s+/g, '-').toLowerCase();
  return 'pap-' + safe + (short ? '-u' + short : '') + '-' + ts + '.' + (ext || 'jpg');
};

// QA #277 — 약관 동의 모달. localStorage에 저장 → 1회만 표시.
// QA #293 — 9개 언어로 다국어 분기 (ko/en/it/ja/zh/ru/de/fr/es).
// resolve(true) 동의함, resolve(false) 거부.
window._papEnsureDlConsent = window._papEnsureDlConsent || function(){
  var _dlT = {
    ko: {
      head: 'DOWNLOAD TERMS', title: '이미지 사용 약관 동의',
      lead: '다운로드한 이미지는 <strong style="color:#fff">개인의 비상업적 용도</strong>로만 사용할 수 있습니다.',
      bullets: [
        '재배포·재판매·SNS 외부 무단 게시 금지',
        '광고·홍보·상품화 등 상업적 이용 금지',
        '모든 이미지의 저작권은 PAP Magazine 및 원 제작자에게 있으며 위반 시 법적 책임이 따를 수 있습니다.',
        '다운로드 이력은 회원 식별 정보와 함께 기록됩니다.'
      ],
      cancel: '취소', agree: '동의하고 다운로드'
    },
    en: {
      head: 'DOWNLOAD TERMS', title: 'Image Usage Agreement',
      lead: 'Downloaded images may be used <strong style="color:#fff">for personal, non-commercial purposes only</strong>.',
      bullets: [
        'No redistribution, resale, or unauthorized posting on external SNS',
        'No commercial use including advertising, promotion, or merchandising',
        'All images are copyrighted by PAP Magazine and the original creators; violations may result in legal action.',
        'Download history is recorded together with your member identifier.'
      ],
      cancel: 'Cancel', agree: 'Agree & Download'
    },
    it: {
      head: 'TERMINI DI DOWNLOAD', title: 'Accordo di utilizzo delle immagini',
      lead: 'Le immagini scaricate possono essere utilizzate <strong style="color:#fff">solo per scopi personali e non commerciali</strong>.',
      bullets: [
        'Vietata la redistribuzione, rivendita o pubblicazione non autorizzata su social esterni',
        'Vietato l\'uso commerciale come pubblicità, promozione o merchandising',
        'Tutte le immagini sono protette dal copyright di PAP Magazine e dei creatori originali; le violazioni possono comportare azioni legali.',
        'La cronologia dei download viene registrata insieme al tuo identificatore membro.'
      ],
      cancel: 'Annulla', agree: 'Accetto e scarico'
    },
    ja: {
      head: 'ダウンロード規約', title: '画像使用同意',
      lead: 'ダウンロードした画像は<strong style="color:#fff">個人の非営利目的</strong>のみご利用いただけます。',
      bullets: [
        '再配布・転売・外部SNSへの無断掲載禁止',
        '広告・宣伝・商品化など商業利用禁止',
        'すべての画像の著作権はPAP Magazineおよび制作者に帰属し、違反時は法的責任が発生する可能性があります。',
        'ダウンロード履歴は会員識別情報とともに記録されます。'
      ],
      cancel: 'キャンセル', agree: '同意してダウンロード'
    },
    zh: {
      head: '下载条款', title: '图片使用同意',
      lead: '下载的图片<strong style="color:#fff">仅限个人非商业用途</strong>。',
      bullets: [
        '禁止再分发、转售或未经授权在外部社交媒体上发布',
        '禁止商业用途，包括广告、宣传或商品化',
        '所有图片版权归PAP Magazine及原创作者所有，违反将可能承担法律责任。',
        '下载记录将与会员识别信息一同保存。'
      ],
      cancel: '取消', agree: '同意并下载'
    },
    ru: {
      head: 'УСЛОВИЯ ЗАГРУЗКИ', title: 'Согласие на использование изображений',
      lead: 'Загруженные изображения можно использовать <strong style="color:#fff">только в личных некоммерческих целях</strong>.',
      bullets: [
        'Запрещены перераспределение, перепродажа и несанкционированная публикация в сторонних соцсетях',
        'Запрещено коммерческое использование, включая рекламу, продвижение или мерчандайзинг',
        'Все изображения защищены авторским правом PAP Magazine и их создателей; нарушения могут повлечь юридическую ответственность.',
        'История загрузок сохраняется вместе с идентификатором участника.'
      ],
      cancel: 'Отмена', agree: 'Согласен и скачать'
    },
    de: {
      head: 'DOWNLOAD-BEDINGUNGEN', title: 'Einwilligung zur Bildnutzung',
      lead: 'Heruntergeladene Bilder dürfen <strong style="color:#fff">nur für persönliche, nicht-kommerzielle Zwecke</strong> verwendet werden.',
      bullets: [
        'Keine Weitergabe, Weiterverkauf oder unautorisierte Veröffentlichung auf externen sozialen Netzwerken',
        'Keine kommerzielle Nutzung wie Werbung, Promotion oder Merchandising',
        'Alle Bilder sind durch das Copyright von PAP Magazine und der ursprünglichen Urheber geschützt; Verstöße können rechtliche Folgen haben.',
        'Der Download-Verlauf wird zusammen mit Ihrer Mitgliederkennung erfasst.'
      ],
      cancel: 'Abbrechen', agree: 'Zustimmen & Herunterladen'
    },
    fr: {
      head: 'CONDITIONS DE TÉLÉCHARGEMENT', title: 'Accord d\'utilisation des images',
      lead: 'Les images téléchargées ne peuvent être utilisées <strong style="color:#fff">qu\'à des fins personnelles et non commerciales</strong>.',
      bullets: [
        'Pas de redistribution, revente ou publication non autorisée sur des réseaux sociaux externes',
        'Pas d\'utilisation commerciale, y compris publicité, promotion ou marchandisage',
        'Toutes les images sont protégées par le droit d\'auteur de PAP Magazine et des créateurs originaux ; les violations peuvent entraîner des poursuites.',
        'L\'historique des téléchargements est enregistré avec votre identifiant de membre.'
      ],
      cancel: 'Annuler', agree: 'Accepter et télécharger'
    },
    es: {
      head: 'TÉRMINOS DE DESCARGA', title: 'Acuerdo de uso de imágenes',
      lead: 'Las imágenes descargadas pueden usarse <strong style="color:#fff">solo para fines personales y no comerciales</strong>.',
      bullets: [
        'Prohibida la redistribución, reventa o publicación no autorizada en redes sociales externas',
        'Prohibido el uso comercial, incluyendo publicidad, promoción o merchandising',
        'Todas las imágenes están protegidas por los derechos de autor de PAP Magazine y los creadores originales; las violaciones pueden acarrear acciones legales.',
        'El historial de descargas se registra junto con su identificador de miembro.'
      ],
      cancel: 'Cancelar', agree: 'Aceptar y descargar'
    }
  };

  return new Promise(function(resolve){
    try {
      if (localStorage.getItem('pap_dl_consent_v1') === 'yes') return resolve(true);
    } catch(_) {}

    // 현재 언어 감지 — global lang 변수 우선, 그 다음 localStorage.
    var _curLang = (typeof lang === 'string' && lang) ? lang :
                   ((typeof localStorage !== 'undefined' && localStorage.getItem('pap-lang')) || 'en');
    var t = _dlT[_curLang] || _dlT.en;

    var bulletsHtml = t.bullets.map(function(b){ return '· ' + b; }).join('<br>');

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    modal.innerHTML =
      '<div style="background:#111;border:1px solid #333;border-radius:8px;max-width:480px;padding:24px;color:#fff;line-height:1.55">' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:.15em;color:#999;margin-bottom:12px">' + t.head + '</div>' +
        '<div style="font-size:15px;font-weight:700;margin-bottom:14px">' + t.title + '</div>' +
        '<div style="font-size:12px;color:#ccc;margin-bottom:18px">' +
          t.lead + '<br><br>' +
          bulletsHtml +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button type="button" id="papDlCancel" style="padding:9px 18px;background:transparent;border:1px solid #555;color:#fff;font-size:11px;letter-spacing:.08em;cursor:pointer">' + t.cancel + '</button>' +
          '<button type="button" id="papDlAgree" style="padding:9px 18px;background:#fff;border:1px solid #fff;color:#000;font-size:11px;font-weight:700;letter-spacing:.08em;cursor:pointer">' + t.agree + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    function done(ok){
      try { if (ok) localStorage.setItem('pap_dl_consent_v1', 'yes'); } catch(_) {}
      modal.remove();
      resolve(!!ok);
    }
    modal.querySelector('#papDlAgree').onclick = function(){ done(true); };
    modal.querySelector('#papDlCancel').onclick = function(){ done(false); };
  });
};

// QA #277 — 다운로드 이력 로깅 (fire-and-forget).
window._papLogDownload = window._papLogDownload || function(payload){
  try {
    // 2026-07-28 — 위 _papCheckDownloadPerm 과 동일한 토큰 조회 버그 수정
    // ('token' → 'pap-token'). 로그가 익명으로 남던 문제도 함께 해소된다.
    var token = '';
    try { token = (typeof getToken === 'function' && getToken()) || localStorage.getItem('pap-token') || ''; }
    catch(_) { token = ''; }
    // 2026-08-03 — content_id 기본값 주입. 호출부가 빠뜨려도 서버가
    // owner(본인 참여작) 판정을 할 수 있도록, 현재 보고 있는 콘텐츠 id 를
    // 기본값으로 실어 보낸다. payload 에 content_id 가 있으면 그쪽이 우선한다.
    var _base = { consented: true };
    try { if (window._papDlContentId) _base.content_id = window._papDlContentId; } catch (_) {}
    fetch('/api/downloads/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? ('Bearer ' + token) : '',
      },
      body: JSON.stringify(Object.assign(_base, payload || {})),
      keepalive: true,
    }).catch(function(){});
  } catch(_) {}
};

// 커버/로고 단일 파일 다운로드 헬퍼.
window._papDownloadAsFile = window._papDownloadAsFile || function(url, basename){
  window._papEnsureDlConsent().then(function(ok){
    if (!ok) return;
    try {
      fetch(url, { mode: 'cors' })
        .then(function(r){ return r.blob(); })
        .then(function(blob){
          var ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
          if (ext === 'jpeg') ext = 'jpg';
          var fname = window._papPersonalizeFilename(basename || 'pap-download', ext);
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          window._papLogDownload({
            content_type: 'cover',
            content_slug: basename || '',
            image_url: url,
            file_name: fname,
          });
          setTimeout(function(){
            URL.revokeObjectURL(a.href);
            a.remove();
          }, 3000);
        })
        .catch(function(e){
          console.warn('[pap download] failed:', e);
          window.open(url, '_blank');
        });
    } catch(_) {
      window.open(url, '_blank');
    }
  });
};

// QA #271 v2 — 갤러리 이미지에 PAP 로고 합성 후 ZIP 다운로드.
// 어드민 IG 생성기 (pap-admin.js)와 동일한 합성 알고리즘:
//   • 4:5 (1080×1350) 캔버스
//   • 갤러리 이미지 cover-fit 중앙
//   • PAP 로고: 15% 너비, 1% 하단 여백, 85% 투명도
// 2026-07-28 — 관리자가 인스타 편집 모달에서 조정한 값을 editorials.insta_logo_settings
// 에 영구 저장하게 되면서, 그 값이 있으면 회원 다운로드도 동일한 로고/프레이밍으로
// 합성한다(버튼의 data-logosettings 로 전달). 값이 없는 기존 글은 위 기본값 그대로.
/* 티어시트 PDF (2026-08-09 도메니코 최종 스펙) — "커버 이미지, 로고 이미지,
   타이틀, 설명글, 크레딧이 들어간 몇 페이지 분량의 PDF."
     1p  표지 — PAP 로고 · 커버 · 타이틀 · 이슈
     2p  타이틀 · 설명글 · 크레딧
     3p~ 로고 합성 갤러리 이미지 (한 장에 한 페이지)
   전부 브라우저 캔버스 → jsPDF. A4 150dpi(1240×1754) — 20페이지급 화보도
   PDF 용량이 감당되는 해상도. 페이지 캔버스는 그리는 즉시 JPEG 로 바꿔
   버린다 (모바일 메모리 보호). */
async function _papMakeTearsheetPdf(ts, logo, JsPDF, onProgress){
  var W = 1240, H = 1754, M = 90;
  var FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  function newPage(){
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, W, H);
    x.textAlign = 'center';
    return { cv: cv, x: x };
  }
  function footer(x){
    try { x.letterSpacing = '3px'; } catch(_){}
    x.font = '700 19px ' + FONT;
    x.fillStyle = '#666666';
    x.fillText('PAP MAGAZINE \u00b7 WWW.PAP-MAGAZINE.COM', W / 2, H - 54);
  }
  function loadImg(url){
    return new Promise(function(res){
      if (!url) return res(null);
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function(){ res(im); };
      im.onerror = function(){
        var fb = new Image();
        fb.onload = function(){ res(fb); };
        fb.onerror = function(){ res(null); };
        fb.src = url;
      };
      im.src = url;
    });
  }
  /* 원본 비율 유지(contain)로 그리고 그린 사각형을 돌려준다 */
  function drawContain(x, img, top, maxW, maxH){
    var sc = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    var dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    var dx = W / 2 - dw / 2, dy = top + (maxH - dh) / 2;
    x.drawImage(img, dx, dy, dw, dh);
    return { x: dx, y: dy, w: dw, h: dh };
  }
  /* 한국어(공백 없는 줄)도 끊기는 글자 단위 그리디 줄바꿈 */
  function wrapText(x, text, maxW){
    var lines = [], line = '';
    var chars = String(text || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < chars.length; i++){
      var test = line + chars[i];
      if (x.measureText(test).width > maxW && line) {
        var sp = line.lastIndexOf(' ');
        if (sp > line.length * 0.6) { lines.push(line.slice(0, sp)); line = line.slice(sp + 1) + chars[i]; }
        else { lines.push(line); line = chars[i]; }
      } else line = test;
    }
    if (line.trim()) lines.push(line);
    return lines;
  }
  function fitTitle(x, txt, maxPx, maxW){
    var f = maxPx;
    x.font = '700 ' + f + 'px ' + FONT;
    while (f > 30 && x.measureText(txt).width > maxW) {
      f -= 4; x.font = '700 ' + f + 'px ' + FONT;
    }
    return f;
  }
  var doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  var pageCount = 0;
  function commit(cv){
    var du;
    try { du = cv.toDataURL('image/jpeg', 0.85); }
    catch(e){ console.warn('[tearsheet] canvas tainted:', e); return false; }
    if (pageCount > 0) doc.addPage();
    doc.addImage(du, 'JPEG', 0, 0, 210, 297);
    pageCount++;
    return true;
  }
  var titleTxt = String(ts.title || '').toUpperCase().slice(0, 60);
  var g = Array.isArray(ts.gallery) ? ts.gallery : [];
  var total = 2 + g.length;

  // ── 1p 표지 — 확정 커버 디자인 단독 (2026-08-10 도메니코 최종) ──
  //    관리자 "매거진 커버 자동 생성"으로 확정한 디자인에는 PAP 마스트헤드·
  //    제목·컨트리뷰터 라인이 이미 박혀 있다. 그래서 여기서는 아무것도
  //    덧그리지 않는다 — 잘림 없이(contain) 적당한 여백으로 중앙 배치만.
  if (onProgress) try { onProgress(1, total); } catch(_){}
  var p1 = newPage();
  var coverImg = await loadImg(ts.cover);
  if (coverImg) {
    // 2026-08-10 도메니코: "적당한 크기로 줄여줘" — 여백을 넉넉히.
    // contain 이라 어차피 잘리지 않지만, 시각적으로도 여유 있게 84% 폭.
    var cAreaTop = 150, cAreaH = H - cAreaTop - 240, cAreaW = Math.round(W * 0.84) - 2 * M;
    var csc = Math.min(cAreaW / coverImg.naturalWidth, cAreaH / coverImg.naturalHeight);
    var cdw = coverImg.naturalWidth * csc, cdh = coverImg.naturalHeight * csc;
    p1.x.drawImage(coverImg, (W - cdw) / 2, cAreaTop + (cAreaH - cdh) / 2, cdw, cdh);
  }
  footer(p1.x);
  if (!commit(p1.cv)) return null;

  // ── 2p 타이틀 · 설명글 · 크레딧 ──────────────────────────
  if (onProgress) try { onProgress(2, total); } catch(_){}
  var p2 = newPage();
  var lw2 = W * 0.09, lh2 = lw2 * (logo.naturalHeight / logo.naturalWidth);
  p2.x.drawImage(logo, W / 2 - lw2 / 2, 96, lw2, lh2);
  var y = 96 + lh2 + 96;
  try { p2.x.letterSpacing = '8px'; } catch(_){}
  p2.x.fillStyle = '#ffffff';
  fitTitle(p2.x, titleTxt, 54, W - 2 * M);
  p2.x.fillText(titleTxt, W / 2, y);
  y += 46;
  if (ts.issue) {
    try { p2.x.letterSpacing = '5px'; } catch(_){}
    p2.x.font = '400 24px ' + FONT;
    p2.x.fillStyle = '#9a9a9a';
    p2.x.fillText(String(ts.issue).toUpperCase(), W / 2, y);
    y += 40;
  }
  y += 22;
  p2.x.strokeStyle = 'rgba(255,255,255,.25)'; p2.x.lineWidth = 1;
  p2.x.beginPath(); p2.x.moveTo(W / 2 - 150, y); p2.x.lineTo(W / 2 + 150, y); p2.x.stroke();
  y += 64;
  // 설명글
  if (ts.desc && typeof ts.desc === 'string' && ts.desc.indexOf('[object') < 0) {
    try { p2.x.letterSpacing = '0px'; } catch(_){}
    p2.x.font = '400 25px ' + FONT;
    p2.x.fillStyle = '#d8d8d8';
    var lines = wrapText(p2.x, ts.desc, W - 2 * M - 120);
    var maxDescLines = Math.max(4, Math.floor((H - y - 620) / 42));
    if (lines.length > maxDescLines) { lines = lines.slice(0, maxDescLines); lines[lines.length - 1] += '\u2026'; }
    for (var li = 0; li < lines.length; li++){ p2.x.fillText(lines[li], W / 2, y); y += 42; }
    y += 46;
  }
  // 크레딧
  var creds = Array.isArray(ts.credits) ? ts.credits : [];
  for (var ci = 0; ci < creds.length && y < H - 150; ci++){
    try { p2.x.letterSpacing = '3px'; } catch(_){}
    p2.x.font = '700 20px ' + FONT;
    p2.x.fillStyle = '#8a8a8a';
    p2.x.fillText(String(creds[ci].r || '').toUpperCase(), W / 2, y);
    p2.x.font = '400 27px ' + FONT;
    p2.x.fillStyle = '#f0f0f0';
    p2.x.fillText(String(creds[ci].n || '').slice(0, 60), W / 2, y + 32);
    y += 86;
  }
  footer(p2.x);
  if (!commit(p2.cv)) return null;

  // ── 3p~ 갤러리 — 한 페이지 4장 (2×2), 무로고 원본 ──
  //    패션 크레딧 전부 표기 (2026-08-10 도메니코: "이미지 위에 일정 부분
  //    글자가 올라가도 괜찮으니 전부 채워줘") — 이미지 하단에 가독성
  //    배경을 깔고 여러 줄로 오버레이.
  var perPage = 4, gap = 34;
  var cellW = (W - 2 * M - gap) / 2;
  var cellH = (H - 2 * M - gap - 40) / 2;
  function drawCell(x, img, cap, cx0, cy0){
    var sc = Math.min(cellW / img.naturalWidth, cellH / img.naturalHeight);
    var dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    var dx = cx0 + (cellW - dw) / 2, dy = cy0 + (cellH - dh) / 2;
    x.drawImage(img, dx, dy, dw, dh);
    if (cap) {
      try { x.letterSpacing = '0.5px'; } catch(_){}
      x.font = '400 15px ' + FONT;
      var lines = wrapText(x, String(cap), dw - 20);
      if (lines.length > 5) { lines = lines.slice(0, 5); lines[4] += '\u2026'; }
      var lh = 21, pad = 10;
      var boxH = lines.length * lh + pad * 2 - 4;
      x.fillStyle = 'rgba(0,0,0,.55)';
      x.fillRect(dx, dy + dh - boxH, dw, boxH);
      x.fillStyle = '#f2f2f2';
      for (var li = 0; li < lines.length; li++){
        x.fillText(lines[li], dx + dw / 2, dy + dh - boxH + pad + 12 + li * lh);
      }
    }
  }
  var caps = Array.isArray(ts.imageCredits) ? ts.imageCredits : [];
  var totalPages = 2 + Math.ceil(g.length / perPage);
  for (var pi = 0; pi < g.length; pi += perPage){
    if (onProgress) try { onProgress(3 + Math.floor(pi / perPage), totalPages); } catch(_){}
    var cells = [];
    for (var k = pi; k < Math.min(pi + perPage, g.length); k++){
      var im = await loadImg(g[k]);
      if (im) cells.push({ im: im, cap: caps[k] || '' });
    }
    if (!cells.length) continue;
    var pg = newPage();
    for (var ii = 0; ii < cells.length; ii++){
      var col = ii % 2, row = Math.floor(ii / 2);
      drawCell(pg.x, cells[ii].im, cells[ii].cap, M + col * (cellW + gap), M + row * (cellH + gap));
    }
    footer(pg.x);
    if (!commit(pg.cv)) return null;
  }
  if (!pageCount) return null;
  return doc.output('blob');
}

/* 티어시트 PDF 단독 다운로드 (2026-08-09 도메니코) — 로고 ZIP 버튼 옆.
   같은 게이트(회원 + 약관 동의)와 같은 다운로드 이력 로깅을 쓴다. */
window._papDownloadTearsheet = async function(btn){
  var statusEl = document.getElementById('edLogoDlStatus');
  function _s(msg, color){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (color) statusEl.style.color = color;
  }
  var agreed = await window._papEnsureDlConsent();
  if (!agreed) return;
  var _JsPDF = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
  if (!_JsPDF) { _s('❌ PDF 라이브러리 로드 실패 — 페이지를 새로고침해주세요.', '#c62828'); return; }
  var ts = null;
  try { ts = JSON.parse(decodeURIComponent(btn.getAttribute('data-tearsheet') || '')); } catch (_) {}
  if (!ts) { _s('❌ 티어시트 데이터가 없습니다.', '#c62828'); return; }
  var safeTitle = btn.getAttribute('data-title') || 'editorial';
  btn.disabled = true;
  var originalLabel = btn.textContent;
  btn.style.opacity = '.6';
  btn.textContent = '📄 생성 중…';
  _s('티어시트 PDF 생성 중…');
  try {
    var logo = await new Promise(function(res, rej){
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function(){ res(img); };
      img.onerror = function(){
        var fb = new Image();
        fb.onload = function(){ res(fb); };
        fb.onerror = function(){ rej(new Error('로고 로드 실패')); };
        fb.src = '/pap-logo-white.png';
      };
      img.src = '/pap-logo-white.png';
    });
    var blob = await _papMakeTearsheetPdf(ts, logo, _JsPDF, function(i, n){
      btn.textContent = '\ud83d\udcc4 ' + i + '/' + n + ' \ud398\uc774\uc9c0\u2026';
      _s('\ud2f0\uc5b4\uc2dc\ud2b8 ' + i + '/' + n + ' \ud398\uc774\uc9c0 \uc0dd\uc131 \uc911\u2026');
    });
    if (!blob) throw new Error('PDF 생성 실패 (커버 CORS 가능성)');
    var personalizedName = window._papPersonalizeFilename(safeTitle + '-tearsheet', 'pdf');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = personalizedName;
    document.body.appendChild(a);
    a.click();
    window._papLogDownload({
      content_type: 'editorial-tearsheet',
      content_slug: safeTitle,
      file_name: personalizedName,
    });
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    _s('✓ 티어시트 다운로드 완료', '#16a34a');
  } catch (e) {
    _s('❌ 티어시트 생성 실패: ' + (e && e.message || e), '#c62828');
  }
  btn.disabled = false;
  btn.textContent = originalLabel;
  btn.style.opacity = '1';
};

window._papDownloadLogoZip = window._papDownloadLogoZip || async function(btn){
  if (!btn) return;
  var statusEl = document.getElementById('edLogoDlStatus');
  function _s(msg, color){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (color) statusEl.style.color = color;
  }
  // QA #277 — 약관 동의 (1회).
  var agreed = await window._papEnsureDlConsent();
  if (!agreed) return;
  if (typeof JSZip === 'undefined') {
    _s('❌ ZIP 라이브러리 로드 실패 — 페이지를 새로고침해주세요.', '#c62828');
    return;
  }
  var gallery;
  try {
    gallery = JSON.parse(decodeURIComponent(btn.getAttribute('data-gallery') || '[]'));
  } catch (_) { gallery = []; }
  var safeTitle = btn.getAttribute('data-title') || 'editorial';
  if (!gallery.length) {
    _s('갤러리 이미지가 없습니다.', '#c62828');
    return;
  }

  btn.disabled = true;
  var originalLabel = btn.textContent;
  btn.style.opacity = '.6';
  _s('PAP 로고 로드 중…');

  // 1) 로고를 한 번만 로드해서 재사용.
  var logo;
  try {
    logo = await new Promise(function(res, rej){
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function(){ res(img); };
      img.onerror = function(){
        // crossOrigin 없이 재시도
        var fb = new Image();
        fb.onload = function(){ res(fb); };
        fb.onerror = function(){ rej(new Error('로고 로드 실패')); };
        fb.src = '/pap-logo-white.png';
      };
      img.src = '/pap-logo-white.png';
    });
  } catch (e) {
    _s('❌ PAP 로고 로드 실패: ' + (e && e.message || e), '#c62828');
    btn.disabled = false; btn.textContent = originalLabel; btn.style.opacity = '1';
    return;
  }

  // 2) 각 갤러리 이미지를 합성.
  // QA #278 — 원본 비율 그대로 유지. 4:5 강제 crop 제거 (피사체 잘림 방지).
  // 출력 규격 — 관리자 '전체 ZIP'과 동일한 4:5 + 로고. 크기는 아래 루프에서
  // 원본 기준으로 계산(HD, 상한 2160×2700 / 하한 1080×1350).
  // 로고 기본값은 관리자 슬라이더 기본값과 같은 값이며, 저장된 설정이 있으면
  // 아래에서 그 값으로 덮인다.
  var LOGO_PCT = 15, PAD_PCT = 1, ALPHA = 0.85;

  // 2026-07-28 — 관리자가 인스타 편집 모달에서 저장한 설정(있으면) 적용.
  // 우선순위: 이미지별 개별값 → 전역값 → 위 기본값(= 종전 동작).
  // 설정이 없거나 파싱 실패면 아래 상수만 쓰이므로 결과는 이전과 완전히 동일하다.
  var _ls = null;
  try {
    var _lsRaw = btn.getAttribute('data-logosettings') || '';
    if (_lsRaw) _ls = JSON.parse(decodeURIComponent(_lsRaw));
  } catch (_) { _ls = null; }
  if (!_ls || typeof _ls !== 'object' || Array.isArray(_ls)) _ls = null;
  var _g   = (_ls && _ls.global   && typeof _ls.global   === 'object') ? _ls.global   : {};
  var _per = (_ls && _ls.perImage && typeof _ls.perImage === 'object') ? _ls.perImage : {};
  // 숫자만 인정(문자열·NaN 은 폴백). 관리자 합성 함수와 같은 판정 기준.
  function _num(v, fallback){
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  // 출력 비율 — 전역 설정만 따른다(이미지별 비율 조정은 관리자 UI에도 없다).
  var AR = (_g.aspect === '1:1') ? 1 : (4 / 5);   // 가로/세로

  var zip = new JSZip();
  var ok = 0, failed = 0;

  for (var i = 0; i < gallery.length; i++){
    var url = gallery[i];
    btn.textContent = '🎨 합성 중 ' + (i + 1) + '/' + gallery.length + '…';
    _s((i + 1) + '/' + gallery.length + '장 합성 중…');
    try {
      var srcImg = await new Promise(function(res, rej){
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function(){ res(im); };
        im.onerror = function(){
          var fb = new Image();
          fb.onload = function(){ res(fb); };
          fb.onerror = function(){ rej(new Error('이미지 로드 실패: ' + url)); };
          fb.src = url;
        };
        im.src = url;
      });
      // 2026-07-28 (도메니코 지시) — 회원 다운로드를 관리자 '전체 ZIP'과 같은
      // 규격으로 맞추되 해상도는 HD 로 유지한다.
      //   · 구도: 관리자 _papInstaCompositeOne 과 동일한 4:5 cover-crop
      //     (scale = max(W/iw, H/ih), 중앙 정렬) + 같은 로고 기본값(15%/1%/85%).
      //   · 해상도: 관리자 ZIP 의 1080×1350 은 인스타 업로드 규격일 뿐이라
      //     그대로 쓰면 화질이 떨어진다. 원본에서 잘라낼 수 있는 최대 4:5 영역을
      //     구해 그 크기로 렌더하고(업스케일 금지) 상한 2160×2700, 하한
      //     1080×1350 을 둔다 → 관리자 ZIP 과 같은 그림, 최대 2배 해상도.
      // ※ QA #278 은 피사체 잘림을 우려해 4:5 crop 을 뺐던 이력이 있다. 이번엔
      //   '관리자 ZIP 과 동일한 결과물' 요구가 우선이라 crop 을 되살린다.
      //   잘림이 문제가 되면 이 블록만 되돌리면 된다.
      var iw = srcImg.naturalWidth, ih = srcImg.naturalHeight;
      // 원본에서 확보 가능한 최대 박스 (업스케일 없이). 4:5 → 최대 2160×2700,
      // 1:1 → 최대 2160×2160, 하한은 1080 기준.
      var boxW = (iw / ih > AR) ? ih * AR : iw;
      var W = Math.round(Math.max(1080, Math.min(2160, boxW)));
      var H = Math.round(W / AR);           // 4:5 → W*1.25, 1:1 → W
      // 2026-07-28 — 이 이미지의 실효 설정(개별 → 전역 → 기본값).
      var _o = (_per && _per[url] && typeof _per[url] === 'object') ? _per[url] : {};
      var _logoPct   = _num(_o.logoPct,   _num(_g.logoPct, LOGO_PCT));
      var _padPct    = _num(_o.padPct,    _num(_g.padPct,  PAD_PCT));
      var _imgScale  = _num(_o.imgScale,  100);
      var _offsetX   = _num(_o.offsetX,   0);
      var _offsetY   = _num(_o.offsetY,   0);
      var _alpha     = _num(_o.logoAlpha, ALPHA * 100) / 100;
      var _logoOn    = (_o.logoEnabled === false) ? false : true;
      if (!(_imgScale > 0)) _imgScale = 100;
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, W, H);
      // cover-crop — 관리자 _papInstaCompositeOne 과 동일 수식
      // (배율 imgScale%, 오프셋은 캔버스 크기 대비 %).
      var _scale = Math.max(W / iw, H / ih) * (_imgScale / 100);
      var _dw = iw * _scale, _dh = ih * _scale;
      var _dx = (W - _dw) / 2 + (_offsetX / 100) * W;
      var _dy = (H - _dh) / 2 + (_offsetY / 100) * H;
      ctx.drawImage(srcImg, _dx, _dy, _dw, _dh);
      // 로고 합성 (너비의 _logoPct% 기준, 하단 _padPct% 여백).
      // 관리자와 동일하게 logoEnabled === false 면 로고를 그리지 않는다
      // (원본에 이미 워터마크가 박힌 이미지 대응).
      if (_logoOn) {
        var logoW = W * (_logoPct / 100);
        var logoH = logoW * (logo.naturalHeight / logo.naturalWidth);
        var prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = Math.max(0, Math.min(1, _alpha));
        ctx.drawImage(logo, (W - logoW) / 2, H - logoH - (H * (_padPct / 100)), logoW, logoH);
        ctx.globalAlpha = prevAlpha;
      }
      // PNG blob 추출 → zip 추가
      var blob = await new Promise(function(res){ canvas.toBlob(function(b){ res(b); }, 'image/png', 0.95); });
      if (!blob) throw new Error('canvas tainted by CORS');
      var fname = safeTitle + '-' + String(i + 1).padStart(2, '0') + '.png';
      zip.file(fname, blob);
      ok++;
    } catch (e) {
      console.warn('[logo zip] image ' + (i + 1) + ' failed:', e);
      failed++;
    }
  }

  if (!ok) {
    _s('❌ 모든 이미지 합성 실패. CORS 또는 네트워크 오류일 수 있습니다.', '#c62828');
    btn.disabled = false; btn.textContent = originalLabel; btn.style.opacity = '1';
    return;
  }

  btn.textContent = '📦 ZIP 생성 중…';
  _s('ZIP 생성 중…');
  try {
    var zipBlob = await zip.generateAsync({ type: 'blob' });
    // QA #277 — 회원 식별자가 포함된 파일명.
    var personalizedName = window._papPersonalizeFilename(safeTitle + '-logo-zip', 'zip');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = personalizedName;
    document.body.appendChild(a);
    a.click();
    // QA #277 — 다운로드 이력 로깅 (fire-and-forget).
    window._papLogDownload({
      content_type: 'editorial-zip',
      content_slug: safeTitle,
      file_name: personalizedName,
    });
    setTimeout(function(){
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 3000);
    _s('✓ 다운로드 완료 (성공 ' + ok + '장' + (failed ? ', 실패 ' + failed + '장' : '') + ')', '#16a34a');
  } catch (e) {
    _s('❌ ZIP 생성 실패: ' + (e && e.message || e), '#c62828');
  }

  btn.disabled = false;
  btn.textContent = originalLabel;
  btn.style.opacity = '1';
};

// 참여 증폭 2.0 (2026-07) — 원본 IG 게시물 임베드 + '친구에게 보내기'.
// 좋아요·저장·보내기 신호는 게시물 위에서만 발생하므로, 원본 게시물을
// 페이지 안에 직접 띄워 반응까지의 거리를 한 클릭으로 줄인다.
// igUrl 이 없으면 컨테이너를 숨긴다 (백필 전 대부분의 아카이브).
// 수익화 2.0 (2026-07) — SHOP THE STORY. 착장 브랜드(det.fashion 핸들 목록)를
// 구매 링크 행으로 렌더. 링크는 /go/<핸들> 리다이렉터를 거쳐 클릭이
// affiliate_clicks 에 기록되고, 지오 라우팅(KR 무신사/글로벌 파페치 폴백,
// 브랜드별 어필리에이트 URL 우선)으로 착지한다.
// 2단계 상품매칭 (2026-08-17) — 칩에 표기하고 ?item= 으로 넘겨도 되는 품목
// 화이트리스트. **URL 매핑의 단일 출처는 서버(api/_lib/affiliateUrl.js
// ITEM_CATEGORY_PATHS)** 이고, 이 목록은 그 부분집합(표시 게이트)만 담당한다.
// 서버 맵에 없는 단어는 여기 추가하지 말 것 — ?item= 이 무시돼 designer
// 루트로 가긴 하지만 칩 표기가 거짓말이 된다.
var _PAP_SHOP_ITEMS={dress:1,gown:1,top:1,tops:1,shirt:1,blouse:1,tshirt:1,pants:1,trousers:1,jeans:1,denim:1,skirt:1,shorts:1,jacket:1,blazer:1,coat:1,sweater:1,knitwear:1,cardigan:1,knit:1,bodysuit:1,corset:1,suit:1,swimsuit:1,swimwear:1,shoes:1,boots:1,heels:1,sneakers:1,sandals:1,pumps:1,loafers:1,bag:1,bags:1,handbag:1,clutch:1,earrings:1,necklace:1,ring:1,rings:1,bracelet:1,jewels:1,jewelry:1,hat:1,cap:1,belt:1,gloves:1,glasses:1,sunglasses:1,scarf:1,headpiece:1,tights:1,socks:1};
// imageCredits("@ralphlauren Top, ...") → {'#핸들소문자': '품목'}. '#' 키 접두는
// 위 _seen 과 같은 계열의 Object.prototype 이름 가드. 첫 등장 품목을 쓴다.
function _papShopItems(imageCredits){
  var out={};
  if(!imageCredits || typeof imageCredits!=='object') return out;
  Object.keys(imageCredits).forEach(function(k){
    String(imageCredits[k]||'').split(',').forEach(function(part){
      var m=part.match(/@([A-Za-z0-9._]+)\s+([A-Za-z-]{2,20})\s*$/);
      if(!m) return;
      var item=m[2].toLowerCase().replace(/[^a-z]/g,'');
      if(!Object.prototype.hasOwnProperty.call(_PAP_SHOP_ITEMS,item)) return;
      var key='#'+m[1].toLowerCase();
      if(!out[key]) out[key]=item;
    });
  });
  return out;
}
function _papRenderShopRow(fashion, imageCredits){
  var box=document.getElementById('edShopRow');
  if(!box) return;
  // 2026-08-05 — 중복 브랜드 제거(도메니코 지적: 라이브에서 holzweiler 칩 2회).
  // 크레딧이 룩별로 들어와 같은 브랜드가 여러 번 실리면 그대로 칩이 반복됐다.
  // 링크 목적지가 /go/<소문자> 라 '@holzweiler' 와 'holzweiler' 는 같은 곳으로
  // 가므로 같은 브랜드로 본다. 반드시 slice(0,12) '앞'에서 걸러야 중복이
  // 12칸을 잡아먹지 않는다. seen 키에 '#' 를 붙이는 건 'constructor' 같은
  // Object.prototype 이름이 브랜드로 와도 오탐하지 않게 하기 위함.
  var _seen={}, brands=[];
  (Array.isArray(fashion)?fashion:[]).forEach(function(h){
    var raw=String(h||'').trim();
    if(!raw || raw==='@brand') return;
    var clean=raw.replace(/^@+/,'');
    var key='#'+clean.toLowerCase();
    if(clean==='' || _seen[key]) return;
    _seen[key]=1; brands.push(clean);
  });
  if(!brands.length){ box.innerHTML=''; box.style.display='none'; return; }
  /* /go 는 브랜드 IG 핸들만 받는다. "Vintage military sailor hat" 같은
     옷 이름 크레딧이 /go/vintage%20military... 로 새어나가 GSC 에 깨진
     URL 10건이 잡혔다 (2026-08-10). 핸들 형태(영문·숫자·._ 2~30자)가
     아니면 SHOP THE STORY 에서 제외한다. */
  brands=brands.filter(function(c){return /^[a-z0-9._]{2,30}$/.test(c.toLowerCase());});
  if(!brands.length){ box.innerHTML=''; box.style.display='none'; return; }
  // 2단계 상품매칭 — 크레딧에 품목이 있으면 칩에 표기하고 /go 에 ?item= 전달
  var _items=_papShopItems(imageCredits);
  var chips=brands.slice(0,12).map(function(clean){
    var item=_items['#'+clean.toLowerCase()]||'';
    var q=item?'?item='+encodeURIComponent(item):'';
    var tail=item?(_edL9(item+' 구매 →','Shop '+item+' →')):(_edL9('구매 →','Shop →'));
    return '<a href="/go/'+encodeURIComponent(clean.toLowerCase())+q+'" target="_blank" rel="sponsored nofollow noopener" '
      +'style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;border:1px solid rgba(255,255,255,.25);font-size:12px;color:#fff;text-decoration:none;letter-spacing:.04em">'
      +clean.replace(/</g,'&lt;')+' <span style="opacity:.55">'+tail+'</span></a>';
  }).join('');
  box.innerHTML=
    '<div style="margin:36px 0 0;padding:24px;border:1px solid rgba(255,255,255,.16)">'
    +'<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:12px">Shop the Story</div>'
    +'<div>'+chips+'</div>'
    +'<div style="font-size:10.5px;color:#666;margin-top:8px">'+(_edL9('링크를 통해 구매 시 PAP에 수수료가 지급될 수 있습니다.','PAP may earn a commission on purchases made through these links.'))+'</div>'
    +'</div>';
  box.style.display='';
}

// 폴백 CTA 사회적 증거 (2026-07-16) — 팔로워 수는 대략치로 표기하고 성장 시
// 여기 한 곳만 갱신한다. (실시간 조회는 Graph API 호출 비용 대비 과함)
var _PAP_IG_FOLLOWERS_KO='38만';
var _PAP_IG_FOLLOWERS_EN='380K+';
// ─────────────────────────────────────────────────────────────────────
// 갤러리 중간 IG CTA (2026-07-29)
// ─────────────────────────────────────────────────────────────────────
// 왜: 실측(최근 10일) 결과 사람이 누르는 아웃클릭은 editorial 40 · article 23 ·
// nav/footer 30 수준으로 원래부터 낮았다("급감"이 아니라 처음부터 약함 — ssr
// 3,054건은 봇 스파이크였다). 원인 후보 1순위는 위치다: 기존 CTA 는 이미지
// 12장짜리 갤러리를 전부 내려야 나오는 맨 아래에만 있어, 중간에 이탈하는
// 독자에게는 존재하지 않는 것과 같았다.
// 무엇: 갤러리 중간(4번째 이미지 뒤)에 얇은 CTA 한 줄을 넣는다. 원본 게시물이
// 있는 화보에서만, 이미지가 6장 이상일 때만 — 짧은 화보는 하단 CTA 로 충분하고
// 두 번 나오면 성가시다.
// 카피: 도메니코 지적("너무 AI 멘트 느낌")을 존중해 새 문구를 만들지 않고
// 하단 CTA 와 같은 라벨만 쓴다. 광고 문구 없음.
// 측정: src=editorial_mid 로 분리 집계해 하단(editorial)과 비교 가능하게 한다.
/* 중간 IG 창을 옆 사진(갤러리 칸 4:5) 높이에 맞춰 축소 (2026-08-09).
   IG 임베드는 스크립트가 비동기로 높이를 잡고 재레이아웃도 하므로,
   ~10초 동안 주기적으로 실측해 scale 을 다시 건다. */
function _papFitMidIg(){
  var tries = 0;
  var timer = setInterval(function(){
    tries++;
    var wraps = document.querySelectorAll('.ed-mid-cta');
    if (!wraps.length) { if (tries > 4) clearInterval(timer); return; }
    for (var wi = 0; wi < wraps.length; wi++){
      var wrap = wraps[wi];
      var em = wrap.querySelector('iframe') || wrap.querySelector('.instagram-media');
      if (em && em.offsetHeight > 60 && wrap.clientHeight > 60) {
        var sc = Math.min(1, (wrap.clientHeight - 6) / em.offsetHeight);
        em.style.transformOrigin = 'center center';
        em.style.transform = (sc < 0.995) ? 'scale(' + sc.toFixed(4) + ')' : '';
      }
    }
    if (tries > 20) clearInterval(timer);
  }, 500);
}

function _papMidIgCtaHtml(igUrl){
  /* 2026-08-09 도메니코 — "필수로 모든 에디토리얼에 + 텍스트 버튼이 아니라
     아래에 있던 인스타그램 창으로." 원본 게시물이 있으면 갤러리 중간에
     실제 IG 임베드 창을 띄운다 (하단과 같은 창 — 하단은 중복 방지를 위해
     임베드를 접고 퍼널 CTA 만 남김). 원본이 없는 아카이브 화보는 임베드가
     불가능하므로 프로필로 보내는 얇은 CTA 폴백 (src=editorial_mid 계측 유지). */
  var permalink = String(igUrl || '').split('?')[0];
  var canEmbed = /instagram\.com\/(p|reel|tv)\//.test(permalink);
  if (canEmbed) {
    if (!/\/$/.test(permalink)) permalink += '/';
    /* 크기 규칙 (2026-08-09 도메니코 최종: "세로를 옆 사진 길이에 맞추고
       가로는 줄어도 됨") — 갤러리 칸의 4:5 비율을 그대로 쓰고(옆 사진과
       같은 높이), IG 스크립트가 창을 다 그린 뒤 _papFitMidIg 가 칸 높이에
       맞춰 축소한다. 게시물마다(캐러셀·릴스) 창 높이가 달라 CSS 만으로는
       못 맞춘다 — 실측 후 scale 이 유일하게 확실한 방법. */
    return '<div class="ed-gallery-item ed-mid-cta" style="display:flex;align-items:center;justify-content:center;overflow:hidden;background:transparent">'
         + '<blockquote class="instagram-media" data-instgrm-permalink="' + permalink.replace(/"/g,'&quot;') + '" data-instgrm-version="14" style="background:#000;border:1px solid rgba(255,255,255,.16);margin:0 auto;max-width:400px;min-width:240px;width:100%"></blockquote>'
         + '</div>';
  }
  var ko = (localStorage.getItem('pap-lang') || 'ko') === 'ko';
  var label = ko ? '인스타그램에서 보기 ↗' : 'View on Instagram ↗';
  var out = '/api/ig-out?src=editorial_mid&to=profile&url=' + encodeURIComponent('https://www.instagram.com/pap_magazine/');
  return '<div class="ed-gallery-item ed-mid-cta" style="display:flex;align-items:center;justify-content:center;padding:22px 16px;border-top:1px solid rgba(255,255,255,.14);border-bottom:1px solid rgba(255,255,255,.14)">'
       + '<a href="' + out + '" target="_blank" rel="noopener" '
       + 'style="display:inline-block;color:#fff;border:1px solid rgba(255,255,255,.4);padding:11px 26px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none">'
       + label + '</a></div>';
}

function _papRenderEdIg(igUrl, title){
  /* 2026-08-10 도메니코: "에디토리얼에서는 이걸(하단 On Instagram 퍼널) 빼자."
     IG 창은 갤러리 중간(상한 2개, 왼/오 칸)으로 옮겨졌고 하단 박스(임베드
     + On Instagram 퍼널 / 원본 없음 폴백)는 접는다. 이 함수는 이제 중간
     임베드 처리(스크립트 로드 + 옆 사진 높이 맞춤)만 담당한다.
     div(#edIgPostCta)는 다른 코드의 getElementById 방어를 위해 남긴다. */
  var box=document.getElementById('edIgPostCta');
  if(box){ box.innerHTML=''; box.style.display='none'; }
  var canEmbed=/instagram\.com\/(p|reel|tv)\//.test(String(igUrl||'').split('?')[0]);
  // 2026-08-17 성능 — 임베드는 갤러리 중간이라 첫 화면과 무관. 뷰포트에
  // 가까워질 때만 embed.js 를 로드한다 (_papLazyIgEmbed, 폴백=즉시 로드).
  if(canEmbed){
    var midEl=document.querySelector('.ed-mid-cta');
    if(typeof _papLazyIgEmbed==='function'){try{_papLazyIgEmbed(midEl||document.body);}catch(_){}}
    else if(typeof _papLoadIgEmbed==='function'){try{_papLoadIgEmbed();}catch(_){}}
  }
  try{_papFitMidIg();}catch(_){}
}

function _renderEditorialTags(title){
  var tagsEl = document.getElementById('edDetailTags');
  if (!tagsEl) return;
  var titleLower = String(title || '').toLowerCase();
  var found = null;
  for (var i = 0; i < edData.length; i++){
    if (String(edData[i].title || '').toLowerCase() === titleLower){
      found = edData[i]; break;
    }
  }
  var rawTags = found && found.tags;
  var tagArr = Array.isArray(rawTags)
    ? rawTags
    : (typeof rawTags === 'string' ? rawTags.split(',') : []);
  tagArr = tagArr.map(function(t){ return String(t).trim(); }).filter(Boolean);
  // 예약 태그(`pap:` 접두)는 운영 전용 플래그(예: pap:pin-ok) — 독자에게 노출 금지.
  tagArr = tagArr.filter(function(t){ return !/^pap:/i.test(String(t).replace(/^#/,'').trim()); });
  if (!tagArr.length){
    tagsEl.innerHTML = '';
    tagsEl.style.display = 'none';
    return;
  }
  // QA #326 — Route tag clicks to the unified /search page so the results
  // grid spans editorials + articles (not just articles). Old /articles?tag=
  // links only surfaced tag-matched articles; the unified page also shows
  // editorials that carry the same tag/category, matching the QA expectation
  // of "이 태그의 콘텐츠 전부".
  tagsEl.innerHTML = tagArr.map(function(t){
    return '<a class="art-tag-chip" href="/search?tag=' +
      encodeURIComponent(t) + '">#' + escapeHtml(t) + '</a>';
  }).join('');
  tagsEl.style.display = '';
}

function _renderRelatedFilms(films){
  var wrap = document.getElementById('edDetailRelatedFilms');
  var list = document.getElementById('edDetailRelatedFilmsList');
  if (!wrap || !list) return;
  list.innerHTML = '';
  wrap.hidden = true;
  if (!Array.isArray(films) || films.length === 0) return;
  films.forEach(function(f){
    if (!f || !f.title) return;
    var slug = f.slug || f.id || '';
    if (!slug) return;
    // Use the film's own thumbnail, falling back to its YouTube poster
    // when the row never had a thumbnail_url uploaded (legacy migration).
    var thumb = f.thumbnail_url
      || (f.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(f.youtube_id)
            ? 'https://img.youtube.com/vi/' + f.youtube_id + '/hqdefault.jpg'
            : '');
    var safeTitle = String(f.title).replace(/"/g,'&quot;');
    var safeThumb = String(thumb).replace(/"/g,'&quot;');
    var href = '/film/' + encodeURIComponent(slug);
    list.insertAdjacentHTML('beforeend',
      '<a class="ed-related-film-card" href="'+href+'">'
        + '<div class="ed-related-film-thumb" style="background-image:url(\''+safeThumb+'\')"></div>'
        + '<div class="ed-related-film-info">'
          + '<div class="ed-related-film-tagline">FILM</div>'
          + '<div class="ed-related-film-title">'+escapeHtml(String(f.title))+'</div>'
        + '</div>'
      + '</a>');
  });
  wrap.hidden = false;
}

function _openEditorialInner(title,thumb){
  try{ window.__papOpenEd={t:title,th:thumb}; }catch(e){}
  // QA #239 v2 — collapse any other active overlay (film detail, article
  // detail, list overlays, …) before opening this one. Stops layer
  // stacking when the user jumps between content types via in-overlay
  // links (e.g. RELATED FILMS card inside an editorial → film detail
  // used to open ON TOP of the editorial).
  try { if(typeof _papCloseOtherOverlays === 'function') _papCloseOtherOverlays('edOverlay'); } catch(_){}
  var d=edDetails[title];
  if(!d){var titleLower=title.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===titleLower){d=edDetails[key];break;}}}
  d=d||{};

  // QA #227 — content fallback. When the matched entry has no gallery,
  // no credits, no description (any locale) and we *do* know the DB id,
  // the row most likely came in via a thin static-snapshot path or a
  // partially-cached list response. Fetch the full row once and re-render
  // through the no-push path so back/forward history stays correct.
  // The first paint still happens immediately below, so the user never
  // stares at a blank overlay while the fetch is in flight.
  try {
    var _imgs = Array.isArray(d.images) ? d.images.length : 0;
    var _credsArr = Array.isArray(d.credits) ? d.credits : [];
    var _hasDesc = (function(){
      var x = d.desc;
      if(!x) return false;
      if(typeof x === 'string') return !!x.trim();
      if(typeof x === 'object') return !!(x.ko || x.en);
      return false;
    })();
    /* 2026-08-21 — 이미지가 없으면 무조건 상세를 부른다.
     * 열람 게이트가 생기면서 공개 목록(엣지 캐시)은 gallery 를 아예 싣지 않는다.
     * 이미지를 내주는 곳은 상세 API 하나뿐인데, 종전 조건('이미지·크레딧·설명이
     * 셋 다 없을 때만')이면 크레딧이나 설명이 있는 화보는 상세를 영영 안 부르고
     * 빈 갤러리만 남는다. 잠긴 화보인지 아닌지도 알 수 없게 된다. */
    /* 목록이 gallery 를 안 싣게 되면서 카탈로그의 images 는 '표지 1장' 으로
     * 채워진다. 그래서 '이미지가 0장일 때만' 으로는 부족하다 — 1장이면
     * 하이드레이트가 안 돌아 표지 한 장짜리 화보가 되고, 잠긴 화보인지도
     * 알 수 없다. gallery_count 를 같이 보고, 없으면 1장 이하는 무조건 부른다. */
    var _galCount = Number((d && d.galleryCount) || 0);
    var _needsHydrate = (_imgs <= 1) || (_galCount > _imgs) || (_credsArr.length === 0 && !_hasDesc);
    // 2026-07-26 — 다국어: 활성 언어가 ko가 아니고 해당 언어 요약이 없고 아직
    // 하이드레이트 안 했으면 상세 GET 으로 description_i18n 을 당겨온다(1회).
    var _edL2 = (function(){try{return localStorage.getItem('pap-lang')||'ko';}catch(e){return 'ko';}})();
    var _edDetC = (typeof edDetails!=='undefined' && edDetails[title]) || {};
    var _edNeedTr = (_edL2!=='ko' && d.id && !_edDetC._i18nHydrated && !(d.desc && typeof d.desc==='object' && d.desc[_edL2]));
    // 2026-08-08 — IG 임베드가 에디토리얼에서 안 뜨던 진짜 이유.
    // 임베드 코드(_papRenderEdIg)는 이미 있었지만, det.ig 를 채우는 상세 GET 이
    // "이미지·크레딧·설명이 전부 없을 때"만 나갔다. 대부분의 화보는 로컬
    // 카탈로그에 셋 다 있어서 fetch 자체가 안 나갔고, source_instagram_url 이
    // 영영 병합되지 않아 임베드 대신 폴백 CTA 만 떴다. ig 가 없으면 한 번은
    // 물어보고, 응답을 받으면 _igChecked 로 표시해 (원본 IG 가 정말 없는
    // 화보를) 매번 다시 묻지 않는다.
    var _edNeedIg = (!d.ig && !_edDetC._igChecked);
    if((_needsHydrate || _edNeedTr || _edNeedIg) && d.id){
      var _t = '';
      try { _t = localStorage.getItem('pap-token') || ''; } catch(_){}
      var _h = {};
      if(_t) _h['Authorization'] = 'Bearer ' + _t;
      fetch('/api/editorials/' + encodeURIComponent(d.id), {
        headers: _h,
        credentials:'include'
      })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var full = j && (j.data || j.editorial);
        if(!full) return;
        /* 2026-08-21 — 열람 게이트. 서버가 잠갔다고 하면 그 사실을 카탈로그에
         * 남긴다. 이걸 안 남기면 다음 열람 때 캐시된 빈 갤러리만 보이고
         * 사람은 왜 안 보이는지 알 수 없다. */
        var _acc = j && j.access;
        var dstLocked = !!(_acc && _acc.allowed === false);
        // Merge the rich fields back onto edDetails[title] so subsequent
        // opens hit the populated cache.
        var dst = edDetails[title] || {};
        if(dstLocked){
          dst.locked = true;
          dst.requiredTier = (_acc && _acc.required_tier) || 'free';
          dst.galleryCount = Number(full.gallery_count || 0);
        } else {
          dst.locked = false;
        }
        dst.id    = full.id || dst.id || '';
        dst.slug  = full.slug || dst.slug || '';
        dst.thumb = dst.thumb || full.cover_image || full.thumbnail || full.thumbnail_url || '';
        if(Array.isArray(full.gallery) && full.gallery.length) dst.images = full.gallery;
        else if(!dst.images || !dst.images.length) dst.images = dst.thumb ? [dst.thumb] : [];
        if(Array.isArray(full.credits) && full.credits.length){
          if(typeof _normalizeCreditsForDisplay === 'function'){
            dst.credits = _normalizeCreditsForDisplay(full.credits);
          } else { dst.credits = full.credits; }
        }
        if(full.fashion && Array.isArray(full.fashion.brands)){
          dst.fashion = full.fashion.brands.map(function(b){ return b.instagram || b.name || ''; }).filter(Boolean);
          if(full.fashion.imageCredits && typeof full.fashion.imageCredits === 'object'){
            dst.imageCredits = full.fashion.imageCredits;
          }
        }
        var ko = full.description || '';
        var en = full.description_en || '';
        // 2026-07-26 — seo_translations 요약 다국어 병합(있으면 it/fr/es/ja 등 포함).
        var _diMap = (full.description_i18n && typeof full.description_i18n==='object') ? full.description_i18n : null;
        if(ko || en || _diMap) dst.desc = Object.assign({ ko: ko, en: en }, _diMap || {});
        dst._i18nHydrated = true;
        // QA #231 — pass related_films through too so the "RELATED FILMS"
        // section appears when the fallback fetch is the path that hydrates
        // the editorial (otherwise the editor would see the films on a
        // direct /editorial/<slug> reload but not on an in-app overlay).
        if(Array.isArray(full.related_films)) {
          dst.relatedFilms = full.related_films;
        }
        // 참여 증폭 2.0 — 원본 IG 게시물 permalink.
        if(full.source_instagram_url) dst.ig = full.source_instagram_url;
        dst._igChecked = true; // 2026-08-08 — 응답을 받았으면 (ig 유무와 무관하게) 재요청 안 함
        // 2026-07-28 — 관리자가 저장한 인스타 합성 설정(로고/프레이밍).
        if(full.insta_logo_settings && typeof full.insta_logo_settings === 'object'){
          dst.instaLogoSettings = full.insta_logo_settings;
        }
        edDetails[title] = dst;
        // Re-render through the no-push path so we don't push a duplicate
        // history entry on top of the one we already pushed below.
        if(typeof _openEditorialInner_noPush === 'function'){
          _openEditorialInner_noPush(title, thumb);
        }
      })
      .catch(function(){ /* non-fatal */ });
    }
  } catch(_){ /* never block the open path */ }

  // Fire-and-forget view tracking. Powers the "인기 에디토리얼" row via
  // GET /api/editorials/trending. Skipped for static-snapshot entries
  // that have no DB id — those can't be tracked yet (admin uploads
  // produce DB rows that DO have an id, so freshly uploaded editorials
  // surface in trending immediately once they get any opens).
  // Also skipped on popstate restoration (_openEditorialInner_noPush)
  // so browser-back doesn't double-count.
  if(d && d.id){
    try {
      /* 2026-08-22 surface=spa — 화면별 분모 (SSR 쪽은 seoRenderer 가 쏜다) */
      fetch('/api/editorials/' + encodeURIComponent(d.id) + '/view?surface=spa', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      }).catch(function(){ /* analytics must not break UX */ });

      // Personalised theme rows: bump each tag of this editorial in the
      // user's preferences. Server is the security boundary (re-reads
      // tags from DB, ignores client-supplied list). Anonymous callers
      // are silently no-op'd by the endpoint, so we don't gate on
      // isLoggedIn() — keeps this branch tight.
      var _pToken = localStorage.getItem('pap-token');
      fetch('/api/users/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Authorization': _pToken ? ('Bearer ' + _pToken) : ''
        },
        body: JSON.stringify({ editorial_id: d.id })
      }).catch(function(){ /* preferences are nice-to-have */ });

      // Local "have I seen this" set — drives the unseen-first reorder
      // inside personalised theme rows. Lives in localStorage only, so
      // there's no DB write per open, no PII leaving the device, and
      // browser clear is a graceful reset.
      try {
        var _seenRaw = localStorage.getItem('pap-viewed-eds');
        var _seen = _seenRaw ? JSON.parse(_seenRaw) : [];
        if (!Array.isArray(_seen)) _seen = [];
        if (_seen.indexOf(d.id) === -1) {
          _seen.push(d.id);
          // Cap to last 500 ids so localStorage never blows up on
          // long-time readers. FIFO eviction.
          if (_seen.length > 500) _seen = _seen.slice(_seen.length - 500);
          localStorage.setItem('pap-viewed-eds', JSON.stringify(_seen));
        }
      } catch(_){}
    } catch(_){}
  }
  // QA #96 — d.credits may be admin-dict, admin-array (with roles[]), or
  // already-display array. Normalise to {r, h} once so the renderer below
  // can stay simple. Empty credits fall back to the placeholder pair.
  var _normCr = _normalizeCreditsForDisplay(d.credits);
  var det={issue:d.issue||'MAR. ISSUE',thumb:d.thumb||thumb,images:d.images||[thumb,thumb],credits:(_normCr.length?_normCr:[{r:'Photography',h:['@photographer']},{r:'Stylist',h:['@stylist']}]),fashion:d.fashion||['@brand'],imageCredits:d.imageCredits||{},desc:d.desc||'',ig:d.ig||''};

  // SEO — update meta tags + JSON-LD when an editorial opens. Helps
  // social-share previews (Kakao/Facebook/X) and Google's JS-aware
  // crawler pick up per-editorial title/image/description instead of
  // the generic homepage values. _updateEditorialMeta is defined at
  // bottom of file (deep-link section) and is a no-op if missing.
  if(typeof _updateEditorialMeta === 'function'){
    try { _updateEditorialMeta(title, det); } catch(_){}
  }

  var heroImg=document.getElementById('edDetailHero');
  heroImg.onerror=function(){edImgError(this);};
  heroImg.src=det.thumb;
  document.getElementById('edDetailTitle').textContent=title;
  document.getElementById('edDetailIssue').textContent=det.issue;
  // 참여 증폭 2.0 — 원본 IG 게시물 임베드 + 보내기 (det.ig 없으면 숨김).
  if(typeof _papRenderEdIg==='function'){try{_papRenderEdIg(det.ig,title);}catch(_){}}
  // 수익화 2.0 — SHOP THE STORY (착장 브랜드 구매 링크).
  if(typeof _papRenderShopRow==='function'){try{_papRenderShopRow(det.fashion, det.imageCredits);}catch(_){}}

  // Editorial description
  var descEl=document.getElementById('edDetailDesc');
  if(descEl){var lang=localStorage.getItem('pap-lang')||'ko';var descText=typeof det.desc==='object'?(det.desc[lang]||det.desc.en||det.desc.ko||''):det.desc;descEl.innerHTML=descText;}

  // Gallery 2-col with hover credits.
  // Priority for the hover overlay text:
  //   1. det.imageCredits[img_N] — the exact string the admin typed in
  //      "이미지별 착장 크레딧" for THIS image (e.g. "@brand1 Jacket,
  //      @brand2 Pants"). Each @handle in the string is rendered as an
  //      Instagram-deeplink anchor; non-handle text (item names like
  //      "Jacket") stays as plain text in between.
  //   2. Rotating fallback through det.fashion brand list when no
  //      per-image credit string was saved — keeps older posts from
  //      going blank on hover.
  var gal=document.getElementById('edDetailGallery');
  gal.innerHTML='';
  _papEdApplyLock(det, gal);   // 잠긴 화보면 안내 패널을 넣고 images 를 비운다
  var imgCreditsMap = (det.imageCredits && typeof det.imageCredits === 'object') ? det.imageCredits : {};
  // 중간 IG 창 자리 — 두 자리 모두 홀수 idx (왼쪽/오른쪽 칸 규칙은 루프 안 주석)
  var _papMidSlots = (function(n){
    function odd(x){ x = Math.max(1, Math.round(x)); return (x % 2 === 0) ? x - 1 : x; }
    var a = odd(n / 3), b = odd(2 * n / 3);
    if (b <= a) b = a + 2;
    if (b > n - 1) b = -1;   // 자리가 모자라면 두 번째는 생략
    return [a, b];
  })(det.images.length);
  det.images.forEach(function(url,idx){
    var credits='';
    var perImgKey = 'img_' + (idx + 1);
    var perImg = imgCreditsMap[perImgKey];
    if(typeof perImg === 'string' && perImg.trim()){
      // Tokenize on commas; each token may contain "@handle Item Name".
      // Wrap @handle in an Instagram link, keep the rest as text.
      var tokens = perImg.split(',').map(function(t){ return t.trim(); }).filter(Boolean);
      // Render order is "Item: @handle" — admins type "@handle Item Name"
      // (handle first, item label after) but fashion-magazine convention
      // puts the garment FIRST, then who made it. Each token is wrapped
      // in a span so the .ed-img-credits flex container's gap handles
      // separation between items — no commas, no double spaces, just
      // clean wrap-friendly chunks ("Coat: @dona.ralph" "Pants: @ferragamo").
      credits = tokens.map(function(tok){
        var m = tok.match(/^(@[A-Za-z0-9._]+)\s*(.*)$/);
        if(m){
          var handle = m[1];
          var label  = m[2] ? m[2].trim() : '';
          var safe   = handle.replace(/'/g,"");
          var prefix = label ? label + ': ' : '';
          return '<span class="ed-img-credit">' + prefix
               + '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safe+'\',1)">'+handle+'</a>'
               + '</span>';
        }
        return '<span class="ed-img-credit">' + tok + '</span>';
      }).join('');
    } else {
      // Show fashion brands as hover overlay on each image (rotate through).
      // Defensive coercion: brand entries can be string ("@brand") or object
      // ({n:"Brand", id:"@brand"}). When id is an empty string the old
      // code left fHandle as "" but rendered fDisplay correctly — that's
      // OK. When n is also empty (brand with no metadata at all) we now
      // skip the entry instead of rendering a blank link.
      var fLen=det.fashion.length;
      if(fLen>0){
        var perImgCount=Math.max(2,Math.ceil(fLen/det.images.length));
        var start=(idx*perImgCount)%fLen;
        for(var fi=0;fi<perImgCount&&fi<fLen;fi++){
          var f=det.fashion[(start+fi)%fLen];
          var fHandle = '', fDisplay = '';
          if(f && typeof f === 'object'){
            fHandle  = (typeof f.id === 'string' ? f.id : '') || '';
            fDisplay = (typeof f.n  === 'string' ? f.n  : '') || (fHandle ? fHandle.replace(/^@/,'') : '');
          } else if(typeof f === 'string'){
            fHandle  = f;
            fDisplay = f.replace(/^@/, '');
          }
          if(!fDisplay) continue;
          credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+fHandle.replace(/'/g,"")+'\',1)">'+fDisplay+'</a>';
        }
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)">'+_scrapBtnHtml(url,title)+'<div class="ed-img-credits">'+credits+'</div></div>';
    // 갤러리 중간 IG 창 — 상한 2개 (2026-08-10 도메니코): 1/3·2/3 지점.
    // "첫 번째는 왼쪽 칸, 두 번째는 오른쪽 칸" — 2열 그리드에서 칸은 슬롯
    // 순번(0기준 짝수=왼쪽)으로 정해진다. 첫 창 슬롯 = idx+1 → 짝수가 되려면
    // idx 홀수. 둘째 창은 첫 창이 흐름을 한 칸 밀어 슬롯 = idx+2 → 홀수(오른쪽)
    // 가 되려면 역시 idx 홀수. 그래서 두 자리 모두 홀수 idx 로 뽑는다.
    if(idx === _papMidSlots[0] || idx === _papMidSlots[1]){
      var _igu = det.ig || (d && d.ig) || '';
      var _emb = /instagram\.com\/(p|reel|tv)\//.test(String(_igu).split('?')[0]);
      if(_emb || idx === _papMidSlots[0]){
        try{ gal.innerHTML += _papMidIgCtaHtml(_igu); }catch(_){}
      }
    }
  });

  // QA #206 — fall back to a.url (the API row's url field) when the
  // hardcoded edDetails entry has none. The previous code only looked
  // at det.url, which silently lost the video for every editorial that
  // came from the database (i.e. the entire admin-curated catalogue).
  // The admin form's "영상 링크" input writes into editorials.url, and
  // apiEditorialToLocal already surfaces it on `a.url`.
  _renderEditorialVideo((det && det.url) || (d && d.url));

  // Credits table — supports name+handle objects or plain handle strings.
  // Defensive: an object with empty .n used to fall through to the string
  // branch and call h.replace(...) on the object → TypeError. Now we
  // resolve handle/displayName strictly to strings before any string ops.
  var cr=document.getElementById('edDetailCredits');
  var ch='';
  det.credits.forEach(function(c){
    var vals=c.h.map(function(h){
      var handle = '', displayName = '';
      if(h && typeof h === 'object'){
        handle      = (typeof h.id === 'string' ? h.id : '') || '';
        displayName = (typeof h.n  === 'string' ? h.n  : '') || (handle ? handle.replace(/^@/,'') : '');
      } else if(typeof h === 'string'){
        handle      = h;
        displayName = h.replace(/^@/, '');
      }
      if(!displayName) return '';
      var safeHandle = handle.replace(/'/g,"");
      return '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safeHandle+'\')">'+displayName+'</a>';
    }).filter(Boolean).join(', ');
    ch+='<div class="ed-cred-row"><div class="ed-cred-role">'+c.r+'</div><div class="ed-cred-val">'+vals+'</div></div>';
  });
  // Fashion by — removed (shown as hover credits on images)
  cr.innerHTML=ch;

  // QA #271 — Standard 이상 회원에게 커버 이미지 + 갤러리 이미지 다운로드 링크 표시.
  // isStandardOrAbove()는 pap-subscription.js에서 정의됨.
  try { _renderEditorialDownloads(det, d); } catch(_) {}

  // QA #246 — Render clickable hashtag chips for this editorial.
  // Tags live on the edData list row (categories drive the filter pill
  // strip) — reused here as user-facing hashtags. Click routes to
  // articles.html?tag=<value>, where the article list page applies its
  // tag filter AND surfaces a sibling "이 태그의 에디토리얼 보기" link
  // back to the editorial overlay, so the two content types stay
  // discoverable from a single tag click.
  _renderEditorialTags(title);

  // QA #163 — Related Films (reverse-FK from films.related_editorial_id).
  // Hidden if the editorial has no linked films; otherwise renders cards.
  _renderRelatedFilms(det && det.relatedFilms);

  // ─── QA #83 — Logo / distribution files moved to mypage ───
  // Per the IA redesign, downloadable assets are no longer surfaced on
  // the public editorial detail page. We keep the slot but render only a
  // CTA pointing to mypage > 다운로드 가능 파일. The actual access check
  // and file list live on mypage; here we just show / hide the CTA based
  // on whether this editorial has any distribution kit at all.
  var logoSection=document.getElementById('edLogoDownload');
  if(!logoSection){
    logoSection=document.createElement('div');
    logoSection.id='edLogoDownload';
    logoSection.style.cssText='margin:24px 0;padding:16px 0;border-top:1px solid #333;';
    cr.parentNode.insertBefore(logoSection,cr.nextSibling);
  }
  var logoFolderId=getLogoFolderId(title);
  if(logoFolderId){
    var _curLang_dk = (typeof lang === 'string' ? lang : (localStorage.getItem('pap-lang') || 'ko'));
    var _t_dk = (T && T[_curLang_dk]) || (T && T.en) || {};
    logoSection.innerHTML=''
      +'<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">'
        +'<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999;">'
          +'DISTRIBUTION KIT'
          +'<div style="font-size:9px;font-weight:500;letter-spacing:.04em;color:#666;margin-top:4px;text-transform:none;" data-i18n="distKitDesc">'
            +(_t_dk.distKitDesc || '참여 크리에이터에게 제공되는 로고·배포용 파일 — 마이페이지에서 다운로드하세요')
          +'</div>'
        +'</div>'
        +'<a href="/mypage#downloads" style="display:inline-block;padding:6px 16px;border:1px solid #555;color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .3s;" onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'" data-i18n="distKitGoMypage">'
          +(_t_dk.distKitGoMypage || '마이페이지로 이동 →')
        +'</a>'
      +'</div>';
    logoSection.style.display='';
  } else {
    logoSection.style.display='none';
  }

  // 참여 블록 (2026-08-08) — 기사와 같은 부품(pap-engage.js: 좋아요·댓글·
  // 카카오 공유). 구 커뮤니티 댓글(renderEditorialSocial)은 여기서 렌더를
  // 중단한다 — 한 화면에 댓글창이 두 개 뜨는 걸 막기 위해서다(기사와 동일
  // 결정, 구 시스템 에디토리얼 댓글 역대 0건이라 잃는 데이터 없음).
  // 별점 CTA 는 에디토리얼 고유 기능이라 그대로 둔다.
  var _edEng=document.getElementById('edEngageMount');
  if(_edEng && window.PapEngage){
    window.PapEngage.mount(_edEng, {
      kind:'editorial', id:(d && d.id)||'', lang:(localStorage.getItem('pap-lang')||'ko'),
      title:title||'', desc:'', image:(det && det.thumb)||thumb||'',
    });
  }

  /* 별점 (2026-08-09 최종 — 도메니코: "사진들 바로 아래") — 공용 부품
     PapEngage.mountRating. SSR(papRatingMount)과 같은 부품·같은 자리. */
  if(window.PapEngage&&window.PapEngage.mountRating){
    window.PapEngage.mountRating(document.getElementById('edRatingCta'),
      {kind:'editorial', title:title||'', lang:(localStorage.getItem('pap-lang')||'ko')});
  }
  // 체류시간 개선 (2026-07) — 임베딩 기반 관련 화보. id 없거나 결과 없으면 숨김.
  var edRelated=document.getElementById('edRelatedEditorials');
  if(edRelated && typeof PAPSocial!=='undefined' && PAPSocial.renderRelatedEditorials){
    PAPSocial.renderRelatedEditorials(edRelated, d && d.id);
  }

  // 2026-08-05 — MORE CONTENT(최신순 캐러셀) 제거. #edRelatedEditorials(유사도
  // 추천)와 역할이 겹쳐 "더 볼 것" 줄이 두 번 나왔다. index.html 의 마크업도 함께 삭제.

  // Hide All Editorials overlay if open (z-index conflict)
  var allOv=document.getElementById('edAllOverlay');
  if(allOv && allOv.classList.contains('active')){
    allOv.style.display='none';
    window._edAllWasOpen=true;
  }

  document.getElementById('edOverlay').classList.add('active');
  document.getElementById('edOverlay').scrollTop=0;
  document.body.style.overflow='hidden';
  if(typeof _resetCursorForModal==='function') _resetCursorForModal();
  // Push state with editorial info so popstate can restore it.
  // QA #166 — clean URLs: /editorial/<slug> instead of #editorial/<title>.
  // Vercel rewrites /editorial/:slug → SSR endpoint on direct hits, so
  // the in-app pushState and a refresh-of-this-URL converge on the same
  // canonical address (no more hash-vs-path divergence in shares).
  // Slug priority: edDetails[title].slug (DB) → admin's saved slug
  //              → _editorialTitleToSlug fallback (legacy static entries).
  var _edThumb=det.thumb||thumb||'';
  var _edSlug = (d && d.slug) || _editorialTitleToSlug(title);
  try{
    // 2026-08-04 — GSC "리디렉션이 포함된 페이지" 3,588건 원인 수정.
    // /<lang>/editorial/<slug> 로 직접 들어온 방문(딥링크·구글봇)에서
    // 언어 접두어를 버리고 /editorial/<slug> 로 pushState 하던 탓에,
    // JS 를 렌더하는 구글봇이 이를 "리디렉션"으로 기록했다.
    // 지금 URL 의 언어 접두어를 그대로 유지한다.
    // 2026-08-04(2차) — 1차 수정은 무력했다. SSR 브릿지가 /?ed=<slug> 로
    // 먼저 튕겨서, 여기 도달할 땐 location.pathname 이 이미 '/' 였다.
    // 브릿지가 넘겨준 언어(window.__papDeepLinkLang)를 폴백으로 쓴다.
    var _edLangM = location.pathname.match(/^\/(en|it|fr|es|ja|de|zh|ru)\//);
    var _edPrefix = _edLangM ? '/' + _edLangM[1]
      : (window.__papDeepLinkLang ? '/' + window.__papDeepLinkLang : '');
    var _epath = _edPrefix + '/editorial/' + _edSlug;
    var _state = {editorial:true, title:title, slug:_edSlug, thumb:_edThumb};
    if(window.location.pathname === _epath){
      history.replaceState(_state, '', _epath);
    }else{
      history.pushState(_state, '', _epath);
    }
  }catch(e){
    // Last-ditch — pushState blocked. Don't fall back to hash form
    // anymore; clean URLs are the contract. The overlay still opens,
    // just without a shareable URL change.
  }
}

// QA #166 — title → URL slug fallback. Used when an editorial entry
// has no DB slug (static-snapshot rows that pre-date the slug column).
// Keeps Korean characters because the SSR endpoint resolves them via
// decodeURIComponent + title-fallback lookup (api/seo/editorial/[slug].js).
/* ── 에디토리얼 열람 잠금 패널 (2026-08-21) ────────────────────────────
 * 서버(/api/editorials/:id)가 access.allowed=false 로 응답하면 이미지 세트를
 * 아예 안 내려준다. 여기서는 그 사실을 사람에게 설명하고 다음 행동을 준다.
 *
 * 표지·제목·크레딧은 그대로 보인다 — 뭘 놓치는지 보여야 가입할 이유가 생긴다.
 * det.images 를 비우는 방식이라 아래 갤러리 루프는 자연히 아무것도 안 그린다.
 * (제어 흐름을 건드리지 않으려는 의도 — 렌더 경로가 둘이라 분기를 늘리면 어긋난다) */
function _papEdApplyLock(det, gal){
  if(!det || !det.locked || !gal) return false;
  det.images = [];
  var need = String(det.requiredTier || 'free');
  var total = Number(det.galleryCount || 0);
  var msg, cta, sub;
  if(need === 'free'){
    msg = '로그인하면 볼 수 있습니다';
    sub = '최신 에디토리얼 10편은 회원이면 무료입니다.';
    cta = '가입하고 보기';
  } else if(need === 'standard'){
    msg = 'STANDARD 멤버부터 볼 수 있습니다';
    sub = '최신 6개월 에디토리얼 열람 · 이미지 다운로드 포함.';
    cta = '멤버십 보기';
  } else {
    msg = 'PREMIUM 멤버부터 볼 수 있습니다';
    sub = '2019년부터의 전체 아카이브가 열립니다.';
    cta = '멤버십 보기';
  }
  var count = total > 0 ? ('<div style="font-size:12px;letter-spacing:.12em;opacity:.55;margin-bottom:18px">' + total + ' IMAGES</div>') : '';
  gal.innerHTML =
    '<div class="ed-locked" style="grid-column:1/-1;text-align:center;padding:64px 24px;border:1px solid rgba(255,255,255,.14);border-radius:2px">' +
      count +
      '<div style="font-size:17px;font-weight:600;margin-bottom:8px">' + msg + '</div>' +
      '<div style="font-size:13px;opacity:.6;margin-bottom:24px;line-height:1.6">' + sub + '</div>' +
      '<a href="/subscribe" style="display:inline-block;padding:13px 30px;border:1px solid currentColor;border-radius:2px;font-size:12px;letter-spacing:.14em;text-decoration:none;color:inherit">' + cta + '</a>' +
    '</div>';
  return true;
}

function _editorialTitleToSlug(t){
  return String(t||'')
    .toLowerCase()
    .replace(/['"`]+/g, '')
    .replace(/[^\w\s가-힣-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Version of _openEditorialInner that does NOT push a new history entry (used by popstate)
function _openEditorialInner_noPush(title,thumb){
  var d=edDetails[title];
  if(!d){var titleLower=title.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===titleLower){d=edDetails[key];break;}}}
  d=d||{};
  // QA #96 — d.credits may be admin-dict, admin-array (with roles[]), or
  // already-display array. Normalise to {r, h} once so the renderer below
  // can stay simple. Empty credits fall back to the placeholder pair.
  var _normCr = _normalizeCreditsForDisplay(d.credits);
  var det={issue:d.issue||'MAR. ISSUE',thumb:d.thumb||thumb,images:d.images||[thumb,thumb],credits:(_normCr.length?_normCr:[{r:'Photography',h:['@photographer']},{r:'Stylist',h:['@stylist']}]),fashion:d.fashion||['@brand'],imageCredits:d.imageCredits||{},desc:d.desc||'',ig:d.ig||''};
  // SEO — same meta refresh as _openEditorialInner (back/forward path).
  if(typeof _updateEditorialMeta === 'function'){
    try { _updateEditorialMeta(title, det); } catch(_){}
  }
  var heroImg=document.getElementById('edDetailHero');
  heroImg.onerror=function(){edImgError(this);};
  heroImg.src=det.thumb;
  document.getElementById('edDetailTitle').textContent=title;
  document.getElementById('edDetailIssue').textContent=det.issue;
  // 참여 증폭 2.0 — 원본 IG 게시물 임베드 + 보내기 (det.ig 없으면 숨김).
  if(typeof _papRenderEdIg==='function'){try{_papRenderEdIg(det.ig,title);}catch(_){}}
  // 수익화 2.0 — SHOP THE STORY (착장 브랜드 구매 링크).
  if(typeof _papRenderShopRow==='function'){try{_papRenderShopRow(det.fashion, det.imageCredits);}catch(_){}}
  var descEl=document.getElementById('edDetailDesc');
  if(descEl){var lang=localStorage.getItem('pap-lang')||'ko';var descText=typeof det.desc==='object'?(det.desc[lang]||det.desc.en||det.desc.ko||''):det.desc;descEl.innerHTML=descText;}
  var gal=document.getElementById('edDetailGallery');
  gal.innerHTML='';
  _papEdApplyLock(det, gal);   // 잠긴 화보면 안내 패널을 넣고 images 를 비운다
  // Same per-image credit priority as the main openEditorial path:
  // admin's "이미지별 착장 크레딧" string wins, then rotating brand fallback.
  var imgCreditsMap = (det.imageCredits && typeof det.imageCredits === 'object') ? det.imageCredits : {};
  // 중간 IG 창 자리 — 두 자리 모두 홀수 idx (왼쪽/오른쪽 칸 규칙은 루프 안 주석)
  var _papMidSlots = (function(n){
    function odd(x){ x = Math.max(1, Math.round(x)); return (x % 2 === 0) ? x - 1 : x; }
    var a = odd(n / 3), b = odd(2 * n / 3);
    if (b <= a) b = a + 2;
    if (b > n - 1) b = -1;   // 자리가 모자라면 두 번째는 생략
    return [a, b];
  })(det.images.length);
  det.images.forEach(function(url,idx){
    var credits='';
    var perImgKey = 'img_' + (idx + 1);
    var perImg = imgCreditsMap[perImgKey];
    if(typeof perImg === 'string' && perImg.trim()){
      var tokens = perImg.split(',').map(function(t){ return t.trim(); }).filter(Boolean);
      // Same "Item: @handle" reordering + per-token <span> wrapper as
      // the main openEditorial path — see the longer comment there.
      // Keep these two branches in sync.
      credits = tokens.map(function(tok){
        var m = tok.match(/^(@[A-Za-z0-9._]+)\s*(.*)$/);
        if(m){
          var handle = m[1];
          var label  = m[2] ? m[2].trim() : '';
          var safe   = handle.replace(/'/g,"");
          var prefix = label ? label + ': ' : '';
          return '<span class="ed-img-credit">' + prefix
               + '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safe+'\',1)">'+handle+'</a>'
               + '</span>';
        }
        return '<span class="ed-img-credit">' + tok + '</span>';
      }).join('');
    } else {
      // Same defensive coercion as openEditorial path — keep these two
      // branches in sync.
      var fLen=det.fashion.length;
      if(fLen>0){
        var perImgCount=Math.max(2,Math.ceil(fLen/det.images.length));
        var start=(idx*perImgCount)%fLen;
        for(var fi=0;fi<perImgCount&&fi<fLen;fi++){
          var f=det.fashion[(start+fi)%fLen];
          var fHandle = '', fDisplay = '';
          if(f && typeof f === 'object'){
            fHandle  = (typeof f.id === 'string' ? f.id : '') || '';
            fDisplay = (typeof f.n  === 'string' ? f.n  : '') || (fHandle ? fHandle.replace(/^@/,'') : '');
          } else if(typeof f === 'string'){
            fHandle  = f;
            fDisplay = f.replace(/^@/, '');
          }
          if(!fDisplay) continue;
          credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+fHandle.replace(/'/g,"")+'\',1)">'+fDisplay+'</a>';
        }
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)">'+_scrapBtnHtml(url,title)+'<div class="ed-img-credits">'+credits+'</div></div>';
    // 갤러리 중간 IG 창 — 상한 2개 (2026-08-10 도메니코): 1/3·2/3 지점.
    // "첫 번째는 왼쪽 칸, 두 번째는 오른쪽 칸" — 2열 그리드에서 칸은 슬롯
    // 순번(0기준 짝수=왼쪽)으로 정해진다. 첫 창 슬롯 = idx+1 → 짝수가 되려면
    // idx 홀수. 둘째 창은 첫 창이 흐름을 한 칸 밀어 슬롯 = idx+2 → 홀수(오른쪽)
    // 가 되려면 역시 idx 홀수. 그래서 두 자리 모두 홀수 idx 로 뽑는다.
    if(idx === _papMidSlots[0] || idx === _papMidSlots[1]){
      var _igu = det.ig || (d && d.ig) || '';
      var _emb = /instagram\.com\/(p|reel|tv)\//.test(String(_igu).split('?')[0]);
      if(_emb || idx === _papMidSlots[0]){
        try{ gal.innerHTML += _papMidIgCtaHtml(_igu); }catch(_){}
      }
    }
  });
  // QA #206 — fall back to a.url (the API row's url field) when the
  // hardcoded edDetails entry has none. The previous code only looked
  // at det.url, which silently lost the video for every editorial that
  // came from the database (i.e. the entire admin-curated catalogue).
  // The admin form's "영상 링크" input writes into editorials.url, and
  // apiEditorialToLocal already surfaces it on `a.url`.
  _renderEditorialVideo((det && det.url) || (d && d.url));
  var cr=document.getElementById('edDetailCredits');
  var ch='';
  det.credits.forEach(function(c){
    var vals=c.h.map(function(h){
      var handle = '', displayName = '';
      if(h && typeof h === 'object'){
        handle      = (typeof h.id === 'string' ? h.id : '') || '';
        displayName = (typeof h.n  === 'string' ? h.n  : '') || (handle ? handle.replace(/^@/,'') : '');
      } else if(typeof h === 'string'){
        handle      = h;
        displayName = h.replace(/^@/, '');
      }
      if(!displayName) return '';
      var safeHandle = handle.replace(/'/g,"");
      return '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safeHandle+'\')">'+displayName+'</a>';
    }).filter(Boolean).join(', ');
    ch+='<div class="ed-cred-row"><div class="ed-cred-role">'+c.r+'</div><div class="ed-cred-val">'+vals+'</div></div>';
  });
  cr.innerHTML=ch;
  // QA #271 — Standard 이상 회원에게 다운로드 영역 표시 (popstate 경로).
  try { _renderEditorialDownloads(det, d); } catch(_) {}
  // QA #246 — same hashtag chip rendering as the push path so back/
  // forward restoration preserves the tag UI.
  _renderEditorialTags(title);
  // QA #163 — Related Films (popstate restoration path).
  _renderRelatedFilms(det && det.relatedFilms);
  var logoSection=document.getElementById('edLogoDownload');
  if(logoSection){
    var logoFolderId=getLogoFolderId(title);
    /* 2026-08-21 — 로고 파일은 스탠다드부터다 (도메니코 결정: 이미지·로고
     * 이미지·티어시트를 스탠다드가 전부 받는다). 서버 게이트
     * api/downloads/check.js 도 스탠다드 이상을 허용하고 있었는데
     * 이 화면만 프리미엄으로 잠그고 있어서, 돈 낸 스탠다드 회원에게
     * LOGO FILES 섹션이 아예 안 보였다. */
    if(isStandardOrAbove()&&logoFolderId){
      logoSection.innerHTML='<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999;">LOGO FILES</span><a href="https://drive.google.com/drive/folders/'+logoFolderId+'" target="_blank" rel="noopener" style="display:inline-block;padding:6px 16px;border:1px solid #555;color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .3s;" onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">DOWNLOAD</a></div>';
      logoSection.style.display='';
    } else { logoSection.style.display='none'; }
  }
  // 참여 블록 (2026-08-08) — push 경로와 동일 (구 커뮤니티 댓글 렌더 중단).
  var _edEng2=document.getElementById('edEngageMount');
  if(_edEng2 && window.PapEngage){
    window.PapEngage.mount(_edEng2, {
      kind:'editorial', id:(d && d.id)||'', lang:(localStorage.getItem('pap-lang')||'ko'),
      title:title||'', desc:'', image:(det && det.thumb)||thumb||'',
    });
  }
  // 참여율/체류시간 개선 (2026-07) — popstate 복원 경로도 push 경로와 동일하게.
  if(window.PapEngage&&window.PapEngage.mountRating){
    window.PapEngage.mountRating(document.getElementById('edRatingCta'),
      {kind:'editorial', title:title||'', lang:(localStorage.getItem('pap-lang')||'ko')});
  }
  var edRelated2=document.getElementById('edRelatedEditorials');
  if(edRelated2&&typeof PAPSocial!=='undefined'&&PAPSocial.renderRelatedEditorials) PAPSocial.renderRelatedEditorials(edRelated2, d && d.id);
  // 2026-08-05 — MORE CONTENT(최신순 캐러셀) 제거. #edRelatedEditorials(유사도
  // 추천)와 역할이 겹쳐 "더 볼 것" 줄이 두 번 나왔다. index.html 의 마크업도 함께 삭제.
  var allOv=document.getElementById('edAllOverlay');
  if(allOv&&allOv.classList.contains('active')){allOv.style.display='none';window._edAllWasOpen=true;}
  document.getElementById('edOverlay').classList.add('active');
  document.getElementById('edOverlay').scrollTop=0;
  document.body.style.overflow='hidden';
  if(typeof _resetCursorForModal==='function') _resetCursorForModal();
  // No pushState — this is called from popstate
}

// 체류시간 개선 (2026-07) — 관련 화보 카드 클릭 핸들러.
// pap-social.js#renderRelatedEditorials 가 각 카드에서 호출한다.
// 캐시(edDetails)에 해당 화보가 있으면 SPA 인앱 오픈(openEditorial 이 URL 을
// /editorial/<slug> 로 갱신) — 없으면 정식 경로로 하드 이동(SSR/rewrite 렌더).
// 앵커 기본 이동은 항상 막는다.
window._papOpenRelatedEd = function(ev, title, cover, slug){
  try { if(ev && ev.preventDefault) ev.preventDefault(); } catch(_){}
  try {
    var hit = false;
    if(title && typeof edDetails !== 'undefined'){
      if(edDetails[title]) hit = true;
      else {
        var tl = title.toLowerCase();
        for(var k in edDetails){ if(k.toLowerCase()===tl){ hit = true; break; } }
      }
    }
    if(hit && typeof openEditorial === 'function'){
      openEditorial(title, cover || '');
      return false;
    }
  } catch(_){}
  try { location.href = window._papLangPrefix() + '/editorial/' + slug; } catch(_){}
  return false;
};

function closeEditorial(skipHistory){
  document.getElementById('edOverlay').classList.remove('active');
  var allOv=document.getElementById('edAllOverlay');
  if(window._edAllWasOpen && allOv){
    allOv.style.display='';
    window._edAllWasOpen=false;
    document.body.style.overflow='hidden';
  } else {
    document.body.style.overflow='';
  }
  // QA #244 — Header X-button consistency.
  //
  // Previous behavior gated history.back() behind a
  //   history.state && history.state.editorial
  // check. That gate silently swallowed back() whenever the URL state
  // didn't carry an explicit `editorial` key — and there are entry
  // paths that leave it bare (a stale popstate replay, an SSR redirect
  // landing where the deep-link IIFE swaps the URL with replaceState,
  // or a user arriving on /editorial/<slug> via a share). When the
  // gate failed, the overlay closed but no navigation happened: the
  // user saw the home behind it without any URL change, and reported
  // it as "X took me back to the home page". That contradicts the
  // film / article close behavior, which calls back() unconditionally
  // when skipHistory is false.
  //
  // Match the film / article contract — always history.back() unless
  // popstate told us to skip. popstate itself calls closeEditorial(true)
  // so we don't double-pop the stack.
  if(!skipHistory){
    try { history.back(); } catch(e){}
  }
}

// ======== IMAGE ERROR HANDLER (edImgError) ========
// ======== IMAGE ERROR HANDLER ========
function edImgError(img){
  if(img.dataset.fallback) return;
  img.dataset.fallback='1';
  var title=img.alt||'EDITORIAL';
  img.src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='533'%3E%3Crect width='400' height='533' fill='%23222'/%3E%3Ctext x='200' y='250' text-anchor='middle' fill='rgba(255,255,255,0.3)' font-family='sans-serif' font-size='13' font-weight='bold' letter-spacing='2'%3E"+encodeURIComponent(title)+"%3C/text%3E%3Ctext x='200' y='275' text-anchor='middle' fill='rgba(255,255,255,0.15)' font-family='sans-serif' font-size='10' letter-spacing='3'%3EPAP MAGAZINE%3C/text%3E%3C/svg%3E";
}

// ======== ALL EDITORIALS OVERLAY ========
// ======== ALL EDITORIALS OVERLAY ========
var edAllBuilt=false;
var edAllCurrentPage=1;
function openAllEditorials(){
  // Show interstitial for free users (session limited)
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllEditorialsInner(); });
    return;
  }
  _openAllEditorialsInner();
}
// QA(2026-07) #21 — 구독 게이트 UX. 베타 종료(PAP_BETA_END=2026-07-09) 이후
// 에디토리얼 전체보기는 Standard 이상 전용이 됐는데, 기존 구현은 네이티브
// alert() 를 띄운 뒤 곧바로 /subscribe 로 하드 리다이렉트했다. 사용자 입장에선
// "에디토리얼 목록 페이지가 아예 뜨지 않는다"로 보였고(QA: 모바일 에디토리얼
// 목록 전체 미노출), 특히 모바일에서 alert → 이동이라 목록을 본 적이 없다.
//
// 과금 정책(Standard 이상)은 그대로 두고, 목록 화면 안에서 잠금 상태 + 업셀을
// 보여준다 → 페이지는 정상적으로 뜨고, 왜 못 보는지/무엇을 하면 되는지 전달.
/* _renderEdAllPaywall 제거 (2026-08-21) — 목록을 통째로 덮는 화면은
 * 더 이상 쓰지 않는다. 목록은 누구나 보고, 못 여는 것에만 자물쇠를 단다. */


function _openAllEditorialsInner(){
  var overlay=document.getElementById('edAllOverlay');
  if(!overlay) return;
  /* 2026-08-21 — 목록은 누구나 본다 (도메니코: "목록까지 막는건 아니야").
   * 종전에는 스탠다드 미만이면 목록 화면 자체를 통째로 페이월로 덮었다.
   * 그러면 비회원은 무엇이 있는지조차 못 보고, 가입할 이유도 안 생긴다.
   * 이제 표지·제목은 전부 보이고, 열 수 없는 것에는 자물쇠를 단다.
   * 실제 차단은 서버(api/editorials/:id)가 한다 — 여기는 안내일 뿐이다. */
  // 잠금 화면을 거쳤다가 권한이 생긴 경우를 대비해 필터를 되살린다.
  var _filt=document.getElementById('edCatFilter');
  if(_filt) _filt.style.display='';
  if(!overlay) return;
  // QA #84: always start at the ALL category on fresh entry so the user
  // sees the full collection, not a stale filter from a previous visit.
  edAllCurrentCategory = 'all';
  edAllCurrentPage = 1;
  var pills = document.querySelectorAll('#edCatFilter .ed-cat-pill');
  pills.forEach(function(p){
    var isAll = p.getAttribute('data-cat') === 'all';
    p.classList.toggle('active', isAll);
    p.setAttribute('aria-selected', isAll ? 'true' : 'false');
  });
  _renderEdAllPage();
  edAllBuilt=true;
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
  // QA #330 — 히스토리 스택 관리 개선.
  // 세 가지 진입 시나리오를 각각 다르게 처리해서 X 닫기 시 정확히 이전
  // 페이지로 돌아가도록 한다:
  //
  //   1) `/#all-editorials` 로 직접 진입 (deep-link) 또는 SPA 내 hash 이동
  //      → hash 가 이미 URL 에 있음 → replaceState (신규 entry 없음)
  //
  //   2) `/editorial` clean path 로 진입 (QA #323, 다른 페이지에서 햄버거
  //      메뉴 클릭 등) → auto-open IIFE 가 트리거. URL 자체가 이미 이 상태를
  //      나타내므로 pushState 로 새 entry 를 추가하면 X 닫기 → history.back()
  //      후 여전히 `/editorial` 에 머물러서 이전 페이지로 돌아가려면 back 을
  //      한 번 더 눌러야 하는 UX 문제 → replaceState 사용.
  //
  //   3) 메인 홈 `/` 에서 오버레이 오픈 → hash 도 없고 pathname 도 editorial
  //      아님 → 새 state 를 반드시 pushState 로 추가. 그래야 X 닫기 시
  //      history.back() 이 `/` 로 정확히 복귀.
  //
  // 이전 구현은 케이스 2 에서 pushState 를 사용해 모바일에서 "뒤로가기가
  // 이전 방문 경로로 안 가고 홈으로 튀어버리는" 이슈의 원인이 되었음.
  var _h='#all-editorials';
  var alreadyOnEditorialUrl =
    window.location.hash === _h ||
    window.location.pathname === '/editorial' ||
    window._papAutoOpenEditorials === true;
  // QA(에디토리얼 URL) — URL 정책 통일: 내부 상태 해시(#all-editorials) 대신
  // clean singular path(/editorial)로 표기. 다른 메뉴(/articles, /films)와 동일한
  // 단순 경로 형태가 되고, 레거시 해시로 진입해도 여기서 /editorial 로 정규화됨.
  var targetUrl = '/editorial';
  if(alreadyOnEditorialUrl){
    history.replaceState({allEditorials:true},'', targetUrl);
  } else {
    history.pushState({allEditorials:true},'', targetUrl);
  }
}
// QA #84: active category filter (default 'all'). Persisted in-memory only;
// resets when the overlay is closed and reopened so users always start
// at ALL on a fresh entry.
var edAllCurrentCategory = 'all';

function _edEditorialMatchesCategory(e, cat){
  if(cat === 'all') return true;
  var tags = Array.isArray(e.tags)
    ? e.tags
    : (typeof e.tags === 'string' ? e.tags.split(',') : []);
  return tags.some(function(t){
    return String(t).trim().toLowerCase() === cat;
  });
}

function filterEditorialsByCategory(cat){
  if(!cat) cat = 'all';
  edAllCurrentCategory = cat;
  edAllCurrentPage = 1;
  // Update pill active state
  var pills = document.querySelectorAll('#edCatFilter .ed-cat-pill');
  pills.forEach(function(p){
    var isActive = p.getAttribute('data-cat') === cat;
    p.classList.toggle('active', isActive);
    p.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // Fade-out → re-render → fade-in transition
  var grid = document.getElementById('edAllGrid');
  if(grid){
    grid.classList.add('is-fading');
    setTimeout(function(){
      _renderEdAllPage();
      // Force reflow before removing the class so the transition replays
      void grid.offsetWidth;
      grid.classList.remove('is-fading');
    }, 220);
  } else {
    _renderEdAllPage();
  }
}

function _renderEdAllPage(){
  var grid=document.getElementById('edAllGrid');
  var count=document.getElementById('edAllCount');
  var pagContainer=document.getElementById('edAllPagination');
  grid.innerHTML='';
  var premium=isPremium();
  var standard=isStandardOrAbove()&&!premium;
  // Apply category filter BEFORE plan-based slicing so the per-category
  // numbers stay consistent (otherwise a filter could surface results
  // that are gated for non-premium users).
  var filtered = edData.filter(function(e){
    return _edEditorialMatchesCategory(e, edAllCurrentCategory);
  });
  // 2026-07 정책: Premium 전체 / Standard 최신 6개월(발행일 롤링) /
  // FREE·비로그인 최신 10개 — /subscribe 약속("최신 10개 에디토리얼")과 정합.
  // (2026-07-11 수정: 기존엔 free도 standard와 동일하게 6개월치가 열려
  //  Standard 구독 유인이 훼손되던 문제)
  /* 2026-08-21 — 목록은 자르지 않는다. 전부 보여주고 못 여는 것에 자물쇠를 단다.
   * (열람 차단은 서버가 한다. 여기서 감추면 '무엇을 놓치는지'가 안 보여
   *  가입·구독 이유가 사라진다.)
   * availableData = 이 사람이 실제로 열 수 있는 것 — 업셀 문구의 근거로만 쓴다. */
  var visibleData = filtered;
  var availableData;
  if(premium){
    availableData=filtered;
  }else if(standard){
    // 2026-08-21 — 서버(api/_lib/editorialAccess.js)와 같은 볼륨 경계를 쓴다.
    // 종전 setMonth(-6) 은 날짜 롤링이라 서버가 실제로 내주는 178편 중
    // 137편만 보여줬다. 돈 낸 회원에게 41편을 숨기던 셈이다.
    var _cut6=_papStandardCutoff(); _cut6.setHours(0,0,0,0);
    availableData=filtered.filter(function(e){
      var d=(e&&e.date)?new Date(e.date):null;
      return (d&&!isNaN(d.getTime()))?(d>=_cut6):false;
    });
  }else{
    // 정렬 보장 후 최신 10개 (카테고리 필터 적용 뒤라 카테고리별로도 일관)
    availableData=filtered.slice().sort(function(a,b){
      return String(b.date||'').localeCompare(String(a.date||''));
    }).slice(0,10);
  }
  var totalPages=Math.ceil(visibleData.length/PAP_PER_PAGE);
  if(edAllCurrentPage>totalPages) edAllCurrentPage=totalPages||1;
  var startIdx=(edAllCurrentPage-1)*PAP_PER_PAGE;
  var pageItems=visibleData.slice(startIdx,startIdx+PAP_PER_PAGE);
  pageItems.forEach(function(e){
    var card=document.createElement('div');
    card.className='ed-row-card';
    card.onclick=function(){openEditorial(e.title,e.img);};
    var catLabel = (function(){
      var tags = Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? e.tags.split(',') : []);
      var nice = tags.filter(function(t){
        var s = String(t).trim().toLowerCase();
        return s && s !== 'editorial' && s.indexOf('pap:') !== 0;
      }).map(function(t){
        return String(t).trim().toUpperCase();
      });
      return (nice.length ? 'EDITORIAL & ' + nice[0] : 'EDITORIAL');
    })();
    // 못 여는 화보에는 자물쇠. 표지·제목은 그대로 보인다.
    var _lk = (typeof _papWillLock==='function') && _papWillLock(e);
    var _lockBadge = _lk
      ? '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.66);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:3px 9px;font-size:9px;letter-spacing:.1em;color:#ddd">🔒</div>'
      : '';
    card.innerHTML='<div class="ed-row-card-img" style="position:relative"><img src="'+e.img+'" alt="'+e.title+'" onerror="edImgError(this)"'+(_lk?' style="opacity:.62"':'')+'>'+_lockBadge+'</div><div class="ed-row-card-info"><div class="ed-row-card-cat">'+papFmtMeta(catLabel, e.date)+'</div><div class="ed-row-card-title">'+e.title+'</div></div>';
    grid.appendChild(card);
  });
  if(!pageItems.length){
    var empty=document.createElement('div');
    empty.style.cssText='grid-column:1/-1;text-align:center;padding:60px 20px;color:#666;font-size:12px;letter-spacing:.1em';
    empty.textContent = 'NO EDITORIALS IN THIS CATEGORY';
    grid.appendChild(empty);
  }
  if(!premium&&edAllCurrentPage===totalPages&&filtered.length>availableData.length){
    // (availableData = 실제로 열 수 있는 것. 목록은 전부 보이지만 업셀 숫자는 이 기준이다)
    // 소프트 페이월(2026-07 전환): 차단이 아니라 프리미엄 가치를 보여주는 카드로 설득.
    var _ko=(localStorage.getItem('pap-lang')||'ko')==='ko';
    var _more=filtered.length-availableData.length;
    var upsell=document.createElement('div');
    upsell.style.cssText='grid-column:1/-1;padding:8px 20px 48px;';
    /* 2026-08-21 — 비회원과 무료회원을 갈라 말한다.
     * 비회원은 이 10편조차 못 연다(서버가 막는다). 그런데 종전 문구는
     * '무료 미리보기는 여기까지' 라서 마치 앞의 10편은 읽은 것처럼 읽힌다.
     * 실제로 할 수 있는 다음 행동(가입)을 말해야 한다. */
    var _anon = (typeof isLoggedIn === 'function') && !isLoggedIn();
    var _head=standard
      ? (_ko?'Premium으로 전체 아카이브 열기':'Open the full archive with Premium')
      : (_anon
        ? (_ko?'가입하면 최신 10편이 열려요':'Sign up to open the latest 10')
        : (_ko?'무료 미리보기는 여기까지예요':'The free preview ends here'));
    var _sub=standard
      ? (_ko?'지금은 최신 6개월치를 보고 계세요. Premium 멤버는 2019년부터의 전체 아카이브와 풀레터까지 이용할 수 있어요.':'You are seeing the latest 6 months. Premium unlocks the full archive since 2019 and Pull-Letters.')
      : (_anon
        ? (_ko?'무료 회원가입만 하면 최신 10편을 바로 볼 수 있어요. 그 이전 화보는 멤버십으로 열립니다.':'A free account opens the latest 10 editorials right away. Older ones open with a membership.')
        : (_ko?('멤버가 되면 '+_more+'편을 더 볼 수 있어요 — 광고 없이, 이미지·로고 이미지·티어시트 다운로드까지.'):('Become a member to unlock '+_more+' more editorials — ad-free, with image, logo image & tearsheet downloads.')));
    var _feats=standard
      ? [_ko?'2019년부터 전체 아카이브':'Full archive since 2019',_ko?'풀레터 요청':'Pull-Letter requests',_ko?'광고 없이 · 다운로드':'Ad-free · downloads']
      : _anon
        ? [_ko?'최신 10편 무료':'Latest 10 free',_ko?'서브미션 제출':'Submit your work',_ko?'가입 무료':'Free to join']
        : [_ko?'최신 6개월 에디토리얼':'Latest 6 months of editorials',_ko?'광고 없이 감상':'Ad-free reading',_ko?'이미지·로고·티어시트 다운로드':'Image, logo & tearsheet downloads'];
    var _btn=standard
      ? (_ko?'Premium 업그레이드':'Upgrade to Premium')
      : _anon
        ? (_ko?'가입하고 보기':'Sign up to read')
        : (_ko?'구독하고 전체 보기':'Subscribe to see all');
    var _chips=_feats.map(function(f){return '<span style="display:inline-block;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 13px;font-size:11px;color:#cfcfcf;margin:4px">'+f+'</span>';}).join('');
    upsell.innerHTML=
      '<div style="max-width:560px;margin:8px auto 0;padding:34px 26px;border:1px solid rgba(255,255,255,.16);border-radius:14px;text-align:center;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0))">'
      + '<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#8a8a8a;margin-bottom:12px">Editorial Archive</div>'
      + '<div style="font-size:19px;font-weight:700;letter-spacing:.01em;color:#fff;margin-bottom:10px">'+_head+'</div>'
      + '<div style="font-size:13px;line-height:1.7;color:#b4b4b4;margin-bottom:16px">'+_sub+'</div>'
      + '<div style="margin-bottom:22px">'+_chips+'</div>'
      + '<a href="/subscribe" style="display:inline-block;background:#fff;color:#000;padding:13px 34px;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;border-radius:2px">'+_btn+'</a>'
      + '</div>';
    grid.appendChild(upsell);
  }
  count.textContent=visibleData.length+' EDITORIALS'
    +(premium?'':' · '+availableData.length+' UNLOCKED');
  if(pagContainer){
    buildPagination(pagContainer,edAllCurrentPage,totalPages,function(page){
      edAllCurrentPage=page;
      _renderEdAllPage();
      var overlay=document.getElementById('edAllOverlay');
      if(overlay) overlay.scrollTo({top:0,behavior:'smooth'});
    },false);
  }
}
function closeAllEditorials(skipHistory){
  var overlay=document.getElementById("edAllOverlay");
  if(overlay && overlay.classList.contains("active")){
    overlay.classList.remove("active");
    document.body.style.overflow="";
    // QA #244 — Match closeEditorial / closeFilmDetail / closeArticleDetail:
    // always history.back() on user-driven close. Was gated behind
    // window.location.hash === '#all-editorials', which silently failed
    // whenever the user arrived via the new in-app pushState (no hash)
    // and had to click X twice — once to close the overlay, again to
    // back out of the URL.
    if(!skipHistory){ try { history.back(); } catch(e){} }
  }
}

/* Auto-open the editorials overlay when the page URL is index.html#all-editorials.
   Triggered when the user clicks EDITORIAL in the hamburger menu of a sub-page
   (pap-header.js navigates them here with the hash so the overlay opens on
   arrival instead of just dropping them on the home screen). Reveals the
   body (removes black deep-link cover) only after the overlay has been
   opened, so the user never sees the homepage flash. */
(function _autoOpenEditorialsFromHash(){
  function revealBody(){
    if(document.body && !document.body.classList.contains('pap-deeplink-ready')){
      document.body.classList.add('pap-deeplink-ready');
    }
  }
  function tryOpen(){
    // QA #323 — clean singular path 지원. hash 기반 legacy 트리거와 함께
    // vercel.json 의 /editorial → /index.html rewrite 를 통해 도착한
    // pathname='/editorial' 도 인식.
    var isEditorialTrigger = (window.location.hash === '#all-editorials')
      || (window.location.pathname === '/editorial')
      || (window._papAutoOpenEditorials === true);
    if(!isEditorialTrigger) return;
    var overlay=document.getElementById('edAllOverlay');
    if(!overlay){ setTimeout(revealBody,60); return; }
    if(typeof openAllEditorials !== 'function'){ setTimeout(tryOpen,100); return; }
    // QA #246 — when arriving with ?tag=<value> (the "see editorials
    // with this tag" cross-link from articles.html), open the overlay
    // pre-filtered to that category. edAllCurrentCategory is the same
    // state the category pills mutate, so reuse it for consistency.
    var tagQuery = '';
    try {
      tagQuery = (new URLSearchParams(window.location.search).get('tag') || '').trim();
    } catch(_){}
    // Delay slightly so edData + dependent state is initialised.
    setTimeout(function(){
      try{
        if(tagQuery){
          edAllCurrentCategory = tagQuery.toLowerCase();
        }
        openAllEditorials();
      }catch(e){}
      setTimeout(revealBody,60);
    }, 80);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', tryOpen);
  } else {
    tryOpen();
  }
  window.addEventListener('hashchange', tryOpen);
})();
// 2026-07-26 — 언어 전환 시 열린 에디토리얼 상세를 새 언어로 재렌더(noPush: 히스토리 무오염).
try{ window.addEventListener('pap:langchange',function(){ try{ var ov=document.getElementById('edOverlay'); if(ov&&ov.classList.contains('active')&&window.__papOpenEd&&typeof _openEditorialInner_noPush==='function'){ _openEditorialInner_noPush(window.__papOpenEd.t,window.__papOpenEd.th); } }catch(e){} }); }catch(e){}


/* 9-language UI strings (2026-07-26) — _edL9(ko,en) resolves
   it/fr/es/ja/zh/ru/de from _ED_TR9 (keyed by Korean source);
   ko/en literals at each call site remain exact fallbacks. */
var _ED_TR9 = {"대표 관리자":{"it":"Caporedattore","fr":"Rédacteur en chef","es":"Editor jefe","ja":"編集長","zh":"主编","ru":"Главный редактор","de":"Chefredakteur"},"서브 관리자":{"it":"Redattore","fr":"Rédacteur","es":"Editor","ja":"編集者","zh":"编辑","ru":"Редактор","de":"Redakteur"},"참여 크리에이터":{"it":"Creator partecipante","fr":"Créateur participant","es":"Creador colaborador","ja":"参加クリエイター","zh":"参与创作者","ru":"Участвующий креатор","de":"Mitwirkender Kreativer"},"멤버십 회원":{"it":"Membro","fr":"Membre","es":"Miembro","ja":"会員","zh":"会员","ru":"Участник","de":"Mitglied"},"로그인 후 스크랩할 수 있어요":{"it":"Accedi per salvare gli elementi","fr":"Connectez-vous pour enregistrer","es":"Inicia sesión para guardar","ja":"ログインすると保存できます","zh":"登录后即可收藏","ru":"Войдите, чтобы сохранять","de":"Zum Speichern bitte anmelden"},"스크랩 실패":{"it":"Salvataggio non riuscito","fr":"Échec de l'enregistrement","es":"Error al guardar","ja":"保存に失敗しました","zh":"收藏失败","ru":"Не удалось сохранить","de":"Speichern fehlgeschlagen"},"저장됨":{"it":"Salvato","fr":"Enregistré","es":"Guardado","ja":"保存済み","zh":"已收藏","ru":"Сохранено","de":"Gespeichert"},"스크랩북에 저장됐어요":{"it":"Salvato nel tuo scrapbook","fr":"Enregistré dans votre carnet","es":"Guardado en tu álbum","ja":"スクラップブックに保存しました","zh":"已保存到收藏册","ru":"Сохранено в ваш альбом","de":"In Ihrem Sammelalbum gespeichert"},"스크랩":{"it":"Salva","fr":"Enregistrer","es":"Guardar","ja":"保存","zh":"收藏","ru":"Сохранить","de":"Speichern"},"멤버십 구독하기 →":{"it":"Abbonati →","fr":"S'abonner →","es":"Suscribirse →","ja":"メンバーシップに登録 →","zh":"订阅会员 →","ru":"Оформить подписку →","de":"Mitglied werden →"},"로그인":{"it":"Accedi","fr":"Se connecter","es":"Iniciar sesión","ja":"ログイン","zh":"登录","ru":"Войти","de":"Anmelden"},"개인 사용 및 비상업적 용도에 한해 사용 가능":{"it":"Solo per uso personale e non commerciale","fr":"Usage personnel et non commercial uniquement","es":"Solo para uso personal y no comercial","ja":"個人利用・非商用に限り使用可能","zh":"仅限个人及非商业用途","ru":"Только для личного некоммерческого использования","de":"Nur für den persönlichen, nicht kommerziellen Gebrauch"},"권한 확인 중...":{"it":"Verifica accesso...","fr":"Vérification de l'accès...","es":"Comprobando acceso...","ja":"アクセス権を確認中...","zh":"正在检查权限...","ru":"Проверка доступа...","de":"Zugriff wird geprüft..."},"<strong style=\"color:#fff\">스탠다드 멤버십</strong>부터 커버 및 로고 이미지를 다운로드할 수 있습니다.":{"it":"Con l'<strong style=\"color:#fff\">abbonamento Standard</strong> puoi scaricare le immagini composite (copertina + logo PAP).","fr":"L'<strong style=\"color:#fff\">abonnement Standard</strong> permet de télécharger les images composites (couverture + logo PAP).","es":"La <strong style=\"color:#fff\">membresía Standard</strong> permite descargar imágenes compuestas (portada + logo PAP).","ja":"<strong style=\"color:#fff\">スタンダード会員</strong>からカバー＋PAPロゴ合成画像をダウンロードできます。","zh":"<strong style=\"color:#fff\">标准会員</strong>起可下载封面＋PAP 徽标合成图片。","ru":"<strong style=\"color:#fff\">Подписка Standard</strong> открывает загрузку составных изображений (обложка + логотип PAP).","de":"Ab der <strong style=\"color:#fff\">Standard-Mitgliedschaft</strong> können Sie Composite-Bilder (Cover + PAP-Logo) herunterladen."},"스탠다드 구독하기 →":{"it":"Abbonati a Standard →","fr":"S'abonner à Standard →","es":"Suscribirse a Standard →","ja":"スタンダードに登録 →","zh":"订阅标准会员 →","ru":"Подписаться на Standard →","de":"Standard abonnieren →"},"전체 권한이 필요한 경우 PAP Magazine 운영팀에 문의해주세요.":{"it":"Serve l'accesso completo? Contatta il team di PAP Magazine.","fr":"Besoin d'un accès complet ? Contactez l'équipe de PAP Magazine.","es":"¿Necesitas acceso completo? Contacta al equipo de PAP Magazine.","ja":"全権限が必要な場合は PAP Magazine 運営チームにお問い合わせください。","zh":"需要完整权限？请联系 PAP Magazine 团队。","ru":"Нужен полный доступ? Свяжитесь с командой PAP Magazine.","de":"Vollzugriff nötig? Kontaktieren Sie das PAP-Magazine-Team."},"⬇️ 커버 이미지":{"it":"⬇️ Immagine di copertina","fr":"⬇️ Image de couverture","es":"⬇️ Imagen de portada","ja":"⬇️ カバー画像","zh":"⬇️ 封面图片","ru":"⬇️ Обложка","de":"⬇️ Coverbild"},"⬇️ 로고 이미지 (":{"it":"⬇️ Immagini logo (","fr":"⬇️ Images du logo (","es":"⬇️ Imágenes de logo (","ja":"⬇️ ロゴ画像 (","zh":"⬇️ 徽标图片 (","ru":"⬇️ Логотипы (","de":"⬇️ Logobilder ("},"장 ZIP)":{"it":" immagini ZIP)","fr":" images ZIP)","es":" imágenes ZIP)","ja":"枚 ZIP)","zh":" 张 ZIP)","ru":" изобр. ZIP)","de":" Bilder ZIP)"}," 권한":{"it":" accesso","fr":" accès","es":" acceso","ja":" 権限","zh":" 权限","ru":" доступ","de":" Zugriff"},"개인 사용 및 비상업적 용도에 한해 사용 가능 · 다운로드 이력이 기록됩니다.":{"it":"Solo per uso personale e non commerciale · i download vengono registrati.","fr":"Usage personnel et non commercial uniquement · les téléchargements sont enregistrés.","es":"Solo para uso personal y no comercial · las descargas quedan registradas.","ja":"個人利用・非商用に限り使用可能 · ダウンロード履歴が記録されます。","zh":"仅限个人及非商业用途 · 下载记录将被保存。","ru":"Только для личного некоммерческого использования · загрузки фиксируются.","de":"Nur für den persönlichen, nicht kommerziellen Gebrauch · Downloads werden protokolliert."},"구매 →":{"it":"Acquista →","fr":"Acheter →","es":"Comprar →","ja":"購入 →","zh":"购买 →","ru":"Купить →","de":"Kaufen →"},"링크를 통해 구매 시 PAP에 수수료가 지급될 수 있습니다.":{"it":"PAP potrebbe ricevere una commissione sugli acquisti effettuati tramite questi link.","fr":"PAP peut percevoir une commission sur les achats effectués via ces liens.","es":"PAP puede recibir una comisión por las compras realizadas a través de estos enlaces.","ja":"リンク経由での購入により PAP に手数料が支払われる場合があります。","zh":"通过这些链接购买时，PAP 可能获得佣金。","ru":"PAP может получать комиссию за покупки по этим ссылкам.","de":"PAP kann für Käufe über diese Links eine Provision erhalten."},"이 화보의 전체 시리즈는 <b style=\"color:#fff\">PAP에서 완전판</b>으로.<br><b style=\"color:#fff\">{n} 팔로워</b>가 매일 만나는 새 에디토리얼은 인스타그램에서.":{"it":"La serie completa è qui, <b style=\"color:#fff\">su PAP</b>.<br>Unisciti a <b style=\"color:#fff\">{n} follower</b> per nuovi editoriali ogni giorno.","fr":"La série complète est ici, <b style=\"color:#fff\">sur PAP</b>.<br>Rejoignez <b style=\"color:#fff\">{n} abonnés</b> pour de nouveaux éditoriaux chaque jour.","es":"La serie completa está aquí, <b style=\"color:#fff\">en PAP</b>.<br>Únete a <b style=\"color:#fff\">{n} seguidores</b> para nuevos editoriales cada día.","ja":"シリーズ全編は<b style=\"color:#fff\">PAPで</b>。<br><b style=\"color:#fff\">{n} フォロワー</b>が毎日出会う新作エディトリアルはInstagramで。","zh":"完整系列尽在 <b style=\"color:#fff\">PAP</b>。<br>加入 <b style=\"color:#fff\">{n} 关注者</b>，每天获取全新大片。","ru":"Полная серия — <b style=\"color:#fff\">на PAP</b>.<br>Присоединяйтесь к <b style=\"color:#fff\">{n} подписчикам</b> и смотрите новые эдиториалы каждый день.","de":"Die komplette Serie gibt es <b style=\"color:#fff\">auf PAP</b>.<br>Werden Sie einer von <b style=\"color:#fff\">{n} Followern</b> und entdecken Sie täglich neue Editorials."},"이 화보 공유 ↗":{"it":"Condividi ↗","fr":"Partager ↗","es":"Compartir ↗","ja":"シェア ↗","zh":"分享 ↗","ru":"Поделиться ↗","de":"Teilen ↗"},"@pap_magazine 팔로우 →":{"it":"Segui @pap_magazine →","fr":"Suivre @pap_magazine →","es":"Seguir @pap_magazine →","ja":"@pap_magazine をフォロー →","zh":"关注 @pap_magazine →","ru":"Подписаться на @pap_magazine →","de":"@pap_magazine folgen →"},"PAP의 화보와 필름, 패션·셀럽 소식을<br><b style=\"color:#fff\">인스타그램</b>에서 편하게 만나보세요.":{"it":"Editoriali, film, moda e news celebrity —<br>tutto in un posto su <b style=\"color:#fff\">Instagram</b>.","fr":"Éditoriaux, films, mode et actus célébrités —<br>tout au même endroit sur <b style=\"color:#fff\">Instagram</b>.","es":"Editoriales, películas, moda y noticias de celebridades —<br>todo en un lugar en <b style=\"color:#fff\">Instagram</b>.","ja":"エディトリアル、フィルム、ファッション・セレブニュースを<br><b style=\"color:#fff\">Instagram</b>でまとめてご覧ください。","zh":"大片、影片、时尚与名人资讯 —<br>尽在 <b style=\"color:#fff\">Instagram</b>。","ru":"Эдиториалы, фильмы, мода и новости о знаменитостях —<br>всё в одном месте в <b style=\"color:#fff\">Instagram</b>.","de":"Editorials, Filme, Mode- und Promi-News —<br>alles an einem Ort auf <b style=\"color:#fff\">Instagram</b>."},"인스타그램에서 보기 ↗":{"it":"Vedi su Instagram ↗","fr":"Voir sur Instagram ↗","es":"Ver en Instagram ↗","ja":"Instagramで見る ↗","zh":"在 Instagram 查看 ↗","ru":"Смотреть в Instagram ↗","de":"Auf Instagram ansehen ↗"}};
function _edL9(ko,en){ var l; try{l=localStorage.getItem('pap-lang')||'ko';}catch(e){l='ko';} if(l==='ko') return ko; var m=_ED_TR9[ko]; if(m&&m[l]) return m[l]; return en; }
