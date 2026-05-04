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

function _openEditorialInner(title,thumb){
  var d=edDetails[title];
  if(!d){var titleLower=title.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===titleLower){d=edDetails[key];break;}}}
  d=d||{};
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
  var det={issue:d.issue||'MAR. ISSUE',thumb:d.thumb||thumb,images:d.images||[thumb,thumb],credits:(_normCr.length?_normCr:[{r:'Photography',h:['@photographer']},{r:'Stylist',h:['@stylist']}]),fashion:d.fashion||['@brand'],imageCredits:d.imageCredits||{},desc:d.desc||''};

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
      // Show fashion brands as hover overlay on each image (rotate through)
      var fLen=det.fashion.length;
      if(fLen>0){
        var perImgCount=Math.max(2,Math.ceil(fLen/det.images.length));
        var start=(idx*perImgCount)%fLen;
        for(var fi=0;fi<perImgCount&&fi<fLen;fi++){
          var f=det.fashion[(start+fi)%fLen];
          var fHandle=typeof f==='object'?f.id||'':f;
          var fDisplay=typeof f==='object'&&f.n?f.n:fHandle.replace(/^@/,'');
          credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+fHandle.replace(/'/g,"")+'\')">'+fDisplay+'</a>';
        }
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)">'+_scrapBtnHtml(url,title)+'<div class="ed-img-credits">'+credits+'</div></div>';
  });

  // Credits table — supports name+handle objects or plain handle strings
  var cr=document.getElementById('edDetailCredits');
  var ch='';
  det.credits.forEach(function(c){
    var vals=c.h.map(function(h){var handle,displayName;if(typeof h==='object'&&h.n){handle=h.id||'';displayName=h.n;}else{handle=h;displayName=h.replace(/^@/,'');}var safeHandle=handle.replace(/'/g,"");return '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safeHandle+'\')">'+displayName+'</a>';}).join(', ');
    ch+='<div class="ed-cred-row"><div class="ed-cred-role">'+c.r+'</div><div class="ed-cred-val">'+vals+'</div></div>';
  });
  // Fashion by — removed (shown as hover credits on images)
  cr.innerHTML=ch;

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
        +'<a href="/mypage.html#downloads" style="display:inline-block;padding:6px 16px;border:1px solid #555;color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .3s;" onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'" data-i18n="distKitGoMypage">'
          +(_t_dk.distKitGoMypage || '마이페이지로 이동 →')
        +'</a>'
      +'</div>';
    logoSection.style.display='';
  } else {
    logoSection.style.display='none';
  }

  // Social: rating + comments
  var socialSlot=document.getElementById('edSocialSlot');
  if(socialSlot && typeof PAPSocial!=='undefined'){
    PAPSocial.renderEditorialSocial(socialSlot, title);
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
  // Push state with editorial info so popstate can restore it
  var _edThumb=det.thumb||thumb||'';
  // replaceState when arriving via deep-link (#editorial/Title already in URL),
  // pushState for in-app opens — prevents duplicate history entries that
  // would make the X / back button land on the same hash.
  try{
    var _ehash='#editorial/'+encodeURIComponent(title);
    var _epath=window.location.pathname+_ehash;
    if(window.location.hash===_ehash){
      history.replaceState({editorial:true,title:title,thumb:_edThumb},'',_epath);
    }else{
      history.pushState({editorial:true,title:title,thumb:_edThumb},'',_epath);
    }
  }catch(e){window.location.hash='#editorial/'+encodeURIComponent(title);}
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
  var det={issue:d.issue||'MAR. ISSUE',thumb:d.thumb||thumb,images:d.images||[thumb,thumb],credits:(_normCr.length?_normCr:[{r:'Photography',h:['@photographer']},{r:'Stylist',h:['@stylist']}]),fashion:d.fashion||['@brand'],imageCredits:d.imageCredits||{},desc:d.desc||''};
  // SEO — same meta refresh as _openEditorialInner (back/forward path).
  if(typeof _updateEditorialMeta === 'function'){
    try { _updateEditorialMeta(title, det); } catch(_){}
  }
  var heroImg=document.getElementById('edDetailHero');
  heroImg.onerror=function(){edImgError(this);};
  heroImg.src=det.thumb;
  document.getElementById('edDetailTitle').textContent=title;
  document.getElementById('edDetailIssue').textContent=det.issue;
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
      var fLen=det.fashion.length;
      if(fLen>0){
        var perImgCount=Math.max(2,Math.ceil(fLen/det.images.length));
        var start=(idx*perImgCount)%fLen;
        for(var fi=0;fi<perImgCount&&fi<fLen;fi++){
          var f=det.fashion[(start+fi)%fLen];
          var fHandle=typeof f==='object'?f.id||'':f;
          var fDisplay=typeof f==='object'&&f.n?f.n:fHandle.replace(/^@/,'');
          credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+fHandle.replace(/'/g,"")+'\')">'+fDisplay+'</a>';
        }
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)">'+_scrapBtnHtml(url,title)+'<div class="ed-img-credits">'+credits+'</div></div>';
  });
  var cr=document.getElementById('edDetailCredits');
  var ch='';
  det.credits.forEach(function(c){
    var vals=c.h.map(function(h){var handle,displayName;if(typeof h==='object'&&h.n){handle=h.id||'';displayName=h.n;}else{handle=h;displayName=h.replace(/^@/,'');}var safeHandle=handle.replace(/'/g,"");return '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+safeHandle+'\')">'+displayName+'</a>';}).join(', ');
    ch+='<div class="ed-cred-row"><div class="ed-cred-role">'+c.r+'</div><div class="ed-cred-val">'+vals+'</div></div>';
  });
  cr.innerHTML=ch;
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
  if(!skipHistory && window.location.hash.indexOf('#editorial/')===0){
    history.back();
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
function _openAllEditorialsInner(){
  // Membership check: free members cannot access all editorials
  if(!isStandardOrAbove()){
    alert(getLangText('edAccessFree','에디토리얼 전체보기는 스탠다드 이상 회원만 이용 가능합니다.\nStandard membership or above is required to browse all editorials.'));
    window.location.href='subscribe.html';
    return;
  }
  var overlay=document.getElementById('edAllOverlay');
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
  // If we arrived via a direct hash navigation (e.g. user clicked
  // EDITORIAL in the hamburger menu of a sub-page, which sends them to
  // /index.html#all-editorials as a full nav), the hash is ALREADY in
  // place from the navigation. A pushState would create a duplicate
  // history entry — back from there lands on the same hash again,
  // which appears to the user as "X did nothing useful" or "X dumped
  // me on home". Use replaceState in that case so back goes to the
  // actual previous page.
  var _h='#all-editorials';
  if(window.location.hash===_h){
    history.replaceState({allEditorials:true},'',window.location.pathname+_h);
  }else{
    history.pushState({allEditorials:true},'',window.location.pathname+_h);
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
  var limit=premium?filtered.length:100;
  var availableData=filtered.slice(0,limit);
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
  if(standard&&edAllCurrentPage===totalPages&&filtered.length>100){
    var upsell=document.createElement('div');
    upsell.style.cssText='grid-column:1/-1;text-align:center;padding:40px 20px;';
    upsell.innerHTML='<p style="color:#999;font-size:12px;letter-spacing:.1em;margin-bottom:12px;">PREMIUM MEMBERS CAN ACCESS ALL '+filtered.length+' EDITORIALS</p><a href="subscribe.html" style="display:inline-block;padding:10px 28px;background:#fff;color:#000;font-size:11px;font-weight:700;letter-spacing:.1em;text-decoration:none;">UPGRADE TO PREMIUM</a>';
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
    if(!skipHistory && window.location.hash==='#all-editorials'){history.back();}
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
    if(window.location.hash !== '#all-editorials') return;
    var overlay=document.getElementById('edAllOverlay');
    if(!overlay){ setTimeout(revealBody,60); return; }
    if(typeof openAllEditorials !== 'function'){ setTimeout(tryOpen,100); return; }
    // Delay slightly so edData + dependent state is initialised.
    setTimeout(function(){
      try{ openAllEditorials(); }catch(e){}
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


