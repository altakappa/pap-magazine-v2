

// ======== BETA MODE CONFIG ========
// 베타 기간 중에는 "로그인한 회원(무료/스탠다드/프리미엄 모두 포함)"에게만 전체 콘텐츠 오픈
// 비로그인 방문자는 유료 서비스에 접근 불가 (로그인 유도)
// 베타 종료 후에는 구독 등급(free/standard/premium)에 따라 접근 차등 적용
// 날짜 형식: 'YYYY-MM-DD' (예: '2026-12-31') 또는 null (베타 무기한)
var PAP_BETA_END = '2026-05-06';   // ← 베타 종료 날짜 (2026년 5월 6일 23:59:59까지)

function isBetaActive(){
  if(!PAP_BETA_END) return true; // null이면 무기한 베타
  var now = new Date();
  var end = new Date(PAP_BETA_END + 'T23:59:59');
  return now <= end;
}

// Modal scroll lock (lockScroll/unlockScroll, _scrollLockCount, _savedScrollY)
// extracted to pap-utils.js (mission 5). pap-utils.js MUST be loaded before
// this file — the safety timer below references _scrollLockCount as a global.
//
// i18n (T dict, lang, setLang, _applyArticleCardI18n, _loadArticleI18n) extracted to
// pap-i18n.js (mission 3). pap-i18n.js MUST be loaded before this file — search /
// modal / pagination code below reads `lang` and `T` as bare globals.

// ======== LOADER ========
(function(){
  var bg=document.getElementById('loaderBg');
  if(bg){
    var slides=document.querySelectorAll('.hero-slide-img');
    if(slides.length){
      var src=slides[Math.floor(Math.random()*slides.length)].src;
      var img=new Image();
      img.onload=function(){bg.style.backgroundImage='url('+src+')';bg.classList.add('loaded');};
      img.src=src;
    }
  }
})();
window.addEventListener('load',()=>{var _l=document.getElementById('loader');if(_l)setTimeout(()=>_l.classList.add('hidden'),800);});
setTimeout(()=>{var _l=document.getElementById('loader');if(_l)_l.classList.add('hidden');},3000);

// Safety: force unlock scroll if body is stuck after page load
setTimeout(function(){
  var bs=document.body.style;
  if(bs.overflow==='hidden' && bs.position==='fixed'){
    var noOverlay=!document.getElementById('premiumInterstitial')&&!document.querySelector('.signupPopup.active,.access-gate-overlay');
    if(noOverlay){ _scrollLockCount=0; unlockScroll(); console.warn('Scroll was stuck — force unlocked'); }
  }
},4000);

// ======== HERO SLIDER ========
let hCur=0;const hSlides=document.querySelectorAll('.hero-slide');
function heroGo(n){if(!hSlides.length)return;hSlides[hCur].classList.remove('active');hCur=(n+hSlides.length)%hSlides.length;hSlides[hCur].classList.add('active')}
if(hSlides.length)setInterval(()=>heroGo(hCur+1),3000);

// ======== SEARCH ========
// ======== LANG HELPER ========
function getLangText(key,fallback){var lang=localStorage.getItem('pap-lang')||'ko';var msgs={edAccessFree:{ko:'에디토리얼 전체보기는 스탠다드 이상 회원만 이용 가능합니다.',en:'Standard membership or above is required to browse all editorials.',it:'Per accedere a tutti gli editoriali è necessario un abbonamento Standard o superiore.',fr:'Un abonnement Standard ou supérieur est requis pour parcourir tous les éditoriaux.',es:'Se requiere una membresía Estándar o superior para ver todos los editoriales.',ja:'全エディトリアルの閲覧にはスタンダード以上の会員登録が必要です。',zh:'浏览所有社论需要标准会员或以上。',ru:'Для просмотра всех редакционных материалов требуется подписка Standard или выше.'}};var m=msgs[key];if(!m)return fallback||'';return m[lang]||m.en||fallback||'';}

// toggleSearch / search input listeners / searchEditorials: extracted to
// pap-search.js (mission 4). Search labels (`_searchTexts`) moved to pap-i18n.js.
// Auth state, account dropdown, logout: extracted to pap-auth.js (mission 2).
// Both pap-auth.js and pap-search.js MUST be loaded before this file.
//
// The ESC/Backspace global hotkey handler below STAYS here — it closes
// search UI but ALSO closes editorial / film / article overlays and the nav,
// which belong to other harnesses. Splitting it would cross-couple them.
document.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Backspace'){var isInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable;if(e.key==='Backspace'&&isInput)return;var _sb=document.getElementById('searchBar');if(_sb)_sb.classList.remove('active');var _sdd=document.getElementById('searchDropdown');if(_sdd)_sdd.classList.remove('active');var _ssi=document.getElementById('searchInput');if(_ssi)_ssi.value='';var _ad=document.getElementById('accountDropdown');if(_ad)_ad.classList.remove('active');closeNav();var edOv=document.getElementById('edOverlay');if(edOv&&edOv.classList.contains('active')){closeEditorial();e.preventDefault();return;}closeAllEditorials();closeAllFilms();closeAllArticles();if(document.getElementById('filmDetailOverlay'))document.getElementById('filmDetailOverlay').classList.remove('active');if(document.getElementById('artDetailOverlay'))document.getElementById('artDetailOverlay').classList.remove('active');if(e.key==='Backspace')e.preventDefault();}});

// ======== NAV ========
function toggleNav(){
  var _n=document.getElementById('navOverlay');
  if(!_n) return;
  var opening = !_n.classList.contains('active');
  _n.classList.toggle('active');

  // Hamburger ≡ ↔ X morph
  // QA #98 — toggle BOTH .is-active AND .active so pages with stale
  // page-level CSS keyed off `.hamburger.active` (e.g. magazine.html)
  // also morph into an X. Pages keyed off `.is-active` (the canonical
  // class — pap-styles.css, pap-header.js injected style) keep working
  // unchanged because we still toggle that class too.
  var hb = document.querySelector('.hamburger');
  if(hb){
    if(opening){
      hb.classList.add('is-active');
      hb.classList.add('active');
    } else {
      hb.classList.remove('is-active');
      hb.classList.remove('active');
    }
  }

  // Scroll lock
  if(opening) lockScroll();
  else unlockScroll();

  // Floating logo
  var fLogo=document.getElementById('floatingLogo');
  var heroEl=document.querySelector('.hero');
  if(fLogo){
    if(opening){
      fLogo.style.display='none';
      if(heroEl) heroEl.style.cursor='';
    } else {
      fLogo.style.display='';
    }
  }
}
function closeNav(){
  var _n=document.getElementById('navOverlay');
  if(_n && _n.classList.contains('active')) toggleNav();
}

// Carousel helpers (_papUpdateArrows, _papWireCarousel, _papSmoothScrollBy)
// extracted to pap-utils.js (mission 5). moveCarousel/scrollEdRow/scrollFilm
// below call _papSmoothScrollBy as a global at click time.

// ======== FASHION CAROUSEL ========
function moveCarousel(d){
  var t = document.getElementById('fashionTrack');
  if(!t) return;
  // Scroll by ~one card width (estimated from first child or fallback).
  var first = t.firstElementChild;
  var step = (first ? first.offsetWidth + 24 : 320);
  // Reset legacy transform if any prior state set it.
  if(t.style.transform) t.style.transform = '';
  _papSmoothScrollBy(t, d * step);
}

// ======== ED CAROUSEL ========
let ePos=0;
function moveEdCarousel(d){const t=document.getElementById('edTrack');if(!t||!t.firstElementChild)return;const w=t.firstElementChild.offsetWidth+20;ePos=Math.max(0,Math.min(ePos+d,3));t.style.transform=`translateX(-${ePos*w}px)`}

// ======== SCROLL REVEAL ========
const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('v')}),{threshold:.05});
document.querySelectorAll('.sr').forEach(e=>obs.observe(e));

// ======== INIT ========

// ======== TERMS & PRIVACY PAGES ========
// openPage / closePage / _legalNoticeTexts: extracted to pap-static.js
// (mission 7). _legalNoticeTexts now lives in pap-i18n.js. Both must be
// loaded before this file (already wired so via the script tag order).

// ======== EDITORIAL ROWS SCROLL ========
function scrollEdRow(btn,dir){
  var track=btn.parentElement.querySelector('.ed-row-track');
  if(track) _papSmoothScrollBy(track, dir*460);
}

// Initialize unified arrow-state for every home-page horizontal carousel.
// Runs once at DOMContentLoaded; carousels added later (e.g. by API render)
// can call this again or rely on the MutationObserver inside _papWireCarousel.
(function _papInitCarouselArrows(){
  function init(){
    // Fashion section ("최신기사") — single track, fixed left/right arrows
    var fashionTrack = document.getElementById('fashionTrack');
    if(fashionTrack){
      var section = fashionTrack.closest('.fashion-section');
      var L = section && section.querySelector('.carousel-arrow.left');
      var R = section && section.querySelector('.carousel-arrow.right');
      _papWireCarousel(fashionTrack, '.carousel-arrow.left', '.carousel-arrow.right');
      // The left/right arrow query above scopes to wrap (parentElement of
      // track), but fashion uses section as the relative parent — wire by
      // direct ref too:
      if(L || R){
        function update(){ _papUpdateArrows(fashionTrack, L, R); }
        fashionTrack.addEventListener('scroll', update, {passive:true});
        window.addEventListener('resize', update);
        // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
      }
    }
    // Editorial rows — multiple tracks, each wrapped in .ed-row-wrap
    document.querySelectorAll('.ed-row-wrap').forEach(function(wrap){
      var track = wrap.querySelector('.ed-row-track');
      var left  = wrap.querySelector('.ed-row-arrow.ed-row-left');
      var right = wrap.querySelector('.ed-row-arrow.ed-row-right');
      if(!track) return;
      function update(){ _papUpdateArrows(track, left, right); }
      track.addEventListener('scroll', update, {passive:true});
      window.addEventListener('resize', update);
      var mo = new MutationObserver(update);
      try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
      // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
    });
    // Film carousel — .nf-wrap with .nf-track inside
    document.querySelectorAll('.nf-wrap').forEach(function(wrap){
      var track = wrap.querySelector('.nf-track');
      var left  = wrap.querySelector('.nf-nav-left');
      var right = wrap.querySelector('.nf-nav-right');
      if(!track) return;
      function update(){ _papUpdateArrows(track, left, right); }
      track.addEventListener('scroll', update, {passive:true});
      window.addEventListener('resize', update);
      var mo = new MutationObserver(update);
      try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
      // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// EDITORIAL DATA + DETAIL + OPEN/CLOSE FAMILY: extracted to pap-content-editorial.js (mission 8a).

window.addEventListener('popstate',function(e){
  var st=e.state;
  var edOv=document.getElementById('edOverlay');
  var cpOv=document.getElementById('creatorPopup');

  // If navigating back to a creator profile state → restore creator popup
  if(st && st.creator && st.handle){
    // Close editorial overlay if open (without history manipulation)
    if(edOv && edOv.classList.contains('active')){
      edOv.classList.remove('active');
      document.body.style.overflow='';
    }
    // Restore creator popup from saved data or by handle
    if(window._lastCreatorData){
      var cr=window._lastCreatorData;
      var h=cr.handle||cr.instagram||cr.name||'';
      if(h.replace('@','').toLowerCase()===st.handle.replace('@','').toLowerCase()){
        // Re-open with saved data (no pushState)
        _openCreatorPopup_noPush(cr);
        return;
      }
    }
    // Fallback: open by handle from DB
    var db=typeof getCreatorDB==='function'?getCreatorDB():{};
    var key=st.handle.toLowerCase();
    if(db[key]){
      _openCreatorPopup_noPush(db[key]);
    } else {
      _openCreatorPopup_noPush({name:st.handle.replace('@',''),handle:st.handle,role:'Contributor',editorials:[],imgs:[]});
    }
    return;
  }

  // If navigating back to a previous editorial state → restore that editorial
  if(st && st.editorial && st.title){
    // Close creator popup if open
    if(cpOv && cpOv.classList.contains('active')){cpOv.classList.remove('active');unlockScroll();}
    _openEditorialInner_noPush(st.title, st.thumb||'');
    return;
  }

  // Otherwise, close whatever overlay is open
  // Close creator popup first
  if(cpOv && cpOv.classList.contains('active')){
    cpOv.classList.remove('active');
    unlockScroll();
    return;
  }
  if(edOv && edOv.classList.contains('active')){
    closeEditorial(true);
    return;
  }
  // Close all-editorials overlay
  var edAll=document.getElementById('edAllOverlay');
  if(edAll && edAll.classList.contains('active')){closeAllEditorials(true);return;}
  // Close film/article overlays on back button
  var filmDet=document.getElementById('filmDetailOverlay');
  if(filmDet && filmDet.classList.contains('active')){closeFilmDetail(true);return;}
  var filmAll=document.getElementById('filmAllOverlay');
  if(filmAll && filmAll.classList.contains('active')){closeAllFilms();return;}
  var artDet=document.getElementById('artDetailOverlay');
  if(artDet && artDet.classList.contains('active')){closeArticleDetail(true);return;}
  var artAll=document.getElementById('artAllOverlay');
  if(artAll && artAll.classList.contains('active')){closeAllArticles();return;}
});

// IMAGE ERROR HANDLER (edImgError): extracted to pap-content-editorial.js (mission 8a).

// ALL EDITORIALS OVERLAY: extracted to pap-content-editorial.js (mission 8a).
// ======== ALL FILMS OVERLAY ========
function openAllFilms(){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllFilmsInner(); });
    return;
  }
  _openAllFilmsInner();
}
function _openAllFilmsInner(){
  var overlay=document.getElementById('filmAllOverlay');
  if(!overlay) return;
  var grid=document.getElementById('filmAllGrid');
  var count=document.getElementById('filmAllCount');
  var filterWrap=document.getElementById('filmFilterWrap');
  grid.innerHTML='';
  // Gather unique categories
  var cats={};
  filmAllData.forEach(function(f){(f.cat||'').split(',').forEach(function(c){c=c.trim();if(c)cats[c]=1;});});
  var catList=Object.keys(cats).sort();
  // Build category filter
  filterWrap.innerHTML='<button class="film-filter-btn active" data-cat="all">ALL</button>'+catList.map(function(c){return '<button class="film-filter-btn" data-cat="'+c+'">'+c.toUpperCase()+'</button>';}).join('');
  filterWrap.querySelectorAll('.film-filter-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      filterWrap.querySelectorAll('.film-filter-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      filterFilms(btn.getAttribute('data-cat'));
    });
  });
  // Build film cards
  filmAllData.forEach(function(f,i){
    var card=document.createElement('div');
    card.className='film-all-card';
    card.setAttribute('data-cats',(f.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(){openFilmDetail(i);};
    var dateStr=f.d?f.d.substring(0,10):'';
    card.innerHTML='<div class="film-all-thumb"><img src="'+f.th+'" alt="'+escapeHtml(f.t)+'" loading="lazy" onerror="edImgError(this)"><div class="film-play-icon"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><path d="M8 5v14l11-7z"/></svg></div></div><div class="film-all-info"><div class="film-all-cat">'+(f.cat||'FILM').toUpperCase()+' · '+dateStr+'</div><div class="film-all-title">'+escapeHtml(f.t)+'</div></div>';
    grid.appendChild(card);
  });
  count.textContent=filmAllData.length+' FILMS';
  // replaceState if user arrived via direct #films-all nav, else push.
  if(window.location.hash==='#films-all'){
    history.replaceState({overlay:'films'},'',window.location.pathname+'#films-all');
  }else{
    history.pushState({overlay:'films'},'',window.location.pathname+'#films-all');
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
}
function filterFilms(cat){
  var cards=document.querySelectorAll('.film-all-card');
  var shown=0;
  cards.forEach(function(c){
    if(cat==='all'||c.getAttribute('data-cats').indexOf(cat.toLowerCase())>=0){c.style.display='';shown++;}
    else{c.style.display='none';}
  });
  var count=document.getElementById('filmAllCount');
  if(count) count.textContent=shown+' FILMS';
}
function closeAllFilms(){
  var overlay=document.getElementById('filmAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
  }
}
function openFilmDetail(idx){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openFilmDetailInner(idx); });
    return;
  }
  _openFilmDetailInner(idx);
}
function _openFilmDetailInner(idx){
  var f=filmAllData[idx];if(!f) return;
  var overlay=document.getElementById('filmDetailOverlay');
  if(!overlay) return;
  document.getElementById('filmDetailPlayer').src='https://www.youtube.com/embed/'+f.yt+'?autoplay=1&rel=0';
  document.getElementById('filmDetailTitle').textContent=f.t||'';
  var catStr=(f.cat||'Film');
  if(f.d) catStr+=' · '+f.d;
  document.getElementById('filmDetailCat').textContent=catStr;
  var credEl=document.getElementById('filmDetailCredits');
  if(credEl){
    // Ensure the grid container class is applied so .ed-cred-row children
    // form a proper 2-column layout (role | name).
    credEl.classList.add('ed-credits-table');
    var cr=f.cr||[];
    credEl.innerHTML=cr.map(function(c){
      var handles=(c.p||'').split(',').map(function(h){
        h=h.trim();if(!h) return '';
        return '<a href="#" class="film-cred-link" data-handle="'+h.replace(/"/g,'')+'" style="cursor:pointer">'+escapeHtml(h)+'</a>';
      }).filter(Boolean).join('&nbsp;&nbsp;');
      return '<div class="ed-cred-row"><div class="ed-cred-role">'+escapeHtml(c.r||'')+'</div><div class="ed-cred-val">'+handles+'</div></div>';
    }).join('');
    // Event delegation for credit link clicks (more robust than inline onclick)
    credEl.onclick=function(e){
      var link=e.target.closest('.film-cred-link');
      if(link){
        e.preventDefault();
        var handle=link.getAttribute('data-handle');
        if(handle){try{openProfileByHandle(handle);}catch(err){console.error('openProfileByHandle error:',err);}}
      }
    };
    credEl.onmouseover=function(e){var link=e.target.closest('.film-cred-link');if(link)link.style.textDecoration='underline';};
    credEl.onmouseout=function(e){var link=e.target.closest('.film-cred-link');if(link)link.style.textDecoration='none';};
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
  try{
    var _fhash='#film/'+encodeURIComponent(f.t||'');
    var _fpath=window.location.pathname+_fhash;
    if(window.location.hash===_fhash){
      history.replaceState({film:true,idx:idx},'',_fpath);
    }else{
      history.pushState({film:true,idx:idx},'',_fpath);
    }
  }catch(e){}
}
function _findFilmByTitle(title){
  if(!title) return -1;
  var n=_normWs(title);
  for(var i=0;i<filmAllData.length;i++){
    if(_normWs(filmAllData[i].t||'')===n) return i;
  }
  return -1;
}
function closeFilmDetail(skipHistory){
  var overlay=document.getElementById('filmDetailOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.getElementById('filmDetailPlayer').src='about:blank';
    // Check if films list overlay is open underneath
    var filmAll=document.getElementById('filmAllOverlay');
    if(filmAll&&filmAll.classList.contains('active')){
      document.body.style.overflow='hidden';
    } else {
      document.body.style.overflow='';
    }
    if(!skipHistory){try{history.back();}catch(e){}}
  }
}

// ======== ALL ARTICLES OVERLAY ========
function openAllArticles(){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllArticlesInner(); });
    return;
  }
  _openAllArticlesInner();
}
function _openAllArticlesInner(){
  var overlay=document.getElementById('artAllOverlay');
  if(!overlay) return;
  var grid=document.getElementById('artAllGrid');
  var count=document.getElementById('artAllCount');
  var filterWrap=document.getElementById('artFilterWrap');
  grid.innerHTML='';
  // Gather unique categories
  var cats={};
  artData.forEach(function(a){(a.cat||'').split(',').forEach(function(c){c=c.trim();if(c)cats[c]=1;});});
  var catList=Object.keys(cats).sort();
  // Build filter
  filterWrap.innerHTML='<button class="art-filter-btn active" data-cat="all">ALL</button>'+catList.map(function(c){return '<button class="art-filter-btn" data-cat="'+c+'">'+c.toUpperCase()+'</button>';}).join('');
  filterWrap.querySelectorAll('.art-filter-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      filterWrap.querySelectorAll('.art-filter-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      filterArticles(btn.getAttribute('data-cat'));
    });
  });
  // Build article cards
  artData.forEach(function(a,i){
    var card=document.createElement('div');
    card.className='art-all-card';
    card.setAttribute('data-cats',(a.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(){openArticleDetail(i);};
    var dateStr=a.d?a.d.substring(0,10):'';
    card.innerHTML='<div class="art-all-thumb"><img src="'+(a.img||a.th)+'" alt="'+escapeHtml(a.t)+'" loading="lazy" onerror="edImgError(this)"></div><div class="art-all-info"><div class="art-all-cat">'+(a.cat||'ARTICLE').toUpperCase()+' · '+dateStr+'</div><div class="art-all-title">'+escapeHtml(a.t)+'</div>'+(a.sub?'<div class="art-all-sub">'+escapeHtml(a.sub)+'</div>':'')+'</div>';
    grid.appendChild(card);
  });
  count.textContent=artData.length+' ARTICLES';
  // replaceState if user arrived via direct #articles-all nav, else push.
  if(window.location.hash==='#articles-all'){
    history.replaceState({overlay:'articles'},'',window.location.pathname+'#articles-all');
  }else{
    history.pushState({overlay:'articles'},'',window.location.pathname+'#articles-all');
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
}
function filterArticles(cat){
  var cards=document.querySelectorAll('.art-all-card');
  var shown=0;
  cards.forEach(function(c){
    if(cat==='all'||c.getAttribute('data-cats').indexOf(cat.toLowerCase())>=0){c.style.display='';shown++;}
    else{c.style.display='none';}
  });
  var count=document.getElementById('artAllCount');
  if(count) count.textContent=shown+' ARTICLES';
}
function closeAllArticles(){
  var overlay=document.getElementById('artAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
  }
}
// escapeHtml / _decHtml / _normWs extracted to pap-utils.js (mission 5).
function openArticleBySlug(slug){
  for(var i=0;i<artData.length;i++){if(artData[i].slug===slug){openArticleDetail(i);return;}}
}
function openArticleFromCard(card){
  // Prefer data-slug (language-agnostic) over title matching
  var slug=card.getAttribute('data-slug');
  if(slug){
    for(var j=0;j<artData.length;j++){
      if(artData[j].slug===slug){openArticleDetail(j);return;}
    }
  }
  var titleEl=card.querySelector('.fashion-card-title')||card.querySelector('.art-all-title');
  if(!titleEl) return;
  var raw=titleEl.innerHTML||'';
  var title=_normWs(_decHtml(raw));
  // Match by any language variant in ti18n
  for(var i=0;i<artData.length;i++){
    var at=_normWs(artData[i].t||'');
    if(at===title||at.toUpperCase()===title){openArticleDetail(i);return;}
    if(artData[i].ti18n){
      for(var lk in artData[i].ti18n){
        var lt=_normWs(artData[i].ti18n[lk]||'');
        if(lt===title||lt.toUpperCase()===title){openArticleDetail(i);return;}
      }
    }
  }
  for(var i=0;i<artData.length;i++){
    var at=_normWs(artData[i].t||'');
    if(at.length>3&&title.length>3&&(at.indexOf(title)===0||title.indexOf(at)===0)){openArticleDetail(i);return;}
  }
}
function _renderArticleDetail(a,det){
  document.getElementById('artDetailImg').src=a.img||a.th;
  // Use localized title/sub if available
  var _curLang=(typeof lang!=='undefined'?lang:(localStorage.getItem('pap-lang')||'ko'));
  var _locTitle=(a.ti18n && (a.ti18n[_curLang]||a.ti18n.en))||a.t||'';
  var _locSub=(a.subi18n && (a.subi18n[_curLang]||a.subi18n.en))||a.sub||'';
  document.getElementById('artDetailTitle').textContent=_locTitle;
  document.getElementById('artDetailCat').textContent=(a.cat||'ARTICLE')+' · '+(a.d||'');
  document.getElementById('artDetailSub').textContent=_locSub;
  var descEl=document.getElementById('artDetailDesc');
  if(descEl){
    if(a.desc){
      if(a.desc.indexOf('<')!==-1&&a.desc.indexOf('>')!==-1){
        descEl.innerHTML=a.desc;
      } else {
        descEl.innerHTML=a.desc.split('\n').filter(function(p){return p.trim();}).map(function(p){return '<p style="margin:0 0 12px">'+escapeHtml(p)+'</p>';}).join('');
      }
      descEl.style.display='';
    } else { descEl.innerHTML='';descEl.style.display='none'; }
  }
  var creditsEl=document.getElementById('artDetailCredits');
  if(det&&det.credits&&det.credits.length){
    creditsEl.innerHTML=det.credits.map(function(c){
      var handles=(c.h||[]).map(function(h){var u=h.replace('@','');return '<a href="https://www.instagram.com/'+u+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">'+h+'</a>';}).join('  ');
      return '<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">'+c.r+'</span><br>'+handles+'</div>';
    }).join('');
    if(det.fashion&&det.fashion.length){
      creditsEl.innerHTML+='<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Fashion</span><br>'+det.fashion.map(function(f){var u=f.replace('@','');return '<a href="https://www.instagram.com/'+u+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">'+f+'</a>';}).join('  ')+'</div>';
    }
    creditsEl.style.display='';
  } else if(a.cr&&a.cr.length){
    creditsEl.innerHTML=a.cr.map(function(c){
      var people=(c.p||'').split(',').map(function(p){p=p.trim();return p?'<a href="https://www.instagram.com/'+p+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">@'+p+'</a>':'';}).filter(Boolean).join(', ');
      return '<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">'+escapeHtml(c.r)+'</span><br>'+people+'</div>';
    }).join('');
    creditsEl.style.display='';
  } else { creditsEl.style.display='none'; }
  var tagsEl=document.getElementById('artDetailTags');
  if(a.tags){
    var tagArr=Array.isArray(a.tags)?a.tags:(typeof a.tags==='string'?a.tags.split(','):[]);
    // Each hashtag is now a clickable link → /articles.html?tag=<tag>.
    // The articles list page reads the query param and filters its grid
    // to only entries whose .tags include that value, with an active-tag
    // chip rendered at the top so the user knows the filter is on and
    // can clear it. Hover/active styling defined under .art-tag-chip.
    tagsEl.innerHTML=tagArr.map(function(t){
      var tag = (typeof t === 'string' ? t.trim() : String(t));
      if(!tag) return '';
      return '<a class="art-tag-chip" href="articles.html?tag=' +
        encodeURIComponent(tag) + '">#' + escapeHtml(tag) + '</a>';
    }).join('');
    tagsEl.style.display='';
  } else { tagsEl.style.display='none'; }
  var galEl=document.getElementById('artDetailGallery');
  if(galEl){
    var galImgs=(det&&det.images&&det.images.length>0)?det.images:(a.gallery&&a.gallery.length>0?a.gallery:null);
    if(galImgs){
      galEl.innerHTML=galImgs.map(function(url){return '<div style="overflow:hidden;border-radius:2px;background:#111"><img src="'+url+'" alt="'+escapeHtml(a.t)+'" loading="lazy" style="width:100%;display:block" onerror="edImgError(this)"></div>';}).join('');
      galEl.style.display='grid';
    } else { galEl.innerHTML='';galEl.style.display='none'; }
  }
  var linkEl=document.getElementById('artDetailLink');
  if(linkEl){ linkEl.style.display='none'; }
  // Social: comments
  var socialSlot=document.getElementById('artSocialSlot');
  if(socialSlot && typeof PAPSocial!=='undefined'){
    PAPSocial.renderArticleSocial(socialSlot, a.slug||a.t, a.t);
  }
}
/* PAP API fetch removed - using local gallery data */
function openArticleDetail(idx){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openArticleDetailInner(idx); });
    return;
  }
  _openArticleDetailInner(idx);
}
function _openArticleDetailInner(idx){
  var a=artData[idx];if(!a) return;
  var overlay=document.getElementById('artDetailOverlay');
  if(!overlay) return;
  var det=null;
  if(typeof edDetails!=='undefined'){
    det=edDetails[a.t];
    if(!det){var tLow=a.t.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===tLow){det=edDetails[key];break;}}}
  }
  // Check if article needs dynamic content fetch
  
  _renderArticleDetail(a,det);
  overlay.classList.add('active');
  overlay.scrollTop=0;
  document.body.style.overflow='hidden';
  
  // Push state for back button
  try{
    var _ahash='#article/'+encodeURIComponent(a.slug||a.t);
    var _apath=window.location.pathname+_ahash;
    if(window.location.hash===_ahash){
      history.replaceState({article:true,idx:idx},'',_apath);
    }else{
      history.pushState({article:true,idx:idx},'',_apath);
    }
  }catch(e){}
}
function closeArticleDetail(skipHistory){
  var overlay=document.getElementById('artDetailOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    // Check if articles list overlay is open underneath
    var artAll=document.getElementById('artAllOverlay');
    if(artAll&&artAll.classList.contains('active')){
      document.body.style.overflow='hidden';
    } else {
      document.body.style.overflow='';
    }
    if(!skipHistory){try{history.back();}catch(e){}}
  }
}


// AUTO LANGUAGE DETECTION
// Language detection is delegated to pap-geo-lang.js (loaded before this script).
// That module handles: IP geolocation → browser/timezone fallback → user preference respect.
// Here we simply apply whatever has already been resolved in localStorage.
(function(){
  var saved = localStorage.getItem('pap-lang') || 'en';
  setLang(saved);
})();


// ======== CREATOR DATA (demo) ========
var creatorData=[];


// ======== CREATOR PROFILE SYSTEM ========
function getLevel(count){
  if(count>=20) return {name:'DIAMOND',icon:'💎',cls:'lvl-diamond'};
  if(count>=10) return {name:'PLATINUM',icon:'✦',cls:'lvl-platinum'};
  if(count>=5) return {name:'GOLD',icon:'★',cls:'lvl-gold'};
  if(count>=3) return {name:'SILVER',icon:'☆',cls:'lvl-silver'};
  return {name:'BRONZE',icon:'●',cls:'lvl-bronze'};
}

// Build creator database from edDetails
function buildCreatorDB(){
  var db={};
  for(var title in edDetails){
    var ed=edDetails[title];
    // QA #96 — normalise credits before iterating. ed.credits may already
    // be in display shape (curated JSON) or in either admin format
    // (legacy dict, new array with roles[]).
    var _normEdCredits = _normalizeCreditsForDisplay(ed.credits);
    _normEdCredits.forEach(function(cr){
      (cr.h||[]).forEach(function(h){
        var handle=typeof h==='object'&&h.id?h.id:h;
        var displayName=typeof h==='object'&&h.n?h.n:handle.replace(/^@/,'');
        var key=handle.toLowerCase();
        if(!db[key]){db[key]={name:displayName,handle:handle,role:cr.r,editorials:[],imgs:[]};}
        if(db[key].editorials.indexOf(title)===-1){
          db[key].editorials.push(title);
          if(ed.thumb) db[key].imgs.push({title:title,img:ed.thumb});
        }
      });
    });
    // Process fashion — supports both {n,id} objects and plain strings
    (ed.fashion||[]).forEach(function(h){
      var handle=typeof h==='object'&&h.id?h.id:h;
      var displayName=typeof h==='object'&&h.n?h.n:handle.replace(/^@/,'');
      var key=handle.toLowerCase();
      if(!db[key]){db[key]={name:displayName,handle:handle,role:'Fashion Brand',editorials:[],imgs:[]};}
      db[key].isBrand=true;
      if(db[key].editorials.indexOf(title)===-1){
        db[key].editorials.push(title);
        if(ed.thumb) db[key].imgs.push({title:title,img:ed.thumb});
      }
    });
  }
  return db;
}
var creatorDB=null;
function getCreatorDB(){if(!creatorDB)creatorDB=buildCreatorDB();return creatorDB;}

function openCreatorPopup(cr){
  // cr can be: {name,role,instagram,editorials,img} or {name,handle,role,editorials,imgs}
  var name=cr.name||'';
  var handle=cr.handle||cr.instagram||'';
  var role=cr.role||'';
  var editorials=cr.editorials||[];
  var imgs=cr.imgs||[];
  
  // If no imgs provided, try to find from edDetails (case-insensitive)
  if(imgs.length===0 && editorials.length>0){
    editorials.forEach(function(t){
      var ed=edDetails[t];
      if(!ed){var tL=t.toLowerCase();for(var k in edDetails){if(k.toLowerCase()===tL){ed=edDetails[k];break;}}}
      if(ed && ed.thumb) imgs.push({title:t,img:ed.thumb});
    });
  }

  var isBrand=cr.isBrand||(role==='Fashion Brand');

  document.getElementById('cpName').textContent=name.replace('@','');
  document.getElementById('cpRole').textContent=role;

  var lvlEl=document.getElementById('cpLevel');
  if(isBrand){
    lvlEl.className='creator-popup-level';
    lvlEl.innerHTML=editorials.length+' EDITORIAL'+(editorials.length!==1?'S':'');
  } else {
    var level=getLevel(editorials.length);
    lvlEl.className='creator-popup-level '+level.cls;
    lvlEl.innerHTML='<span class="lvl-icon">'+level.icon+'</span> '+level.name+' · '+editorials.length+' EDITORIAL'+(editorials.length!==1?'S':'');
  }
  
  // Instagram button
  var igBtn=document.getElementById('cpIgBtn');
  var igHandle=handle.replace('@','');
  if(igHandle){
    igBtn.href='https://www.instagram.com/'+igHandle+'/';
    igBtn.textContent='@'+igHandle;
    igBtn.style.display='inline-flex';
  } else {
    igBtn.style.display='none';
  }
  
  // Stats
  document.getElementById('cpCount').textContent=editorials.length;
  document.getElementById('cpFirst').textContent=editorials.length>0?editorials[editorials.length-1].substring(0,15):'—';
  document.getElementById('cpLatest').textContent=editorials.length>0?editorials[0].substring(0,15):'—';

  // Average editorial rating from audience
  var ratingSlot=document.getElementById('cpAvgRating');
  if(!ratingSlot){
    ratingSlot=document.createElement('div');
    ratingSlot.id='cpAvgRating';
    var lvlEl2=document.getElementById('cpLevel');
    if(lvlEl2 && lvlEl2.parentNode) lvlEl2.parentNode.insertBefore(ratingSlot, lvlEl2.nextSibling);
  }
  if(typeof PAPSocial!=='undefined'){
    ratingSlot.innerHTML='<div class="pap-profile-rating-empty">별점 불러오는 중...</div>';
    Promise.resolve(PAPSocial.getCreatorAvgRating(handle)).then(function(cav){
      if(cav && cav.count>0){
        ratingSlot.innerHTML='<div class="pap-profile-rating">'+
          '<span class="pap-profile-rating-num">'+cav.avg.toFixed(1)+'</span>'+
          '<span class="pap-profile-rating-stars">'+PAPSocial.starHTML(cav.avg,false)+'</span>'+
          '<span class="pap-profile-rating-count">'+cav.count+'명 평가 · '+(cav.ratedEditorials||0)+'/'+(cav.editorials||editorials.length)+' 에디토리얼</span>'+
        '</div>';
      } else if(editorials.length>0){
        ratingSlot.innerHTML='<div class="pap-profile-rating-empty">아직 별점이 등록되지 않았습니다</div>';
      } else {
        ratingSlot.innerHTML='';
      }
    }).catch(function(err){
      console.error('[creatorAvg] load failed:', err);
      ratingSlot.innerHTML='';
    });
  }
  
  // Editorial works grid
  var grid=document.getElementById('cpWorks');
  grid.innerHTML='';
  imgs.forEach(function(item){
    var div=document.createElement('div');
    div.className='creator-work-card';
    div.innerHTML='<img src="'+item.img+'" alt="'+item.title+'"><div class="creator-work-title">'+item.title+'</div>';
    div.onclick=function(){closeCreatorPopup(true);openEditorial(item.title,item.img);};
    grid.appendChild(div);
  });
  
  document.getElementById('creatorPopup').classList.add('active');
  lockScroll();
  if(typeof _resetCursorForModal==='function') _resetCursorForModal();
  // Save creator data for history restore & push state
  window._lastCreatorData=cr;
  try{history.pushState({creator:true,handle:handle||name},'',window.location.pathname+'#creator/'+encodeURIComponent(handle||name));}catch(e){}
}

// Version of openCreatorPopup without pushState (used by popstate)
function _openCreatorPopup_noPush(cr){
  var name=cr.name||'';
  var handle=cr.handle||cr.instagram||'';
  var role=cr.role||'';
  var editorials=cr.editorials||[];
  var imgs=cr.imgs||[];
  if(imgs.length===0 && editorials.length>0){
    editorials.forEach(function(t){
      var ed=edDetails[t];
      if(!ed){var tL=t.toLowerCase();for(var k in edDetails){if(k.toLowerCase()===tL){ed=edDetails[k];break;}}}
      if(ed && ed.thumb) imgs.push({title:t,img:ed.thumb});
    });
  }
  var isBrand=cr.isBrand||(role==='Fashion Brand');
  document.getElementById('cpName').textContent=name.replace('@','');
  document.getElementById('cpRole').textContent=role;
  var lvlEl=document.getElementById('cpLevel');
  if(isBrand){
    lvlEl.className='creator-popup-level';
    lvlEl.innerHTML=editorials.length+' EDITORIAL'+(editorials.length!==1?'S':'');
  } else {
    var level=getLevel(editorials.length);
    lvlEl.className='creator-popup-level '+level.cls;
    lvlEl.innerHTML='<span class="lvl-icon">'+level.icon+'</span> '+level.name+' · '+editorials.length+' EDITORIAL'+(editorials.length!==1?'S':'');
  }
  var igBtn=document.getElementById('cpIgBtn');
  var igHandle=handle.replace('@','');
  if(igHandle){igBtn.href='https://www.instagram.com/'+igHandle+'/';igBtn.textContent='@'+igHandle;igBtn.style.display='inline-flex';}else{igBtn.style.display='none';}
  document.getElementById('cpCount').textContent=editorials.length;
  document.getElementById('cpFirst').textContent=editorials.length>0?editorials[editorials.length-1].substring(0,15):'—';
  document.getElementById('cpLatest').textContent=editorials.length>0?editorials[0].substring(0,15):'—';
  var ratingSlot=document.getElementById('cpAvgRating');
  if(ratingSlot) ratingSlot.innerHTML='';
  if(typeof PAPSocial!=='undefined' && ratingSlot){
    Promise.resolve(PAPSocial.getCreatorAvgRating(handle)).then(function(cav){
      if(cav&&cav.count>0){ratingSlot.innerHTML='<div class="pap-profile-rating"><span class="pap-profile-rating-num">'+cav.avg.toFixed(1)+'</span><span class="pap-profile-rating-stars">'+PAPSocial.starHTML(cav.avg,false)+'</span><span class="pap-profile-rating-count">'+cav.count+'명 평가 · '+(cav.ratedEditorials||0)+'/'+(cav.editorials||editorials.length)+' 에디토리얼</span></div>';}
    }).catch(function(){});
  }
  var grid=document.getElementById('cpWorks');
  grid.innerHTML='';
  imgs.forEach(function(item){
    var div=document.createElement('div');
    div.className='creator-work-card';
    div.innerHTML='<img src="'+item.img+'" alt="'+item.title+'"><div class="creator-work-title">'+item.title+'</div>';
    div.onclick=function(){closeCreatorPopup(true);openEditorial(item.title,item.img);};
    grid.appendChild(div);
  });
  document.getElementById('creatorPopup').classList.add('active');
  lockScroll();
  if(typeof _resetCursorForModal==='function') _resetCursorForModal();
  window._lastCreatorData=cr;
}

function closeCreatorPopup(skipHistory){
  document.getElementById('creatorPopup').classList.remove('active');
  unlockScroll();
  if(!skipHistory){try{history.back();}catch(e){}}
}

// Open profile by handle (from editorial credits)
function openProfileByHandle(handle){
  var db=getCreatorDB();
  var key=handle.toLowerCase();
  if(db[key]){
    openCreatorPopup(db[key]);
  } else {
    // Create minimal profile
    openCreatorPopup({name:handle.replace('@',''),handle:handle,role:'Contributor',editorials:[],imgs:[]});
  }
}


// ======== FILM DATABASE (141 films) ========
var filmAllData=[];

// ======== ARTICLE DATABASE ========
var artData=[];




window.artData=artData;window.filmAllData=filmAllData;
// ======== FILM SLUG HELPER ========
function filmSlug(title){
  if(!title) return '';
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
}
function filmPageUrl(title){
  return window.location.origin+'/ko/'+filmSlug(title)+'-film/';
}

// ======== FILM — Netflix hover + scroll ========
function scrollFilm(dir){
  var s=document.getElementById('filmScroll');
  if(s) _papSmoothScrollBy(s, dir*420);
}

// Netflix popup interaction
(function(){
  var cards=document.querySelectorAll('.nf-card');
  var popup=document.getElementById('nfPopup');
  var popImg=document.getElementById('nfPopupImg');
  var popSlot=document.getElementById('nfPopupSlot');
  var popTitle=document.getElementById('nfPopupTitle');
  var popCat=document.getElementById('nfPopupCat');
  var popPlay=document.getElementById('nfPopupPlay');
  var hTimer=null,lTimer=null,curTitle='';

  if(!popup||!popImg||!popTitle) return;

  function showPopup(card){
    var rect=card.getBoundingClientRect();
    var pw=320;
    var l=rect.left+rect.width/2-pw/2;
    var t=rect.top-75;
    if(l<8)l=8;
    if(l+pw>window.innerWidth-8)l=window.innerWidth-pw-8;
    popup.style.left=l+'px';
    popup.style.top=t+'px';

    var thumb=card.getAttribute('data-thumb');
    if(thumb) popImg.src=thumb;
    popTitle.textContent=card.getAttribute('data-title')||'';
    popCat.textContent=card.getAttribute('data-cat')||'';
    curTitle=card.getAttribute('data-title')||'';

    // Show thumbnail instead of YouTube embed
    if(popSlot) popSlot.innerHTML='';
    popup.classList.add('active');
  }

  function hidePopup(){
    popup.classList.remove('active');
    if(popSlot) popSlot.innerHTML='';
    curTitle='';
  }

  for(var i=0;i<cards.length;i++){
    (function(card){
      card.addEventListener('mouseenter',function(){
        clearTimeout(lTimer);
        hTimer=setTimeout(function(){showPopup(card);},400);
      });
      card.addEventListener('mouseleave',function(){
        clearTimeout(hTimer);
        lTimer=setTimeout(hidePopup,300);
      });
    })(cards[i]);
  }

  popup.addEventListener('mouseenter',function(){clearTimeout(lTimer);});
  popup.addEventListener('mouseleave',function(){lTimer=setTimeout(hidePopup,300);});

  if(popPlay){
    popPlay.addEventListener('click',function(){
      if(curTitle){var fi=_findFilmByTitle(curTitle);if(fi>=0)openFilmDetail(fi);}
    });
  }
  // ⓘ Info button — navigate to films page
  var popInfo=popup.querySelector('.nf-popup-info');
  if(popInfo){
    popInfo.addEventListener('click',function(){
      if(curTitle){
        var fi=_findFilmByTitle(curTitle);
        if(fi>=0) openFilmDetail(fi);
        else window.location.href='films.html';
      } else {
        window.location.href='films.html';
      }
    });
  }
})();



// FLOATING LOGO + _resetCursorForModal + SIGNUP POPUP + closeSignupPopup: extracted to pap-home.js (mission 9).
// ======== FILM AUTO-PLAY ========
var filmInView=false;
var filmPlaying=false;

function playFilm(card){
  var title=card.getAttribute('data-title');
  if(!title) return;
  var idx=_findFilmByTitle(title);
  if(idx>=0) openFilmDetail(idx);
}

function stopFilm(){
  var fp=document.getElementById('filmMainPlayer');
  if(fp) fp.src='about:blank';
  filmPlaying=false;
}

// Film section visibility (no auto-play since films now link to PAP website)
var filmObserver=new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    filmInView=e.isIntersecting;
  });
},{threshold:0.3});

var filmSec=document.getElementById('films');
if(filmSec) filmObserver.observe(filmSec);

// ======== SHORTS CAROUSEL ========
var shortsData=[];
var shortsIdx=0;
var shortsAutoTimer=null;
var shortsInView=false;

function buildShortsCarousel(){
  var track=document.getElementById('shortsTrack');
  var dots=document.getElementById('shortsDots');
  if(!track)return;
  track.innerHTML='';dots.innerHTML='';
  shortsData.forEach(function(s,i){
    var div=document.createElement('div');
    div.className='shorts-item';
    div.setAttribute('data-idx',i);
    div.onclick=function(){if(i!==shortsIdx){shortsIdx=i;updateShortsPositions();}};
    div.innerHTML='<iframe src="about:blank" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe><div class="shorts-item-title">'+s.title+'</div>';
    track.appendChild(div);
    var dot=document.createElement('div');
    dot.className='shorts-dot';
    dot.onclick=function(){shortsIdx=i;updateShortsPositions();};
    dots.appendChild(dot);
  });
  updateShortsPositions();
}

function getShortsVisibleCount(){
  var w=window.innerWidth;
  if(w>=1800) return 4;
  if(w>=1400) return 3;
  if(w>=900) return 2;
  return 1;
}

function updateShortsPositions(){
  var items=document.querySelectorAll('.shorts-item');
  var dots=document.querySelectorAll('.shorts-dot');
  var n=shortsData.length;
  var trackEl=document.getElementById('shortsTrack');
  var trackW=trackEl.offsetWidth;
  var sides=getShortsVisibleCount();
  var itemW=240;
  var gap=Math.min(30, (trackW - itemW) / (sides * 2 + 1));
  var step=itemW * 0.82 + gap;

  items.forEach(function(item,i){
    var diff=i-shortsIdx;
    if(diff>n/2) diff-=n;
    if(diff<-n/2) diff+=n;

    item.className='shorts-item';
    var x=0;
    var ad=Math.abs(diff);
    if(diff===0){item.classList.add('center');x=0;}
    else if(ad<=sides){
      var cls=diff<0?'left':'right';
      item.classList.add(cls+ad);
      x=diff*step;
    }
    else{item.classList.add('hidden');x=diff<0?-(sides+1)*step:(sides+1)*step;}

    item.style.left='calc(50% - 120px + '+x+'px)';

    var iframe=item.querySelector('iframe');
    if(ad<=sides){
      var autoplay=diff===0?'&autoplay=1&mute=1':'';
      var src='https://www.youtube.com/embed/'+shortsData[i].id+'?rel=0&loop=1&playlist='+shortsData[i].id+autoplay;
      if(iframe.src!==src) iframe.src=src;
    } else {
      if(iframe.src!=='about:blank') iframe.src='about:blank';
    }
  });

  dots.forEach(function(d,i){d.className='shorts-dot'+(i===shortsIdx?' on':'');});

  // Reset auto-advance timer
  clearTimeout(shortsAutoTimer);
  if(shortsInView){
    shortsAutoTimer=setTimeout(function(){moveShort(1);},15000);
  }
}

function moveShort(dir){
  shortsIdx=(shortsIdx+dir+shortsData.length)%shortsData.length;
  updateShortsPositions();
}

// IntersectionObserver: auto-play when scrolled into view
var shortsObserver=new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    shortsInView=e.isIntersecting;
    if(e.isIntersecting){
      updateShortsPositions();
    } else {
      clearTimeout(shortsAutoTimer);
      // Pause center iframe
      var center=document.querySelector('.shorts-item.center iframe');
      if(center) center.src=center.src; // reload to stop
    }
  });
},{threshold:0.4});

var shortsSec=document.getElementById('shortsSection');
if(shortsSec) shortsObserver.observe(shortsSec);

// ======== SUPABASE API AUTO-SYNC ========

// Define render callbacks BEFORE lazy loading so they're available when JSON arrives
window._papShortsRender = function(){ buildShortsCarousel(); };

// Auto-play first film in main player when film data loads (muted for autoplay policy)
window._papFilmAutoPlay = function(){
  if(filmAllData.length > 0){
    var fp = document.getElementById('filmMainPlayer');
    if(fp && (fp.src === 'about:blank' || fp.src === '')){
      fp.src = 'https://www.youtube.com/embed/' + filmAllData[0].yt + '?rel=0&autoplay=1&mute=1&loop=1&playlist=' + filmAllData[0].yt;
    }
  }
};

// ======== LAZY DATA LOADING ========
(function(){
  function loadJSON(url, target, renderCb){
    fetch(url).then(function(r){ return r.json(); }).then(function(data){
      target.length = 0;
      data.forEach(function(item){ target.push(item); });
      if(renderCb) renderCb();
      /* Loaded items from JSON */
    }).catch(function(e){
      console.warn('[PAP] Could not load ' + url + ', using API sync fallback');
    });
  }
  // Only load JSON if not running from file:// protocol
  if(window.location.protocol !== 'file:'){
    // Use late-binding wrappers so callbacks are resolved when JSON arrives, not when loadJSON is called
    loadJSON('data/films.json', filmAllData, function(){ if(window._papFilmRenderCards) window._papFilmRenderCards(); if(window._papFilmAutoPlay) window._papFilmAutoPlay(); });
    loadJSON('data/articles.json', artData, function(){ if(window._papArticleRenderCards) window._papArticleRenderCards(); });
    loadJSON('data/editorials.json', edData);
    loadJSON('data/creators.json', creatorData);
    loadJSON('data/shorts.json', shortsData, function(){ if(window._papShortsRender) window._papShortsRender(); });
    // For edDetails (object, not array):
    fetch('data/editorial-details.json?v=2').then(function(r){return r.json();}).then(function(data){
      Object.keys(data).forEach(function(k){ edDetails[k]=data[k]; });
      /* Loaded editorial details */
    }).catch(function(e){ console.warn('[PAP] Could not load editorial details'); });
  }
})();
// Fetches films/articles from Supabase API and merges with hardcoded data.
// API data (from admin uploads) is prepended; hardcoded data serves as fallback.
// Works on all pages: index.html, films.html, articles.html, pap-magazine-v5.html
(function(){
  var PAP_API_BASE='';
  (function detectBase(){
    var h=window.location.hostname;
    if(h==='localhost'||h==='127.0.0.1'){
      PAP_API_BASE='http://localhost:3000/api';
    } else if(h.includes('vercel.app')){
      PAP_API_BASE=window.location.origin+'/api';
    } else if(h.includes('pap-magazine.com') || h.includes('papkorea.com')){
      PAP_API_BASE=window.location.origin+'/api';
    } else {
      // Local file:// or unknown host — skip sync
      PAP_API_BASE='';
    }
  })();

  if(!PAP_API_BASE){
    /* No API detected (local file mode). Using hardcoded data only. */
    return;
  }

  /* API sync active */

  // Convert Supabase film record → hardcoded filmAllData format
  function apiFilmToLocal(f){
    return {
      t: f.title||'',
      yt: f.youtube_id||'',
      th: f.thumbnail_url||'',
      d: f.published_date||'',
      cat: Array.isArray(f.categories)? f.categories.join(',') : (f.categories||'Film'),
      tags: Array.isArray(f.tags)? f.tags.join(',') : (f.tags||''),
      cr: Array.isArray(f.credits)? f.credits : [],
      _api_id: f.id
    };
  }

  // Convert Supabase article record → hardcoded artData format
  function apiArticleToLocal(a){
    return {
      t: a.title||'',
      sub: a.subtitle||'',
      d: a.published_date||'',
      slug: a.slug||'',
      url: a.custom_url||a.slug||'',
      cat: a.category||'',
      th: a.thumbnail_url||'',
      img: a.hero_image_url||'',
      tags: Array.isArray(a.tags)? a.tags : [],
      cr: Array.isArray(a.credits)? a.credits : [],
      desc: a.content||'',
      gallery: Array.isArray(a.gallery)? a.gallery : [],
      _api_id: a.id,
      // Pass through any i18n fields the API exposes (varies by backend schema)
      ti18n: a.title_i18n || a.titleI18n || a.ti18n || null,
      subi18n: a.subtitle_i18n || a.subtitleI18n || a.subi18n || null,
      desci18n: a.content_i18n || a.contentI18n || a.desci18n || null
    };
  }

  // Merge: API items first, then hardcoded (deduplicated by slug/title).
  // If local JSON has ti18n/subi18n for an API-matched article, enrich the API item
  // with those translations so the UI can render non-Korean titles.
  function mergeData(apiItems, localItems){
    var localBySlug={};
    var localByTitle={};
    localItems.forEach(function(item){
      if(item.slug) localBySlug[item.slug]=item;
      var tk=(item.t||'').trim().toLowerCase();
      if(tk) localByTitle[tk]=item;
    });
    var seen={};
    var merged=[];
    apiItems.forEach(function(item){
      var key=(item.t||'').trim().toLowerCase();
      if(!key || seen[key]) return;
      seen[key]=true;
      // Enrich with translations from local JSON when API lacks them
      var localMatch=(item.slug && localBySlug[item.slug]) || localByTitle[key];
      if(localMatch){
        if(!item.ti18n && localMatch.ti18n) item.ti18n=localMatch.ti18n;
        if(!item.subi18n && localMatch.subi18n) item.subi18n=localMatch.subi18n;
        if(!item.desci18n && localMatch.desci18n) item.desci18n=localMatch.desci18n;
      }
      merged.push(item);
    });
    localItems.forEach(function(item){
      var key=(item.t||'').trim().toLowerCase();
      if(key && !seen[key]){
        seen[key]=true;
        merged.push(item);
      }
    });
    return merged;
  }

  // Fetch all pages of a collection
  function fetchAll(endpoint, converter, callback){
    var all=[];
    var page=1;
    var limit=100;
    function fetchPage(){
      fetch(PAP_API_BASE+endpoint+'?status=published&limit='+limit+'&page='+page)
        .then(function(r){return r.json();})
        .then(function(res){
          if(res.data && res.data.length>0){
            res.data.forEach(function(item){
              all.push(converter(item));
            });
            if(res.pagination && page<res.pagination.pages){
              page++;
              fetchPage();
            } else {
              callback(all);
            }
          } else {
            callback(all);
          }
        })
        .catch(function(err){
          console.warn('[PAP Sync] Fetch error:',endpoint,err);
          callback(all);
        });
    }
    fetchPage();
  }

  // Sync films
  function syncFilms(){
    if(typeof filmAllData==='undefined') return;
    fetchAll('/films',apiFilmToLocal,function(apiFilms){
      if(apiFilms.length>0){
        var origLen=filmAllData.length;
        var merged=mergeData(apiFilms, filmAllData);
        // Replace filmAllData in-place (preserve reference)
        filmAllData.length=0;
        merged.forEach(function(f){filmAllData.push(f);});
        /* Films synced from API */
      } else {
        /* Using hardcoded films only */
      }
      // Re-render film cards if the page has a renderCards function (films.html)
      if(typeof window._papFilmRenderCards==='function'){
        window._papFilmRenderCards();
      }
    });
  }

  // Sync articles
  function syncArticles(){
    if(typeof artData==='undefined') return;
    fetchAll('/articles',apiArticleToLocal,function(apiArticles){
      if(apiArticles.length>0){
        var origLen=artData.length;
        var merged=mergeData(apiArticles, artData);
        artData.length=0;
        merged.forEach(function(a){artData.push(a);});
        /* Articles synced from API */
      } else {
        /* Using hardcoded articles only */
      }
      // Re-render article cards if available (articles.html)
      if(typeof window._papArticleRenderCards==='function'){
        window._papArticleRenderCards();
      }
    });
  }

  // Convert Supabase editorial record → hardcoded edData format.
  // editorials.json uses long keys (title/img/date/url/tags) instead of
  // the short keys films/articles use (t/th/d). We keep the same long
  // keys so card-render code can stay one path.
  function apiEditorialToLocal(e){
    var slug = e.slug || '';
    // TWO independent slots from the admin (썸네일 ≠ 커버):
    //   thumbnail  → small home-grid CARD image (img)
    //   cover_image → big editorial-detail TOP image (hero)
    // Each falls back to the other when one is missing so older posts
    // that only filled one slot still render in both places.
    var thumb = e.thumbnail   || e.cover_image || e.thumbnail_url || '';
    var hero  = e.cover_image || e.thumbnail   || e.thumbnail_url || '';
    return {
      title: e.title || '',
      img:   thumb,
      hero:  hero,
      date:  e.published_date || e.created_at || '',
      url:   slug ? ('/'+slug+'/') : ('/editorial/'+(e.id||'')),
      tags:  Array.isArray(e.tags) ? e.tags : (typeof e.tags==='string' ? e.tags.split(',').map(function(t){return t.trim();}).filter(Boolean) : []),
      _api_id: e.id,
      // Carry the rest through so editorial-detail rendering can lift
      // credits / fashion / gallery off the same record without a
      // second fetch.
      // `issue` is the admin's "발행호" subtitle (e.g. "APR. 2026 ISSUE",
      // or "3월호" — year-less inputs get normalized downstream).
      issue:    e.issue || '',
      credits:  Array.isArray(e.credits) ? e.credits : e.credits || [],
      fashion:  e.fashion || null,
      gallery:  Array.isArray(e.gallery) ? e.gallery : [],
      description: e.description || ''
    };
  }

  // edData merger — keys differ from films/articles ('title' instead of
  // 't'), so reuse the same dedupe logic but read the editorial-shaped
  // key directly. API items win when titles collide so admin updates
  // override the static JSON snapshot.
  function mergeEditorials(apiItems, localItems){
    var seen = {};
    var merged = [];
    apiItems.forEach(function(item){
      var key = (item.title || '').trim().toLowerCase();
      if(!key || seen[key]) return;
      seen[key] = true;
      merged.push(item);
    });
    localItems.forEach(function(item){
      var key = (item.title || '').trim().toLowerCase();
      if(key && !seen[key]){
        seen[key] = true;
        merged.push(item);
      }
    });
    return merged;
  }

  // Feed edDetails (the per-editorial detail map keyed by title) with
  // the API record. The map is also seeded by editorial-details.json
  // (a curated snapshot baked at deploy time) — when a key lives in
  // both places the API record WINS, because the admin edits land in
  // the DB and we want those changes visible immediately. We still
  // borrow `issue` from the curated entry as a fallback when the API
  // didn't store one.
  // Issue-label normalizer — collapses every input variant
  // (Korean "4월호", English "APR. ISSUE", numeric dates, etc.) into the
  // unified quarterly volume label "VOL.<n> ISSUE".
  //
  // Quarter-to-volume mapping (anchor: 2026 Q2 = Vol 30):
  //   Q1 = Jan / Feb / Mar
  //   Q2 = Apr / May / Jun
  //   Q3 = Jul / Aug / Sep
  //   Q4 = Oct / Nov / Dec
  //   vol = year*4 + quarter - 8076
  //   →  2026 Q2 (Apr-Jun) = Vol 30
  //   →  2026 Q1 (Jan-Mar) = Vol 29
  //   →  2025 Q4 (Oct-Dec) = Vol 28
  //   →  2025 Q3 (Jul-Sep) = Vol 27
  //   →  2025 Q2 (Apr-Jun) = Vol 26 …
  //
  // Examples:
  //   "4월호"           + 2026 → "VOL.30 ISSUE"
  //   "2026년 4월호"           → "VOL.30 ISSUE"
  //   "MAR. ISSUE"      + 2026 → "VOL.29 ISSUE"
  //   "APR."            + 2026 → "VOL.30 ISSUE"
  //   "APR. 2026 ISSUE"        → "VOL.30 ISSUE"   (re-normalized)
  //   "VOL.30 ISSUE"           → "VOL.30 ISSUE"   (early-return)
  //   "2026-04-15" date         → "VOL.30 ISSUE"
  function _normalizeIssueLabel(raw, dateSource){
    var monthAbbrevs = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var monthFullEn = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    var s = (raw == null) ? '' : String(raw).trim();

    // Already vol-formatted? Keep the editor's exact wording. Matches
    // "VOL.30", "Vol. 30", "VOL 30 ISSUE" etc.
    if(/\bVOL\.?\s*\d+/i.test(s)) return s;

    var year = '';
    var monthIdx = -1; // 0..11

    if(s){
      // 1) 4-digit year
      var ym = s.match(/\b(19|20)\d{2}\b/);
      if(ym) year = ym[0];

      // 2) Korean "<n>월" — strongest signal in Korean labels
      var km = s.match(/(\d{1,2})\s*월/);
      if(km){
        var k = parseInt(km[1], 10);
        if(k >= 1 && k <= 12) monthIdx = k - 1;
      }

      // 3) English abbreviation / full name (case-insensitive)
      if(monthIdx === -1){
        for(var i = 0; i < 12; i++){
          var reAbbr = new RegExp('\\b' + monthAbbrevs[i] + '\\.?', 'i');
          var reFull = new RegExp('\\b' + monthFullEn[i] + '\\b', 'i');
          if(reFull.test(s) || reAbbr.test(s)){ monthIdx = i; break; }
        }
      }

      // 4) Numeric date prefix like "2026-04-15" / "2026/4/15"
      if(monthIdx === -1){
        var dm = s.match(/(\d{4})[\-\/\.](\d{1,2})/);
        if(dm){
          if(!year) year = dm[1];
          var n = parseInt(dm[2], 10);
          if(n >= 1 && n <= 12) monthIdx = n - 1;
        }
      }
    }

    // Year/month fallback from dateSource
    if(!year || monthIdx === -1){
      if(dateSource){
        var d = new Date(dateSource);
        if(!isNaN(d.getTime())){
          if(!year) year = String(d.getFullYear());
          if(monthIdx === -1) monthIdx = d.getMonth();
        }
      }
    }
    // Last resort: today
    if(!year || monthIdx === -1){
      var today = new Date();
      if(!year) year = String(today.getFullYear());
      if(monthIdx === -1) monthIdx = today.getMonth();
    }

    if(monthIdx >= 0 && monthIdx < 12 && year){
      var y = parseInt(year, 10);
      var quarter = Math.ceil((monthIdx + 1) / 3); // 1..4
      var vol = y * 4 + quarter - 8076;
      return 'VOL.' + vol + ' ISSUE';
    }

    // Truly unparseable — return original so the field isn't blank.
    return s;
  }

  function _populateEdDetailsFromApi(apiEd){
    if(typeof edDetails === 'undefined') return;
    var key = apiEd.title;
    if(!key) return;
    var existing = edDetails[key] || {};
    edDetails[key] = {
      // Issue subtitle. Priority: admin-typed value (apiEd.issue) wins
      // because that's the live source of truth; curated existing.issue
      // is the static-JSON snapshot and only used as fallback. Year is
      // injected by _normalizeIssueLabel when missing so newly uploaded
      // posts no longer display "MAR. ISSUE" without a year.
      issue:  _normalizeIssueLabel(apiEd.issue || existing.issue || '', apiEd.date),
      // Detail page hero reads from .thumb (see heroImg.src = det.thumb).
      // Always use the latest API hero — that's where admin's ◆ COVER
      // pick lands.
      thumb:  apiEd.hero || apiEd.img || existing.thumb || '',
      images: apiEd.gallery && apiEd.gallery.length
                ? apiEd.gallery
                : (existing.images && existing.images.length
                    ? existing.images
                    : (apiEd.hero ? [apiEd.hero] : (apiEd.img ? [apiEd.img] : []))),
      // Convert {roles[], name, instagram} array → {r, h:[{n,id}]} display shape.
      credits: (function(raw){
        if(typeof _normalizeCreditsForDisplay === 'function') return _normalizeCreditsForDisplay(raw);
        return Array.isArray(raw) ? raw : [];
      })(apiEd.credits || (existing.credits && existing.credits.length ? null : null)) ,
      fashion: (apiEd.fashion && Array.isArray(apiEd.fashion.brands) && apiEd.fashion.brands.length)
        ? apiEd.fashion.brands.map(function(b){ return b.instagram || b.name || ''; }).filter(Boolean)
        : (Array.isArray(existing.fashion) ? existing.fashion : []),
      // Per-image outfit credits typed in admin under "이미지별 착장 크레딧".
      // Shape: { img_1: "@brand1 Jacket, @brand2 Pants", img_2: "..." }.
      // The detail-page renderer prefers this map over the rotating-brand
      // fallback when an image has its own credit string.
      imageCredits: (apiEd.fashion && apiEd.fashion.imageCredits && typeof apiEd.fashion.imageCredits === 'object')
        ? apiEd.fashion.imageCredits
        : (existing.imageCredits || {}),
      desc: apiEd.description || existing.desc || ''
    };
    // If API came back with no credits at all but the curated entry had
    // some, keep those so the detail page doesn't go blank on edit.
    if((!apiEd.credits || (Array.isArray(apiEd.credits) && apiEd.credits.length===0))
       && Array.isArray(existing.credits) && existing.credits.length){
      edDetails[key].credits = existing.credits;
    }
  }

  function syncEditorials(){
    if(typeof edData==='undefined') return;
    fetchAll('/editorials',apiEditorialToLocal,function(apiEds){
      if(apiEds.length===0) return;

      // 1. Update the in-memory edData array (powers search + edAllOverlay)
      var merged = mergeEditorials(apiEds, edData);
      edData.length = 0;
      merged.forEach(function(e){
        edData.push(e);
        _populateEdDetailsFromApi(e);
      });

      // 2. Reconcile the home grid with the API.
      //    The grid is HARDCODED in index.html (one <div.ed-row-card>
      //    per editorial) — the static markup is built at deploy time.
      //    For each API editorial:
      //      • If a static card with the same title already exists,
      //        UPDATE that card in place so admin edits (changed
      //        thumbnail, new title casing, new date) actually render.
      //        Without this, edits saved in admin appeared in the DB
      //        but the home page kept showing the static snapshot.
      //      • If no static card matches, PREPEND a fresh card so
      //        brand-new admin uploads still surface on the home page.
      var track = document.querySelector('.ed-row-track');
      if(track){
        // Build an index from lowercase title → existing static card
        // so we can update-in-place instead of duplicating.
        var staticCardByTitle = {};
        track.querySelectorAll('.ed-row-card').forEach(function(c){
          var t = (c.querySelector('.ed-row-card-title')||{}).textContent || '';
          var k = t.trim().toLowerCase();
          if(k) staticCardByTitle[k] = c;
        });
        // Walk in reverse so the first item in apiEds (newest) ends
        // up first in the DOM after a chain of insertBefore calls.
        for(var i=apiEds.length-1; i>=0; i--){
          var e = apiEds[i];
          var key = (e.title||'').trim().toLowerCase();
          if(!key) continue;
          if(!e.img) continue; // a thumbnail-less card would render broken

          var safeTitle = (e.title||'').replace(/"/g, '&quot;');
          var safeImg   = (e.img||'').replace(/"/g, '&quot;');
          var dateLabel = e.date ? (e.date.split('T')[0]) : '';
          var catLabel = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
          var existing = staticCardByTitle[key];
          if(existing){
            // UPDATE in place — keeps DOM order stable so the home
            // grid layout doesn't reshuffle on every refresh.
            var existingImg = existing.querySelector('.ed-row-card-img img');
            if(existingImg){
              existingImg.setAttribute('src', safeImg);
              existingImg.setAttribute('alt', safeTitle);
            }
            existing.setAttribute('onclick', 'openEditorial("'+safeTitle+'","'+safeImg+'")');
            existing.setAttribute('data-tags', Array.isArray(e.tags) ? e.tags.join(',') : '');
            existing.setAttribute('data-api-synced', '1');
            var catEl = existing.querySelector('.ed-row-card-cat');
            if(catEl) catEl.textContent = catLabel;
            var titleEl = existing.querySelector('.ed-row-card-title');
            if(titleEl) titleEl.textContent = (e.title||'').toUpperCase();
          } else {
            // PREPEND new card.
            var card = document.createElement('div');
            card.className = 'ed-row-card';
            card.setAttribute('data-tags', Array.isArray(e.tags) ? e.tags.join(',') : '');
            card.setAttribute('data-api-injected', '1');
            card.setAttribute('onclick', 'openEditorial("'+safeTitle+'","'+safeImg+'")');
            card.innerHTML =
              '<div class="ed-row-card-img"><img loading="lazy" src="'+safeImg+'" alt="'+safeTitle+'" onerror="if(window.edImgError)edImgError(this)"></div>' +
              '<div class="ed-row-card-info"><div class="ed-row-card-cat">'+catLabel+'</div><div class="ed-row-card-title">'+(e.title||'').toUpperCase()+'</div></div>';
            track.insertBefore(card, track.firstChild);
          }
        }
      }

      // 3. If the all-editorials overlay has already built itself,
      //    rebuild it so it reflects the merged edData too.
      if(typeof _renderEdAllPage === 'function' && typeof edAllBuilt !== 'undefined' && edAllBuilt){
        try { _renderEdAllPage(); } catch(_){}
      }
    });
  }

  // Run sync after DOM is ready
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      syncFilms();
      syncArticles();
      syncEditorials();
    });
  } else {
    // DOM already loaded — small delay to let page scripts initialize first
    setTimeout(function(){
      syncFilms();
      syncArticles();
      syncEditorials();
    },100);
  }
})();

// buildShortsCarousel() is now called via _papShortsRender callback after data loads

var shortsResizeTimer=null;
window.addEventListener('resize',function(){
  clearTimeout(shortsResizeTimer);
  shortsResizeTimer=setTimeout(updateShortsPositions,150);
});

// MARQUEE: extracted to pap-home.js (mission 9).

// ======== PAGINATION UTILITY ========
// Pagination component (PAP_PER_PAGE, PAP_PAGE_JUMP, buildPagination)
// extracted to pap-utils.js (mission 5). Called from articles.html, films.html,
// and the editorial-list section below as a global.

// ======== SEO: per-editorial meta tag updater ========
// Updates document.title, meta description, og:*, twitter:*, canonical
// and injects a JSON-LD Article schema when an editorial overlay opens.
// Helps social-share crawlers (Kakao/Facebook/X) show editorial-specific
// previews and gives Google's JS-aware indexer richer signals than the
// generic homepage tags.
function _updateEditorialMeta(title, det){
  if(!title) return;
  var lang = (typeof localStorage !== 'undefined' && localStorage.getItem('pap-lang')) || 'ko';
  var rawDesc = det && det.desc;
  var descText = '';
  if(typeof rawDesc === 'string') descText = rawDesc;
  else if(rawDesc && typeof rawDesc === 'object') descText = rawDesc[lang] || rawDesc.en || rawDesc.ko || '';
  // Strip HTML, collapse whitespace, cap at 200 chars for meta description.
  var desc = String(descText).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if(!desc){
    desc = title + ' — ' + (det && det.issue || '') + ' on PAP Magazine';
  }
  var img = (det && det.thumb) || '';
  var url = 'https://www.pap-magazine.com/#editorial/' + encodeURIComponent(title);
  var pageTitle = title + ' | PAP Magazine';

  // Helper: get-or-create a meta tag and set its content.
  function _setMeta(selector, attrName, attrValue, content){
    var el = document.head.querySelector(selector);
    if(!el){
      el = document.createElement('meta');
      el.setAttribute(attrName, attrValue);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }
  document.title = pageTitle;
  _setMeta('meta[name="description"]',         'name',     'description',     desc);
  _setMeta('meta[property="og:title"]',        'property', 'og:title',        pageTitle);
  _setMeta('meta[property="og:description"]',  'property', 'og:description',  desc);
  _setMeta('meta[property="og:url"]',          'property', 'og:url',          url);
  _setMeta('meta[property="og:type"]',         'property', 'og:type',         'article');
  if(img) _setMeta('meta[property="og:image"]','property', 'og:image',        img);
  _setMeta('meta[name="twitter:card"]',        'name',     'twitter:card',    'summary_large_image');
  _setMeta('meta[name="twitter:title"]',       'name',     'twitter:title',   pageTitle);
  _setMeta('meta[name="twitter:description"]', 'name',     'twitter:description', desc);
  if(img) _setMeta('meta[name="twitter:image"]','name',    'twitter:image',   img);

  // Canonical link
  var canon = document.head.querySelector('link[rel="canonical"]');
  if(!canon){
    canon = document.createElement('link');
    canon.setAttribute('rel', 'canonical');
    document.head.appendChild(canon);
  }
  canon.setAttribute('href', url);

  // JSON-LD Article schema. Replace any previous editorial schema we
  // injected so we don't accumulate duplicates as the user navigates.
  var prevLd = document.head.querySelector('script[data-pap-ld="editorial"]');
  if(prevLd) prevLd.parentNode.removeChild(prevLd);
  try {
    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description: desc,
      image: img ? [img] : undefined,
      url: url,
      author: { '@type': 'Organization', name: 'PAP Magazine' },
      publisher: {
        '@type': 'Organization',
        name: 'PAP Magazine',
        logo: { '@type': 'ImageObject', url: 'https://www.pap-magazine.com/pap-logo.png' }
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url }
    };
    // Strip undefined keys so the JSON is clean
    Object.keys(schema).forEach(function(k){ if(schema[k] === undefined) delete schema[k]; });
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.setAttribute('data-pap-ld', 'editorial');
    ld.text = JSON.stringify(schema);
    document.head.appendChild(ld);
  } catch(_) {}
}

// Reset meta tags back to homepage defaults when leaving the editorial
// overlay (closeEditorial / popstate to non-#editorial URL). Captured
// at first call so we don't drift over time.
var _PAP_HOME_META = null;
function _captureHomeMeta(){
  if(_PAP_HOME_META) return;
  function _read(sel, attr){ var e = document.head.querySelector(sel); return e ? e.getAttribute(attr) : ''; }
  _PAP_HOME_META = {
    title: document.title,
    description: _read('meta[name="description"]', 'content'),
    ogTitle: _read('meta[property="og:title"]', 'content'),
    ogDescription: _read('meta[property="og:description"]', 'content'),
    ogUrl: _read('meta[property="og:url"]', 'content'),
    ogImage: _read('meta[property="og:image"]', 'content'),
    canonical: _read('link[rel="canonical"]', 'href')
  };
}
function _resetEditorialMeta(){
  _captureHomeMeta();
  if(!_PAP_HOME_META) return;
  document.title = _PAP_HOME_META.title || 'PAP Magazine';
  function _setIf(sel, attr, val){ var e = document.head.querySelector(sel); if(e && val) e.setAttribute(attr, val); }
  _setIf('meta[name="description"]',         'content', _PAP_HOME_META.description);
  _setIf('meta[property="og:title"]',        'content', _PAP_HOME_META.ogTitle);
  _setIf('meta[property="og:description"]',  'content', _PAP_HOME_META.ogDescription);
  _setIf('meta[property="og:url"]',          'content', _PAP_HOME_META.ogUrl);
  _setIf('meta[property="og:image"]',        'content', _PAP_HOME_META.ogImage);
  _setIf('meta[property="og:type"]',         'content', 'website');
  _setIf('link[rel="canonical"]',            'href',    _PAP_HOME_META.canonical);
  var ld = document.head.querySelector('script[data-pap-ld="editorial"]');
  if(ld) ld.parentNode.removeChild(ld);
}
// Capture homepage meta on page load (before any editorial opens).
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _captureHomeMeta);
} else {
  _captureHomeMeta();
}
// Reset on popstate when hash leaves the editorial namespace
window.addEventListener('popstate', function(){
  if(window.location.hash.indexOf('#editorial/') !== 0){
    _resetEditorialMeta();
  }
});

// ======== DEEP LINK: open editorial from hash #editorial/Title ========
// Accepts EITHER the canonical title ("Refractions") OR a slug-style
// fragment ("refractions", "indigestible-rituals") so old pap-magazine.com
// URLs that get 301'd here (vercel.json redirects /ko/<slug>/ →
// /#editorial/<slug>) still resolve to the correct editorial.
(function(){
  var hash=window.location.hash;
  if(hash && hash.indexOf('#editorial/')===0){
    var edName=decodeURIComponent(hash.substring('#editorial/'.length));
    if(!edName) return;
    function _resolveEditorialName(input){
      if(!input) return input;
      // 1. Exact match in edDetails (most common — case-correct title)
      if(typeof edDetails === 'object' && edDetails[input]) return input;
      // 2. Case-insensitive title match — handles e.g. "refractions" → "Refractions"
      var lower = input.toLowerCase();
      if(typeof edDetails === 'object'){
        for(var k in edDetails){
          if(k.toLowerCase() === lower) return k;
        }
      }
      // 3. Slug-style match: dashes → spaces, then case-insensitive
      //    Catches "indigestible-rituals" → "Indigestible Rituals".
      var spaced = lower.replace(/-/g, ' ');
      if(typeof edDetails === 'object'){
        for(var k2 in edDetails){
          if(k2.toLowerCase() === spaced) return k2;
        }
      }
      // 4. Match against edData[].url (the original /slug/ path)
      if(typeof edData !== 'undefined' && Array.isArray(edData)){
        for(var i=0;i<edData.length;i++){
          var slug = (edData[i].url||'').replace(/^\/+|\/+$/g, '').toLowerCase();
          if(slug && (slug === lower || slug === spaced)){
            return edData[i].title;
          }
        }
      }
      // 5. Fallback — pass through, openEditorial will use its own
      //    case-insensitive lookup as last resort.
      return input;
    }
    function tryOpenHash(){
      if(typeof openEditorial!=='function') return;
      var resolved = _resolveEditorialName(edName);
      openEditorial(resolved, '');
    }
    if(document.readyState==='complete') setTimeout(tryOpenHash,1200);
    else window.addEventListener('load',function(){setTimeout(tryOpenHash,1200);});
  }
})();

// ======== DEEP LINK: open editorial from ?ed= param ========
(function(){
  var params=new URLSearchParams(window.location.search);
  var edName=params.get('ed');
  if(!edName)return;
  // Clean ?ed= from URL immediately (before pushState from openEditorial)
  history.replaceState(null,'',window.location.pathname);
  /* Reveal body (remove the deep-link black cover injected in index.html
     <head>) once the editorial overlay is visible on top. */
  function revealBody(){
    if(document.body&&!document.body.classList.contains('pap-deeplink-ready')){
      document.body.classList.add('pap-deeplink-ready');
    }
  }
  /* Poll for edDetails to populate (loaded async from API). As soon as
     the entry is available, open the editorial — no more blind 1200ms
     wait. Falls back to opening with whatever data exists after 3s. */
  var pollStart=Date.now();
  function tryOpen(){
    if(typeof openEditorial!=='function'){
      setTimeout(tryOpen,100); return;
    }
    var ready=(typeof edDetails==='object'&&edDetails&&(edDetails[edName]||Object.keys(edDetails).length>0));
    var elapsed=Date.now()-pollStart;
    if(!ready&&elapsed<3000){setTimeout(tryOpen,100);return;}
    try{ openEditorial(edName,''); }catch(e){}
    /* Reveal shortly after openEditorial triggers its own render so the
       editorial overlay is painted before we fade in. */
    setTimeout(revealBody,60);
  }
  if(document.readyState==='complete') tryOpen();
  else window.addEventListener('load',tryOpen);
})();

// Image right-click protection IIFE: extracted to pap-subscription.js (mission 6).

