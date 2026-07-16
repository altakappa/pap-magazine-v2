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
    alert(lang==='ko' ? '로그인 후 스크랩할 수 있어요' : 'Please log in to save scraps');
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
        var msg = (out.j && out.j.message) || (lang==='ko'?'스크랩 실패':'Scrap failed');
        if(typeof window.showToast==='function') window.showToast(msg);
        else alert(msg);
        return;
      }
      // Success — flip the button to "Saved" state
      if(btn){
        btn.classList.add('saved');
        btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'+(lang==='ko'?'저장됨':'Saved');
        // Keep the saved state visible — it'll reset on next page load
      }
      if(typeof window.showToast==='function'){
        window.showToast(lang==='ko' ? '스크랩북에 저장됐어요' : 'Saved to your scrapbook');
      }
    }).catch(function(){
      if(btn) btn.disabled=false;
      var lang=(localStorage.getItem('pap-lang')||'ko');
      var msg = lang==='ko'?'스크랩 실패':'Scrap failed';
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
  var label = lang==='ko' ? '스크랩' : 'Save';
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
  // Show interstitial for free users (session limited)
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
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
  var coverUrl = (det && (det.coverImage || det.cover_image)) ||
                 (d && (d.cover_image || d.thumbnail)) || '';
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

  console.log('[downloads] rendering', { coverUrl: !!coverUrl, galleryCount: gallery.length, title: title });

  // 항상 박스 표시 — 커버/갤러리 없는 에지 케이스에도 회원가입 CTA는 보여줌.
  box.style.display = '';

  // QA #271 v3 — 회원 가입한 사용자만 다운로드 가능.
  // 비로그인 → 회원가입 CTA 표시.
  var loggedIn = (typeof isLoggedIn === 'function') ? isLoggedIn()
              : (typeof PAP !== 'undefined' && PAP.auth && PAP.auth.isLoggedIn && PAP.auth.isLoggedIn());

  if (!loggedIn){
    // CTA — 회원가입 유도.
    box.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' +
        '<div style="font-size:13px;color:#ccc">커버 이미지 + PAP 로고 합성 갤러리 이미지 다운로드는 <strong style="color:#fff">회원가입한 사용자</strong> 전용입니다.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
          '<a href="/auth?mode=signup" style="display:inline-block;padding:10px 22px;border:1px solid #fff;background:#fff;color:#000;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .2s" onmouseover="this.style.background=\'transparent\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#fff\';this.style.color=\'#000\'">회원가입하기 →</a>' +
          '<a href="/auth" style="display:inline-block;padding:10px 22px;border:1px solid #555;color:#fff;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .2s" onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">로그인</a>' +
        '</div>' +
        '<div style="font-size:11px;color:#666;margin-top:4px">개인 사용 및 비상업적 용도에 한해 사용 가능</div>' +
      '</div>';
    return;
  }

  // QA #284 Phase 2 — 로그인 사용자라도 role에 따라 분기.
  //   admin/staff             → 다운로드 버튼 노출
  //   user + 본인 참여 editorial → 다운로드 버튼 노출
  //   user + 그 외             → 안내 메시지 노출
  // 권한 체크는 서버 호출 → loading 상태 먼저 표시.
  box.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' +
      '<div style="font-size:12px;color:#666">권한 확인 중...</div>' +
    '</div>';

  var edId = (d && d.id) || (det && det.id) || '';
  window._papCheckDownloadPerm('editorial', edId).then(function(perm){
    if (!perm || !perm.allowed){
      // role별 메시지 분기.
      var msg;
      if (perm && perm.role === 'user'){
        msg = '이 에디토리얼은 <strong style="color:#fff">참여 크리에이터 본인</strong>만 다운로드할 수 있습니다.<br>본인 참여작이라면 가입하신 이메일과 동일한 계정으로 로그인되어 있는지 확인해주세요.';
      } else {
        msg = '다운로드 권한이 없습니다.';
      }
      box.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:10px">' +
          '<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' +
          '<div style="font-size:12px;color:#bbb;line-height:1.6">' + msg + '</div>' +
          '<div style="font-size:11px;color:#666;margin-top:4px">전체 권한이 필요한 경우 PAP Magazine 운영팀에 문의해주세요.</div>' +
        '</div>';
      return;
    }
    // 권한 OK — 다운로드 버튼 렌더링.
    _renderEditorialDownloadButtons(box, coverUrl, gallery, safeTitle, perm);
  });
  return;
}

// QA #284 Phase 2 — 권한 OK인 사용자에게 실제 버튼 노출.
function _renderEditorialDownloadButtons(box, coverUrl, gallery, safeTitle, perm){
  // 로그인 사용자 — 실제 다운로드 버튼.
  var coverHtml = '';
  if (coverUrl) {
    coverHtml =
      '<a href="#" onclick="event.preventDefault();_papDownloadAsFile(\'' + coverUrl.replace(/'/g, "\\'") + '\',\'' + safeTitle + '-cover\');return false;" ' +
      'style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:1px solid #555;color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .2s" ' +
      'onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">⬇️ 커버 이미지</a>';
  }
  var logoBtnHtml = '';
  if (gallery.length) {
    var galleryJson = encodeURIComponent(JSON.stringify(gallery));
    logoBtnHtml =
      '<button id="edLogoDlBtn" type="button" onclick="_papDownloadLogoZip(this)" ' +
      'data-gallery="' + galleryJson + '" data-title="' + safeTitle + '" ' +
      'style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:1px solid #555;background:transparent;color:#fff;font-size:11px;font-weight:700;letter-spacing:.12em;cursor:pointer;transition:all .2s" ' +
      'onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">⬇️ 로고 이미지 (' + gallery.length + '장 ZIP)</button>';
  }
  // QA #284 Phase 2 — role 배지 (어느 권한으로 노출되는지 명확하게).
  var roleBadge = '';
  if (perm && perm.reason){
    var badgeText = { admin:'대표 관리자', staff:'서브 관리자', owner:'참여 크리에이터' }[perm.reason] || '';
    var badgeColor = { admin:'#e74c3c', staff:'#f39c12', owner:'#27ae60' }[perm.reason] || '#888';
    if (badgeText){
      roleBadge = '<span style="display:inline-block;padding:2px 8px;background:' + badgeColor + ';color:#fff;font-size:9px;font-weight:700;letter-spacing:.1em;border-radius:2px">' + badgeText + ' 권한</span>';
    }
  }
  box.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' + roleBadge + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + coverHtml + logoBtnHtml + '</div>' +
      '<div id="edLogoDlStatus" style="font-size:11px;color:#888;min-height:14px"></div>' +
      '<div style="font-size:11px;color:#666">개인 사용 및 비상업적 용도에 한해 사용 가능 · 다운로드 이력이 기록됩니다.</div>' +
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
      var token = (typeof getToken === 'function') ? getToken() :
                  (window.localStorage && localStorage.getItem('token')) || '';
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
    var token = (typeof getToken === 'function') ? getToken() :
                (window.localStorage && localStorage.getItem('token')) || '';
    fetch('/api/downloads/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? ('Bearer ' + token) : '',
      },
      body: JSON.stringify(Object.assign({ consented: true }, payload || {})),
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
// 사용자가 어드민에서 미세조정한 값은 알 수 없으므로 기본값 사용 (사용자 요청:
// "이미지 편집할게 없다면 편집 반영되지 않은 그대로 로고이미지...").
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
  // 캔버스 크기 = 원본 크기 (단, 너무 크면 한 변 최대 2000px로 제한).
  var MAX_DIM = 2000;
  var LOGO_PCT = 15, PAD_PCT = 1, ALPHA = 0.85;
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
      // 원본 비율 유지 + 한 변 최대 2000px.
      var iw = srcImg.naturalWidth, ih = srcImg.naturalHeight;
      var W = iw, H = ih;
      if (W > MAX_DIM || H > MAX_DIM){
        var ratio = MAX_DIM / Math.max(W, H);
        W = Math.round(W * ratio);
        H = Math.round(H * ratio);
      }
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, W, H);
      // 원본을 캔버스 전체로 그림 (비율 유지, crop 없음).
      ctx.drawImage(srcImg, 0, 0, W, H);
      // 로고 합성 (너비의 LOGO_PCT% 기준, 하단 PAD_PCT% 여백).
      var logoW = W * (LOGO_PCT / 100);
      var logoH = logoW * (logo.naturalHeight / logo.naturalWidth);
      var prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = ALPHA;
      ctx.drawImage(logo, (W - logoW) / 2, H - logoH - (H * (PAD_PCT / 100)), logoW, logoH);
      ctx.globalAlpha = prevAlpha;
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
function _papRenderShopRow(fashion){
  var box=document.getElementById('edShopRow');
  if(!box) return;
  var brands=(Array.isArray(fashion)?fashion:[]).map(function(h){return String(h||'').trim();}).filter(function(h){return h && h!=='@brand';});
  if(!brands.length){ box.innerHTML=''; box.style.display='none'; return; }
  var chips=brands.slice(0,12).map(function(h){
    var clean=h.replace(/^@+/,'');
    return '<a href="/go/'+encodeURIComponent(clean.toLowerCase())+'" target="_blank" rel="sponsored nofollow noopener" '
      +'style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;border:1px solid rgba(255,255,255,.25);font-size:12px;color:#fff;text-decoration:none;letter-spacing:.04em">'
      +clean.replace(/</g,'&lt;')+' <span style="opacity:.55">구매 →</span></a>';
  }).join('');
  box.innerHTML=
    '<div style="margin:36px 0 0;padding:24px;border:1px solid rgba(255,255,255,.16)">'
    +'<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:12px">Shop the Story</div>'
    +'<div>'+chips+'</div>'
    +'<div style="font-size:10.5px;color:#666;margin-top:8px">링크를 통해 구매 시 PAP에 수수료가 지급될 수 있습니다.</div>'
    +'</div>';
  box.style.display='';
}

// 폴백 CTA 사회적 증거 (2026-07-16) — 팔로워 수는 대략치로 표기하고 성장 시
// 여기 한 곳만 갱신한다. (실시간 조회는 Graph API 호출 비용 대비 과함)
var _PAP_IG_FOLLOWERS_KO='37만';
var _PAP_IG_FOLLOWERS_EN='370K+';
function _papRenderEdIg(igUrl, title){
  var box=document.getElementById('edIgPostCta');
  if(!box) return;
  if(!igUrl || !/instagram\.com\//.test(String(igUrl))){
    // 원본 IG 게시물이 없는 아카이브(옛 계정 게시분·미게시) — 영구 폴백.
    // 2026-07-16 개선: ① 팔로워 수 사회적 증거 ② 주 CTA=팔로우(채움)·보조=공유(외곽선)
    // 로 계층 역전 ③ 프로필 링크를 /api/ig-out 경유로 바꿔 아웃클릭 계측(src=spa_fallback).
    var _kf=(localStorage.getItem('pap-lang')||'ko')==='ko';
    var _bf=_kf
      ? '이 화보의 전체 시리즈는 <b style="color:#fff">PAP에서 완전판</b>으로.<br><b style="color:#fff">'+_PAP_IG_FOLLOWERS_KO+' 팔로워</b>가 매일 만나는 새 에디토리얼은 인스타그램에서.'
      : 'The complete series lives here, <b style="color:#fff">on PAP</b>.<br>Join <b style="color:#fff">'+_PAP_IG_FOLLOWERS_EN+' followers</b> for new editorials daily.';
    var _sf=_kf ? '이 화보 공유 ↗' : 'Share this editorial ↗';
    var _ff=_kf ? '@pap_magazine 팔로우 →' : 'Follow @pap_magazine →';
    var _igOut='/api/ig-out?src=spa_fallback&to=profile&url='+encodeURIComponent('https://www.instagram.com/pap_magazine/');
    box.innerHTML=
      '<aside style="margin:36px 0 0;padding:26px 24px;border:1px solid rgba(255,255,255,.16);text-align:center">'
      +'<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:10px">Full Editorial</div>'
      +'<div style="font-size:13.5px;line-height:1.7;color:#ddd;margin-bottom:16px">'+_bf+'</div>'
      +'<a href="'+_igOut+'" target="_blank" rel="noopener" style="display:inline-block;background:#fff;color:#000;padding:11px 26px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none;margin:0 6px 8px">'+_ff+'</a>'
      +'<button onclick="_papShareStory()" style="background:none;color:#fff;border:1px solid rgba(255,255,255,.28);padding:11px 26px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;margin:0 6px 8px">'+_sf+'</button>'
      +'</aside>';
    box.style.display=''; return;
  }
  var safe=String(igUrl).replace(/"/g,'&quot;');
  var permalink=String(igUrl).split('?')[0];
  if(!/\/$/.test(permalink)) permalink+='/';
  var canEmbed=/instagram\.com\/(p|reel|tv)\//.test(permalink);
  box.innerHTML=
    (canEmbed
      ? '<div style="margin:36px auto 0;max-width:540px">'
        +'<blockquote class="instagram-media" data-instgrm-permalink="'+permalink.replace(/"/g,'&quot;')+'" data-instgrm-version="14" style="background:#000;border:1px solid rgba(255,255,255,.16);margin:0 auto;max-width:540px;min-width:280px;width:100%"></blockquote>'
        +'</div>'
      : '')
    +(function(){
       // 웹 감상 유도 (2026-07) — 원본은 인스타가 아니라 이 웹사이트에 완전판으로
       // 있다는 방향으로 전환. IG 임베드(위)는 사회적 증거로 유지하되, 카피·버튼은
       // 웹 중심(공유=PAP 페이지). 언어에 따라 KO/EN 노출(그 외 언어는 EN).
       var _ko=(localStorage.getItem('pap-lang')||'ko')==='ko';
       var _body=_ko
         ? '인스타그램에서는 한 컷만. 이 화보의 전체 시리즈는 <b style="color:#fff">PAP에서 완전판</b>으로 감상하세요.'
         : 'Instagram shows a single frame. The complete series lives here, <b style="color:#fff">on PAP</b>.';
       var _share=_ko ? '이 화보 공유 ↗' : 'Share this editorial ↗';
       return '<aside style="margin:'+(canEmbed?'14px':'36px')+' 0 0;padding:26px 24px;border:1px solid rgba(255,255,255,.16);text-align:center">'
         +'<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:10px">Full Editorial</div>'
         +'<div style="font-size:13.5px;line-height:1.7;color:#ddd;margin-bottom:16px">'+_body+'</div>'
         +'<button onclick="_papShareStory()" style="display:inline-block;background:#fff;color:#000;border:none;padding:11px 26px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;cursor:pointer">'+_share+'</button>'
         +'</aside>';
     })();
  box.style.display='';
  if(canEmbed && typeof _papLoadIgEmbed==='function'){try{_papLoadIgEmbed();}catch(_){}}
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
    var _needsHydrate = (!_imgs && _credsArr.length === 0 && !_hasDesc);
    if(_needsHydrate && d.id){
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
        // Merge the rich fields back onto edDetails[title] so subsequent
        // opens hit the populated cache.
        var dst = edDetails[title] || {};
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
        if(ko || en) dst.desc = { ko: ko, en: en };
        // QA #231 — pass related_films through too so the "RELATED FILMS"
        // section appears when the fallback fetch is the path that hydrates
        // the editorial (otherwise the editor would see the films on a
        // direct /editorial/<slug> reload but not on an in-app overlay).
        if(Array.isArray(full.related_films)) {
          dst.relatedFilms = full.related_films;
        }
        // 참여 증폭 2.0 — 원본 IG 게시물 permalink.
        if(full.source_instagram_url) dst.ig = full.source_instagram_url;
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
      fetch('/api/editorials/' + encodeURIComponent(d.id) + '/view', {
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
  if(typeof _papRenderShopRow==='function'){try{_papRenderShopRow(det.fashion);}catch(_){}}

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
  var imgCreditsMap = (det.imageCredits && typeof det.imageCredits === 'object') ? det.imageCredits : {};
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
               + '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safe+'\')">'+handle+'</a>'
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
          credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+fHandle.replace(/'/g,"")+'\')">'+fDisplay+'</a>';
        }
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)">'+_scrapBtnHtml(url,title)+'<div class="ed-img-credits">'+credits+'</div></div>';
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

  // Social: comments (별점은 아래 상단 CTA로 이전됨)
  var socialSlot=document.getElementById('edSocialSlot');
  if(socialSlot && typeof PAPSocial!=='undefined'){
    PAPSocial.renderEditorialSocial(socialSlot, title);
  }

  // 참여율 개선 (2026-07) — 별점 CTA(본문 상단). ratings 테이블 재사용.
  var edRatingCta=document.getElementById('edRatingCta');
  if(edRatingCta && typeof PAPSocial!=='undefined' && PAPSocial.renderEditorialRatingCta){
    PAPSocial.renderEditorialRatingCta(edRatingCta, title);
  }
  // 체류시간 개선 (2026-07) — 임베딩 기반 관련 화보. id 없거나 결과 없으면 숨김.
  var edRelated=document.getElementById('edRelatedEditorials');
  if(edRelated && typeof PAPSocial!=='undefined' && PAPSocial.renderRelatedEditorials){
    PAPSocial.renderRelatedEditorials(edRelated, d && d.id);
  }

  // More content carousel
  var track=document.getElementById('edMoreTrack');
  track.innerHTML='';
  var shown=0;
  edData.forEach(function(ed){
    if(ed.title===title||shown>=8) return;
    var esc=ed.title.replace(/'/g,"\\'");
    track.innerHTML+='<div class="ed-more-card" onclick="openEditorial(\''+esc+'\',\''+ed.img+'\')"><img src="'+ed.img+'" alt="'+ed.title+'" onerror="edImgError(this)"><div class="ed-more-card-cat">EDITORIAL & FASHION - '+ed.date+'</div><div class="ed-more-card-title">'+ed.title+'</div></div>';
    shown++;
  });

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
    var _epath = '/editorial/' + _edSlug;
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
  if(typeof _papRenderShopRow==='function'){try{_papRenderShopRow(det.fashion);}catch(_){}}
  var descEl=document.getElementById('edDetailDesc');
  if(descEl){var lang=localStorage.getItem('pap-lang')||'ko';var descText=typeof det.desc==='object'?(det.desc[lang]||det.desc.en||det.desc.ko||''):det.desc;descEl.innerHTML=descText;}
  var gal=document.getElementById('edDetailGallery');
  gal.innerHTML='';
  // Same per-image credit priority as the main openEditorial path:
  // admin's "이미지별 착장 크레딧" string wins, then rotating brand fallback.
  var imgCreditsMap = (det.imageCredits && typeof det.imageCredits === 'object') ? det.imageCredits : {};
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
               + '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safe+'\')">'+handle+'</a>'
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
          credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+fHandle.replace(/'/g,"")+'\')">'+fDisplay+'</a>';
        }
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)">'+_scrapBtnHtml(url,title)+'<div class="ed-img-credits">'+credits+'</div></div>';
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
    if(isPremium()&&logoFolderId){
      logoSection.innerHTML='<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999;">LOGO FILES</span><a href="https://drive.google.com/drive/folders/'+logoFolderId+'" target="_blank" rel="noopener" style="display:inline-block;padding:6px 16px;border:1px solid #555;color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .3s;" onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">DOWNLOAD</a></div>';
      logoSection.style.display='';
    } else { logoSection.style.display='none'; }
  }
  var socialSlot=document.getElementById('edSocialSlot');
  if(socialSlot&&typeof PAPSocial!=='undefined') PAPSocial.renderEditorialSocial(socialSlot,title);
  // 참여율/체류시간 개선 (2026-07) — popstate 복원 경로도 push 경로와 동일하게.
  var edRatingCta2=document.getElementById('edRatingCta');
  if(edRatingCta2&&typeof PAPSocial!=='undefined'&&PAPSocial.renderEditorialRatingCta) PAPSocial.renderEditorialRatingCta(edRatingCta2,title);
  var edRelated2=document.getElementById('edRelatedEditorials');
  if(edRelated2&&typeof PAPSocial!=='undefined'&&PAPSocial.renderRelatedEditorials) PAPSocial.renderRelatedEditorials(edRelated2, d && d.id);
  var track=document.getElementById('edMoreTrack');
  track.innerHTML='';
  var shown=0;
  edData.forEach(function(ed){
    if(ed.title===title||shown>=8) return;
    var esc=ed.title.replace(/'/g,"\\'");
    track.innerHTML+='<div class="ed-more-card" onclick="openEditorial(\''+esc+'\',\''+ed.img+'\')"><img src="'+ed.img+'" alt="'+ed.title+'" onerror="edImgError(this)"><div class="ed-more-card-cat">EDITORIAL & FASHION - '+ed.date+'</div><div class="ed-more-card-title">'+ed.title+'</div></div>';
    shown++;
  });
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
  try { location.href = '/editorial/' + slug; } catch(_){}
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
function _renderEdAllPaywall(overlay){
  var grid=document.getElementById('edAllGrid');
  var count=document.getElementById('edAllCount');
  var pag=document.getElementById('edAllPagination');
  var filt=document.getElementById('edCatFilter');
  // 잠금 화면에서는 카테고리 필터·개수·페이지네이션을 숨긴다.
  if(count) count.textContent='';
  if(pag) pag.innerHTML='';
  if(filt) filt.style.display='none';

  var loggedIn=(typeof isLoggedIn==='function') && isLoggedIn();
  if(grid){
    grid.style.display='block';
    grid.innerHTML=
      '<div style="max-width:520px;margin:40px auto;padding:40px 28px;border:1px solid rgba(255,255,255,.16);text-align:center;color:#fff">'
      + '<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:14px">Editorial Archive</div>'
      + '<div style="font-size:20px;font-weight:700;letter-spacing:.02em;margin-bottom:12px">에디토리얼 전체보기는 멤버 전용입니다</div>'
      + '<div style="font-size:13.5px;line-height:1.75;color:#bbb;margin-bottom:24px">'
      +   'Standard 이상 멤버가 되시면 2,400편 이상의 에디토리얼 아카이브를<br>제한 없이 열람하실 수 있습니다.'
      + '</div>'
      + '<a href="/subscribe" style="display:inline-block;margin:4px 5px 0;background:#fff;color:#000;padding:13px 32px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;text-decoration:none">구독하기</a>'
      + (loggedIn ? '' :
          '<a href="/auth" style="display:inline-block;margin:4px 5px 0;background:transparent;color:#ddd;border:1px solid rgba(255,255,255,.28);padding:13px 26px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;text-decoration:none">로그인</a>')
      + '</div>';
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
  // URL 은 /editorial 로 맞춰 둔다(뒤로가기 시 이전 페이지로 정확히 복귀).
  try{
    if(window.location.pathname==='/editorial') history.replaceState({allEditorials:true},'','/editorial');
    else history.pushState({allEditorials:true},'','/editorial');
  }catch(e){}
}

function _openAllEditorialsInner(){
  var overlay=document.getElementById('edAllOverlay');
  if(!overlay) return;
  // 멤버십 체크 — 미달 시 alert/리다이렉트 대신 목록 화면 안에서 잠금 + 업셀.
  if(!isStandardOrAbove()){
    _renderEdAllPaywall(overlay);
    return;
  }
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
  var availableData;
  if(premium){
    availableData=filtered;
  }else if(standard){
    var _cut6=new Date(); _cut6.setMonth(_cut6.getMonth()-6); _cut6.setHours(0,0,0,0);
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
  var totalPages=Math.ceil(availableData.length/PAP_PER_PAGE);
  if(edAllCurrentPage>totalPages) edAllCurrentPage=totalPages||1;
  var startIdx=(edAllCurrentPage-1)*PAP_PER_PAGE;
  var pageItems=availableData.slice(startIdx,startIdx+PAP_PER_PAGE);
  pageItems.forEach(function(e){
    var card=document.createElement('div');
    card.className='ed-row-card';
    card.onclick=function(){openEditorial(e.title,e.img);};
    var catLabel = (function(){
      var tags = Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? e.tags.split(',') : []);
      var nice = tags.filter(function(t){
        var s = String(t).trim().toLowerCase();
        return s && s !== 'editorial';
      }).map(function(t){
        return String(t).trim().toUpperCase();
      });
      return (nice.length ? 'EDITORIAL & ' + nice[0] : 'EDITORIAL');
    })();
    card.innerHTML='<div class="ed-row-card-img"><img src="'+e.img+'" alt="'+e.title+'" onerror="edImgError(this)"></div><div class="ed-row-card-info"><div class="ed-row-card-cat">'+catLabel+' · '+e.date+'</div><div class="ed-row-card-title">'+e.title+'</div></div>';
    grid.appendChild(card);
  });
  if(!pageItems.length){
    var empty=document.createElement('div');
    empty.style.cssText='grid-column:1/-1;text-align:center;padding:60px 20px;color:#666;font-size:12px;letter-spacing:.1em';
    empty.textContent = 'NO EDITORIALS IN THIS CATEGORY';
    grid.appendChild(empty);
  }
  if(!premium&&edAllCurrentPage===totalPages&&filtered.length>availableData.length){
    // 소프트 페이월(2026-07 전환): 차단이 아니라 프리미엄 가치를 보여주는 카드로 설득.
    var _ko=(localStorage.getItem('pap-lang')||'ko')==='ko';
    var _more=filtered.length-availableData.length;
    var upsell=document.createElement('div');
    upsell.style.cssText='grid-column:1/-1;padding:8px 20px 48px;';
    var _head=standard
      ? (_ko?'Premium으로 전체 아카이브 열기':'Open the full archive with Premium')
      : (_ko?'무료 미리보기는 여기까지예요':'The free preview ends here');
    var _sub=standard
      ? (_ko?'지금은 최근 6개월치를 보고 계세요. Premium 멤버는 2,400편 이상 전체 아카이브와 풀레터까지 이용할 수 있어요.':'You are seeing the last 6 months. Premium unlocks the full 2,400+ editorial archive and Pull-Letters.')
      : (_ko?('멤버가 되면 '+_more+'편을 더 볼 수 있어요 — 광고 없이, 이미지 다운로드와 서브미션 피드백까지.'):('Become a member to unlock '+_more+' more editorials — ad-free, with image downloads and submission feedback.'));
    var _feats=standard
      ? [_ko?'2,400+ 전체 아카이브':'Full 2,400+ archive',_ko?'풀레터 요청':'Pull-Letter requests',_ko?'광고 없이 · 다운로드':'Ad-free · downloads']
      : [_ko?'최근 6개월 에디토리얼':'Last 6 months of editorials',_ko?'광고 없이 감상':'Ad-free reading',_ko?'이미지 다운로드':'Image downloads',_ko?'서브미션 피드백':'Submission feedback'];
    var _btn=standard?(_ko?'Premium 업그레이드':'Upgrade to Premium'):(_ko?'구독하고 전체 보기':'Subscribe to see all');
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
  count.textContent=availableData.length+' EDITORIALS'+(premium?'':' (PREMIUM: '+filtered.length+')');
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


