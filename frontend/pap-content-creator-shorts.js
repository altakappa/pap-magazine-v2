// PAP Magazine — Content harness, Creator + Shorts sub-module (extracted
// from pap-app.js per HARNESS_CHECKLIST.md mission 8d).
//
// Owns:
//   CREATOR:
//     - creatorData (creator dataset, lazily populated)
//     - creatorDB (slug-keyed lookup, lazy-built)
//     - buildCreatorDB / getCreatorDB
//     - openCreatorPopup / _openCreatorPopup_noPush
//     - openProfileByHandle (deep-link by @handle)
//   SHORTS:
//     - shortsData / shortsIdx / shortsAutoTimer / shortsInView
//     - buildShortsCarousel (track + dots + click handlers)
//     - moveShort, autoplay timer
//     - shortsObserver (IntersectionObserver, pause off-screen)
//
// Creator and Shorts ship together because both are smaller than the other
// content types (~220 + ~100 lines) and their public surfaces are mostly
// independent — splitting them into two files would inflate boilerplate.
//
// Public surface (consumed cross-script via globals):
//   window.openCreatorPopup(cr) / _openCreatorPopup_noPush(cr)
//   window.openProfileByHandle(handle)
//   window.getCreatorDB()
//   var shortsData
//   window.moveShort(dir)
//   window._papShortsRender (set in pap-app.js to call buildShortsCarousel)
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js → lockScroll/unlockScroll
//   - pap-i18n.js  → lang
//
// The cross-content popstate handler in pap-app.js calls
// _openCreatorPopup_noPush as a bare global at click time.

// ======== CREATOR DATA + PROFILE SYSTEM ========
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
//
// Credits/fashion entries arrive in three shapes (curated JSON string,
// admin object with both name+id, or admin object with just one of them).
// We MUST normalise to two strings — `handle` and `displayName` — before
// touching `.toLowerCase()` / `.replace()`, otherwise an entry like
// {n:'Photographer', id:''} (no Instagram handle) falls through the old
// `h.id ? h.id : h` ternary to `h` (the object), and `.toLowerCase()`
// throws TypeError, killing the whole DB build mid-loop.
function _coerceCreatorEntry(h){
  var handle = '', displayName = '';
  if(h && typeof h === 'object'){
    handle      = (typeof h.id === 'string' ? h.id : '') || '';
    displayName = (typeof h.n  === 'string' ? h.n  : '') || '';
  } else if(typeof h === 'string'){
    handle      = h;
    displayName = h.replace(/^@/, '');
  }
  // If we got a handle but no display name, derive it from the handle.
  if(!displayName && handle) displayName = handle.replace(/^@/, '');
  return { handle: handle, displayName: displayName };
}

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
        var c = _coerceCreatorEntry(h);
        // Skip entries with neither name nor handle — they'd produce a
        // db[''] bucket that swallows every other empty entry.
        if(!c.handle && !c.displayName) return;
        // Key by handle when we have one, otherwise by display-name so a
        // photographer with no IG handle still gets a stable bucket
        // ("Photography: John Doe" → key "name:john doe").
        var key = c.handle
          ? c.handle.toLowerCase()
          : ('name:' + c.displayName.toLowerCase());
        if(!db[key]){db[key]={name:c.displayName,handle:c.handle,role:cr.r,editorials:[],imgs:[]};}
        if(db[key].editorials.indexOf(title)===-1){
          db[key].editorials.push(title);
          if(ed.thumb) db[key].imgs.push({title:title,img:ed.thumb});
        }
      });
    });
    // Process fashion — supports both {n,id} objects and plain strings
    (ed.fashion||[]).forEach(function(h){
      var c = _coerceCreatorEntry(h);
      if(!c.handle && !c.displayName) return;
      var key = c.handle
        ? c.handle.toLowerCase()
        : ('name:' + c.displayName.toLowerCase());
      if(!db[key]){db[key]={name:c.displayName,handle:c.handle,role:'Fashion Brand',editorials:[],imgs:[]};}
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
  // Save the editorial overlay's current scroll position BEFORE we push
  // a new history state. When the user closes this popup, popstate will
  // re-render the editorial via _openEditorialInner_noPush, which sets
  // edOverlay.scrollTop=0 — without this snapshot the user gets snapped
  // to the very top of the editorial instead of the credit row they
  // clicked from.
  try {
    var _edOv = document.getElementById('edOverlay');
    if(_edOv && _edOv.classList.contains('active')){
      window._papEdScrollBeforeCreator = _edOv.scrollTop;
    }
  } catch(_){}
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
    ratingSlot.innerHTML='<div class="pap-profile-rating-empty">'+(_shL9('별점 불러오는 중...','Loading ratings...'))+'</div>';
    Promise.resolve(PAPSocial.getCreatorAvgRating(handle)).then(function(cav){
      if(cav && cav.count>0){
        ratingSlot.innerHTML='<div class="pap-profile-rating">'+
          '<span class="pap-profile-rating-num">'+cav.avg.toFixed(1)+'</span>'+
          '<span class="pap-profile-rating-stars">'+PAPSocial.starHTML(cav.avg,false)+'</span>'+
          '<span class="pap-profile-rating-count">'+cav.count+(_shL9('명 평가 · ',' ratings · '))+(cav.ratedEditorials||0)+'/'+(cav.editorials||editorials.length)+(_shL9(' 에디토리얼',' editorials'))+'</span>'+
        '</div>';
      } else if(editorials.length>0){
        ratingSlot.innerHTML='<div class="pap-profile-rating-empty">'+(_shL9('아직 별점이 등록되지 않았습니다','No ratings yet'))+'</div>';
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
      if(cav&&cav.count>0){ratingSlot.innerHTML='<div class="pap-profile-rating"><span class="pap-profile-rating-num">'+cav.avg.toFixed(1)+'</span><span class="pap-profile-rating-stars">'+PAPSocial.starHTML(cav.avg,false)+'</span><span class="pap-profile-rating-count">'+cav.count+(_shL9('명 평가 · ',' ratings · '))+(cav.ratedEditorials||0)+'/'+(cav.editorials||editorials.length)+' 에디토리얼</span></div>';}
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

// ======== SHORTS CAROUSEL ========
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
  // QA(2026-07): 카드 폭을 하드코딩(240)하지 않고 실제 렌더 폭에서 읽는다.
  // CSS 가 모바일 브레이크포인트마다 .shorts-item 폭을 줄이는데(240→…→140),
  // 아래 중앙정렬(50% - 폭/2)이 이 값에 물려 있어 하드코딩 시 모바일에서 카드가
  // 왼쪽으로 치우쳤다. (transform:scale 은 offsetWidth 에 영향 없음 → CSS width 반환)
  var itemW=(items[0] && items[0].offsetWidth) ? items[0].offsetWidth : 240;
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

    item.style.left='calc(50% - '+(itemW/2)+'px + '+x+'px)';

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

// QA(2026-07) #11 — 홈 숏츠 미노출 자가복구.
// 공용 정적 로더(pap-content-api-sync.js#startStaticLoads)가 라이브에서
// 간헐적으로 shortsData 를 채우지 못해(로드 타이밍/전역 경합) 숏츠 트랙이
// 빈 껍데기(제목+좌우버튼만)로 남는 사례가 재현됐다. 홈에 트랙이 존재하는데
// 데이터가 비어 있으면 정적 JSON 을 직접 한 번 더 로드해 복구한다. 공용
// 로더를 건드리지 않는 격리된 방어라 다른 컬렉션에 영향이 없다.
(function(){
  function _healShorts(){
    var track=document.getElementById('shortsTrack');
    if(!track) return;                              // 홈이 아니면 무시
    if(shortsData && shortsData.length) return;     // 이미 채워짐
    fetch('data/shorts.json',{cache:'no-store'})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if(!Array.isArray(data) || !data.length) return;
        if(shortsData.length) return;               // 그 사이 채워졌으면 스킵
        data.forEach(function(x){ shortsData.push(x); });
        if(window._papShortsRender) window._papShortsRender();
        else buildShortsCarousel();
      })
      .catch(function(){ /* 조용히 무시 — 트랙은 비어도 페이지는 정상 */ });
  }
  // startStaticLoads 는 load 후 ~800ms 에 도는 지연 로더라 여유 있게 2.5s 뒤 확인.
  if(document.readyState==='complete'){ setTimeout(_healShorts,2500); }
  else { window.addEventListener('load', function(){ setTimeout(_healShorts,2500); }); }
})();



/* 9-language UI strings (2026-07-26) — _shL9(ko,en) resolves
   it/fr/es/ja/zh/ru/de from _SH_TR9 (keyed by Korean source);
   ko/en literals at each call site remain exact fallbacks. */
var _SH_TR9 = {"별점 불러오는 중...":{"it":"Caricamento valutazioni...","fr":"Chargement des notes...","es":"Cargando valoraciones...","ja":"評価を読み込み中...","zh":"正在加载评分...","ru":"Загрузка оценок...","de":"Bewertungen werden geladen..."},"명 평가 · ":{"it":" valutazioni · ","fr":" notes · ","es":" valoraciones · ","ja":"件の評価 · ","zh":" 条评价 · ","ru":" оценок · ","de":" Bewertungen · "}," 에디토리얼":{"it":" editoriali","fr":" éditoriaux","es":" editoriales","ja":" エディトリアル","zh":" 篇编辑内容","ru":" редакционных","de":" Editorials"},"아직 별점이 등록되지 않았습니다":{"it":"Ancora nessuna valutazione","fr":"Aucune note pour l'instant","es":"Aún no hay valoraciones","ja":"まだ評価がありません","zh":"暂无评分","ru":"Оценок пока нет","de":"Noch keine Bewertungen"}};
function _shL9(ko,en){ var l; try{l=localStorage.getItem('pap-lang')||'ko';}catch(e){l='ko';} if(l==='ko') return ko; var m=_SH_TR9[ko]; if(m&&m[l]) return m[l]; return en; }
