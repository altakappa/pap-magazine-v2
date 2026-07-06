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
    // SEO — 실제 <a href="/film/<slug>"> 카드 (크롤러 링크 그래프용).
    // 클릭은 preventDefault 후 기존 SPA 상세 오버레이 유지.
    var card=document.createElement('a');
    card.className='film-all-card';
    card.setAttribute('href', f.slug ? '/film/'+encodeURIComponent(f.slug) : '#');
    card.setAttribute('data-cats',(f.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); openFilmDetail(i); };
    var dateStr=f.d?f.d.substring(0,10):'';
    card.innerHTML='<div class="film-all-thumb"><img src="'+f.th+'" alt="'+escapeHtml(f.t)+'" loading="lazy" onerror="edImgError(this)"><div class="film-play-icon"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><path d="M8 5v14l11-7z"/></svg></div></div><div class="film-all-info"><div class="film-all-cat">'+(f.cat||'FILM').toUpperCase()+' · '+dateStr+'</div><div class="film-all-title">'+escapeHtml(f.t)+'</div></div>';
    grid.appendChild(card);
  });
  count.textContent=filmAllData.length+' FILMS';
  // QA #330 — 히스토리 스택 정합성. `/films` clean path (vercel rewrite로
  // films.html 서빙) 또는 `/#films-all` hash 로 진입한 경우 URL 이 이미
  // 이 상태를 나타내므로 replaceState. 그 외(홈에서 오버레이 오픈)는
  // pushState 로 새 entry 를 만들어야 X 닫기 → history.back() 이 정확히
  // 원래 있던 페이지로 복귀.
  var alreadyOnFilmsUrl =
    window.location.hash === '#films-all' ||
    window.location.pathname === '/films';
  var targetFilmsUrl = window.location.pathname + '#films-all';
  if(alreadyOnFilmsUrl){
    history.replaceState({overlay:'films'},'', targetFilmsUrl);
  } else {
    history.pushState({overlay:'films'},'', targetFilmsUrl);
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
function closeAllFilms(skipHistory){
  var overlay=document.getElementById('filmAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
    // QA #244 — Mirror closeFilmDetail / closeEditorial: a header X
    // click goes back in history so the URL and visible overlay stay
    // in sync. Without this, the overlay closed but the entry stayed
    // on the stack, and a refresh re-opened the same overlay.
    if(!skipHistory){ try { history.back(); } catch(e){} }
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
  // QA #239 v2 — close any other open overlay first (e.g. an editorial
  // overlay the user came from via a RELATED FILMS click).
  try { if(typeof _papCloseOtherOverlays === 'function') _papCloseOtherOverlays('filmDetailOverlay'); } catch(_){}
  var f=filmAllData[idx];if(!f) return;
  var overlay=document.getElementById('filmDetailOverlay');
  if(!overlay) return;
  // Guard: only build the embed URL when youtube_id matches the canonical
  // 11-char shape. Legacy rows that accidentally stored a full URL (QA #160
  // — "Selects" film) would otherwise produce
  //   https://www.youtube.com/embed/https://www.youtube.com/<id>
  // which renders as a blank YouTube page. Point the iframe at about:blank
  // when the id is malformed so the user sees an empty player rather than a
  // confusing YouTube error. The admin form now refuses such ids going forward.
  var _player = document.getElementById('filmDetailPlayer');
  if (f.yt && /^[A-Za-z0-9_-]{11}$/.test(f.yt)) {
    _player.src = 'https://www.youtube.com/embed/' + f.yt + '?autoplay=1&rel=0';
  } else {
    _player.src = 'about:blank';
    if (typeof console !== 'undefined') console.warn('[film] invalid youtube_id, skipping embed:', f && f.yt);
  }
  document.getElementById('filmDetailTitle').textContent=f.t||'';
  var catStr=(f.cat||'Film');
  if(f.d) catStr+=' · '+f.d;
  document.getElementById('filmDetailCat').textContent=catStr;
  var credEl=document.getElementById('filmDetailCredits');
  if(credEl){
    // Ensure the grid container class is applied so .ed-cred-row children
    // form a proper 2-column layout (role | name).
    credEl.classList.add('ed-credits-table');
    // QA #306 — 필름 크레딧이 비어있을 때 (관리자가 "에디토리얼과 동일"
    // 모드로 저장한 경우) 연결된 에디토리얼의 credits로 fallback.
    // /api/films 조인에 credits 컬럼을 포함시켜 별도 fetch 없이 처리.
    var cr = (Array.isArray(f.cr) && f.cr.length) ? f.cr : [];
    if (!cr.length && f.rel && Array.isArray(f.rel.credits) && f.rel.credits.length){
      cr = f.rel.credits;
    }
    // QA #162 — credits used to render only the legacy {r, p} short-key
    // shape (saved by the 2026-Q1 migration scripts). The admin form saves
    // the new {roles, name, instagram} long-key shape, so every admin-
    // entered credit was silently invisible. Now we accept both shapes:
    //   role:     c.r  || c.roles.join(' & ')
    //   name:     c.name (new shape only — legacy had no name field)
    //   handles:  c.p   || c.instagram   (comma-separated string)
    // QA #231 — Unify the credit display with the editorial detail page.
    // Editorial renders ONE clickable token per credit: the person's name
    // (with the Instagram handle as a fallback when no name was saved),
    // and clicking it deep-links into the Instagram profile. The film
    // page used to render BOTH name and handles next to each other,
    // which read as a different style on the same dataset. Now both
    // surfaces look identical — name first, clickable, opens Instagram.
    // QA #279 — 같은 역할에 여러 사람이 있을 때 역할명 1회만 표기, 사람들은
    // 콤마로 묶어 한 row에 표시. (에디토리얼 크레딧 표기 방식과 통일)
    // 입력 순서를 유지하면서 그룹화 — Map의 insertion order 활용.
    var groups = new Map();
    cr.forEach(function(c){
      if (!c || typeof c !== 'object') return;
      var roleRaw =
        c.r != null ? c.r
        : Array.isArray(c.roles) ? c.roles.join(' & ')
        : (c.roles || '');
      var nameRaw = (c.name || '').trim();
      var handlesRaw = c.p != null ? c.p : (c.instagram || '');
      var handleList = String(handlesRaw || '').split(',').map(function(h){
        h = (h || '').trim();
        if(!h) return '';
        return h.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '');
      }).filter(Boolean);
      // 한 credit 객체에서 토큰(들) 생성 — 이름 있으면 이름 1개, 없으면 핸들들.
      var localTokens = [];
      if (nameRaw){
        var primaryHandle = handleList[0] || '';
        if (primaryHandle){
          localTokens.push('<a href="#" class="film-cred-link" data-handle="' + primaryHandle.replace(/"/g,'') + '" style="cursor:pointer">' + escapeHtml(nameRaw) + '</a>');
        } else {
          localTokens.push(escapeHtml(nameRaw));
        }
      } else if (handleList.length){
        handleList.forEach(function(h){
          localTokens.push('<a href="#" class="film-cred-link" data-handle="' + h.replace(/"/g,'') + '" style="cursor:pointer">' + escapeHtml(h) + '</a>');
        });
      }
      if (!roleRaw && !localTokens.length) return;
      var key = String(roleRaw || '');
      if (!groups.has(key)) groups.set(key, []);
      // 같은 그룹 안에 중복 이름 방지 (text 비교 — 링크 HTML 차이는 무시).
      var existing = groups.get(key);
      localTokens.forEach(function(tok){
        var plain = tok.replace(/<[^>]+>/g, '').trim().toLowerCase();
        var dup = existing.some(function(e){ return e.replace(/<[^>]+>/g, '').trim().toLowerCase() === plain; });
        if (!dup) existing.push(tok);
      });
    });
    var html = '';
    groups.forEach(function(tokens, roleKey){
      if (!tokens.length) return;
      html += '<div class="ed-cred-row">'
            +   '<div class="ed-cred-role">' + escapeHtml(roleKey) + '</div>'
            +   '<div class="ed-cred-val">' + tokens.join(', ') + '</div>'
            + '</div>';
    });
    credEl.innerHTML = html;
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
  // QA #162 — Related Editorial card. apiFilmToLocal mirrors the
  // /api/films join into f.rel, so the overlay's hidden anchor flips
  // on whenever there's a linked editorial. Falls back to the film's
  // own thumbnail if the editorial has neither cover_image nor a
  // thumbnail of its own (rare).
  var relEl = document.getElementById('filmDetailRelated');
  if (relEl) {
    var rel = f.rel || null;
    if (rel && (rel.slug || rel.id) && rel.title) {
      var slugOrId = rel.slug || rel.id;
      relEl.setAttribute('href', '/editorial/' + encodeURIComponent(slugOrId));
      var img = document.getElementById('filmDetailRelatedImg');
      if (img) img.src = rel.cover_image || rel.thumbnail || f.th || '';
      var tEl = document.getElementById('filmDetailRelatedTitle');
      if (tEl) tEl.textContent = rel.title || '';
      relEl.style.display = 'flex';
    } else {
      relEl.style.display = 'none';
    }
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
  // QA #166 — clean URLs: /film/<slug> instead of #film/<title>.
  // Slug from DB (apiFilmToLocal); falls back to title-derived slug for
  // static-snapshot rows that pre-date the slug column.
  try{
    var _fSlug = f.slug || _filmTitleToSlug(f.t||'');
    var _fpath = '/film/' + _fSlug;
    var _fState = {film:true, idx:idx, slug:_fSlug, title:f.t||''};
    if(window.location.pathname === _fpath){
      history.replaceState(_fState, '', _fpath);
    }else{
      history.pushState(_fState, '', _fpath);
    }
  }catch(e){}
}

// QA #166 — title → URL slug fallback for films without a DB slug.
// Same shape as the editorial helper.
function _filmTitleToSlug(t){
  return String(t||'')
    .toLowerCase()
    .replace(/['"`]+/g, '')
    .replace(/[^\w\s가-힣-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
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
    // QA #287 — iframe.src='about:blank' 변경은 YouTube embed에 따라 main window
    // history에 entry를 남길 수 있어 뒤로가기가 "1회는 player 변경, 2회로 페이지 이동"
    // 동작을 유발. iframe element 자체를 새 빈 노드로 교체해 부수효과 제거.
    var oldPlayer = document.getElementById('filmDetailPlayer');
    if(oldPlayer && oldPlayer.parentNode){
      var newPlayer = oldPlayer.cloneNode(false);
      newPlayer.removeAttribute('src');
      oldPlayer.parentNode.replaceChild(newPlayer, oldPlayer);
    }
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
        else window.location.href='/films';
      } else {
        window.location.href='/films';
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

