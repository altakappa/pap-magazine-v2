// PAP Magazine — Content harness, Film sub-module (extracted from pap-app.js
// per HARNESS_CHECKLIST.md mission 8b).
//
// Owns:
//   - filmAllData (film dataset, populated lazily from /api/films)
//   - openAllFilms / closeAllFilms / openFilmDetail / closeFilmDetail
//   - _findFilmByTitle
//   - filmSlug / filmPageUrl
//   - Film row Netflix-style hover + manual horizontal scroll IIFE
//   - playFilm / stopFilm + IntersectionObserver
//
// Public surface (consumed cross-script via globals):
//   var filmAllData                  film dataset (window.filmAllData mirrored
//                                    by pap-app.js)
//   window.openAllFilms() / closeAllFilms()
//   window.openFilmDetail(idx) / closeFilmDetail(skipHistory)
//   window._findFilmByTitle(title)
//   window.filmSlug(title) / filmPageUrl(title)
//   window.playFilm(card) / stopFilm()
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js        → lockScroll/unlockScroll, escapeHtml,
//                           buildPagination
//   - pap-i18n.js         → lang, T (some labels)
//   - pap-subscription.js → showPremiumInterstitial, isStandardOrAbove
//
// The cross-content popstate handler in pap-app.js calls closeFilmDetail and
// closeAllFilms as bare globals at click time.

// ======== ALL FILMS OVERLAY (openAllFilms / closeAllFilms / openFilmDetail / _findFilmByTitle / closeFilmDetail) ========
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


// ======== FILM DATABASE slot ========
// ======== FILM DATABASE (141 films) ========
var filmAllData=[];

// ======== FILM SLUG HELPER + NETFLIX HOVER + SCROLL ========
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

// ======== FILM AUTO-PLAY ========
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

