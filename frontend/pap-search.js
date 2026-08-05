// PAP Magazine — Search module (extracted from pap-app.js per HARNESS_CHECKLIST.md mission 4)
//
// Owns: search bar toggle, search-input event wiring, the editorial search
//   algorithm + dropdown / legacy-panel rendering.
//
// Public surface (consumed cross-script via globals):
//   window.toggleSearch()       — open/close the search bar (called from
//                                 inline onclick= attributes across pages)
//   window.searchEditorials(q)  — score-and-render search results
//
// Dependencies (must all be loaded before this file):
//   - pap-i18n.js      → uses `lang` and `_searchTexts` for result labels
// Dependencies that resolve at CALL time (so load order doesn't matter):
//   - pap-app.js       → `edData` (editorial dataset), `creatorData`,
//                        `openEditorial`, `openCreatorPopup`. The search input
//                        listener only fires on user typing, by which time
//                        every script has run.

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

function toggleSearch(){const o=document.getElementById('searchBar');if(!o)return;o.classList.toggle('active');if(o.classList.contains('active')){setTimeout(()=>{var si=document.getElementById('searchInput');if(si)si.focus();},300);}else{var dd=document.getElementById('searchDropdown');if(dd)dd.classList.remove('active');var si=document.getElementById('searchInput');if(si)si.value='';}}

// QA #240 — Global delegation. The previous implementation cached
//   var _si = document.getElementById('searchInput')
// once at module load and bound input/keydown to that one element.
// That fails three ways on sub-pages:
//   1) If the script ran before the search markup was fully parsed,
//      _si was null and no events ever bound.
//   2) Some pages had duplicate #searchInput IDs (/films — fixed
//      in QA #240), so only the first instance got listeners; the
//      visible one silently lost every keystroke and Enter press.
//   3) Any dynamically-injected search bar (overlay re-render, etc.)
//      missed binding entirely.
// Delegating from `document` makes the behavior identical on every
// page and every input that matches the selector, regardless of mount
// timing or duplication.
// QA(2026-07) #28 — 검색 결과를 인라인 리스트가 아니라 별도 검색 결과 페이지로.
//
// 예전 동작:
//   · 입력할 때마다 검색창 아래에 에디토리얼 목록(#searchDropdown)이 인라인으로
//     계속 렌더됐다.
//   · Enter 를 누르면 그 드롭다운의 "첫 번째 결과를 자동 클릭"해 곧바로 상세로
//     튀거나, 결과가 없으면 홈(/?q=)으로 보냈다.
//   → 해시태그 클릭은 /search?tag=… 결과 페이지로 가는데 검색창만 다른 방식이라
//     사용자 경험이 갈렸다.
//
// 새 동작: 검색창은 입력 중 인라인 결과를 렌더하지 않고, 실행(Enter) 시 항상
// /search?q=<검색어> 결과 페이지로 이동한다 → 해시태그 검색과 동일한 결과
// 페이지 레이아웃을 공유한다. (search.html 은 이미 ?tag= 와 ?q= 를 모두 지원)
function _papGoSearch(q){
  q = (q || '').trim();
  if(!q) return;
  window.location.href = '/search?q=' + encodeURIComponent(q);
}
window._papGoSearch = _papGoSearch;

document.addEventListener('input', function(e){
  var t = e.target;
  if(!t || !t.matches || !t.matches('#searchInput, #papSearchInput, .search-bar-input, .search-input')) return;
  // 인라인 결과 렌더 제거 — 열려 있던 드롭다운이 있으면 닫아둔다.
  var dd = document.getElementById('searchDropdown');
  if(dd) dd.classList.remove('active');
});
document.addEventListener('keydown', function(e){
  var t = e.target;
  if(!t || !t.matches || !t.matches('#searchInput, #papSearchInput, .search-bar-input, .search-input')) return;
  if(e.key !== 'Enter') return;
  e.preventDefault();
  _papGoSearch(t.value);
});
// Click delegation for dropdown items. The per-item onclick installed
// in searchEditorials() is still the primary handler, but this
// delegation acts as a safety net for items rendered before
// pap-search.js loaded or injected by other scripts. Reads data-slug
// (added below) for navigation.
document.addEventListener('click', function(e){
  var item = e.target.closest && e.target.closest('.search-dropdown-item');
  if(!item) return;
  if(item.onclick) return; // inline handler already fired
  var slug = item.getAttribute('data-slug');
  if(!slug) return;
  try { toggleSearch(); } catch(_){}
  window.location.href = window._papLangPrefix() + '/editorial/' + slug;
});

function searchEditorials(query){
  // Dropdown search (works on all pages with search-bar)
  var dd=document.getElementById('searchDropdown');
  var ddGrid=document.getElementById('searchDropdownGrid');
  var ddLabel=document.getElementById('searchDropdownLabel');

  // Legacy panel search (magazine page etc.)
  var results=document.getElementById('edSearchResults');
  var grid=document.getElementById('edSearchGrid');
  var label=document.getElementById('edSearchLabel');
  var rows=document.getElementById('edRows')||document.querySelector('.ed-rows-block');
  var crResults=document.getElementById('creatorResults');
  var crCards=document.getElementById('creatorCards');
  var crLabel=document.getElementById('creatorLabel');

  if(!query||query.trim().length<1){
    if(dd)dd.classList.remove('active');
    if(results)results.style.display='none';
    if(crResults)crResults.style.display='none';
    if(rows)rows.style.display='block';
    return;
  }

  var q=query.toLowerCase().trim();
  var scored=[];

  edData.forEach(function(ed){
    var score=0;
    if(ed.title.toLowerCase().indexOf(q)>-1) score+=10;
    if(ed.tags){ed.tags.forEach(function(tag){
      if(tag.indexOf(q)>-1) score+=5;
      if(q.length>2 && tag.indexOf(q.substring(0,3))>-1) score+=2;
    });}
    if(score>0) scored.push({ed:ed,score:score});
  });

  scored.sort(function(a,b){return b.score-a.score;});

  // --- Dropdown rendering (primary) ---
  if(dd&&ddGrid&&ddLabel){
    ddGrid.innerHTML='';
    if(scored.length>0){
      var _st=_searchTexts[lang]||_searchTexts.en;ddLabel.textContent=_st.found(query,scored.length);
      var maxShow=Math.min(scored.length,12);
      for(var i=0;i<maxShow;i++){
        var e=scored[i].ed;
        var item=document.createElement('div');
        item.className='search-dropdown-item';
        // QA #240 — also stash the slug as a data attribute so the
        // document-level click delegation in the global listener can
        // still navigate even if (somehow) the per-item onclick fails
        // to register or gets stripped.
        var _slugAttr = e.slug
          || String(e.title||'').toLowerCase()
               .replace(/['"`]+/g,'').replace(/[^\w\s가-힣-]+/g,'')
               .trim().replace(/\s+/g,'-').replace(/-+/g,'-');
        item.setAttribute('data-slug', _slugAttr);
        // Click handler — universal across home and sub pages.
        // On home (where #edOverlay exists) open the overlay directly.
        // On any other page, QA #166 — link to the clean SSR URL
        // /editorial/<slug>. The slug is on the API record; falls back
        // to a title-slug for static-snapshot entries that pre-date
        // the DB column.
        (function(ed){
          item.onclick=function(){
            try{ toggleSearch(); }catch(_){}
            if(typeof openEditorial==='function' && document.getElementById('edOverlay')){
              openEditorial(ed.title, ed.img);
            } else {
              var _slug = ed.slug
                || String(ed.title||'').toLowerCase()
                     .replace(/['"`]+/g,'').replace(/[^\w\s가-힣-]+/g,'')
                     .trim().replace(/\s+/g,'-').replace(/-+/g,'-');
              window.location.href = window._papLangPrefix() + '/editorial/' + _slug;
            }
          };
        })(e);
        item.innerHTML='<img src="'+e.img+'" alt="'+e.title+'"><div class="search-dropdown-item-info"><div class="search-dropdown-item-cat">EDITORIAL · '+e.date+'</div><div class="search-dropdown-item-title">'+e.title+'</div></div>';
        ddGrid.appendChild(item);
      }
    } else {
      ddLabel.textContent='';
      var _st=_searchTexts[lang]||_searchTexts.en;ddGrid.innerHTML='<div class="search-no-result">'+_st.noResult(query)+'</div>';
    }
    dd.classList.add('active');
  }

  // --- Legacy panel rendering (for pages with edSearchResults) ---
  if(crResults&&crCards&&crLabel&&typeof creatorData!=='undefined'&&creatorData.length>0){
    var cq=q;
    var matchedCreators=creatorData.filter(function(cr){
      return cr.name.toLowerCase().indexOf(cq)>-1 || cr.role.toLowerCase().indexOf(cq)>-1 || cr.instagram.toLowerCase().indexOf(cq)>-1;
    });
    if(matchedCreators.length>0){
      crLabel.textContent='CREATORS · '+matchedCreators.length+' found';
      crCards.innerHTML='';
      matchedCreators.forEach(function(cr){
        var card=document.createElement('div');
        card.className='creator-card';
        card.onclick=function(){openCreatorPopup(cr);};
        card.innerHTML='<div class="creator-card-name">'+cr.name+'</div><div class="creator-card-role">'+cr.role+'</div><div class="creator-card-count">'+cr.editorials.length+' editorial'+(cr.editorials.length>1?'s':'')+'</div>';
        crCards.appendChild(card);
      });
      crResults.style.display='block';
    } else {
      crResults.style.display='none';
    }
  }

  if(results&&grid&&label){
    if(scored.length>0){
      var _st2=_searchTexts[lang]||_searchTexts.en;label.textContent=_st2.found(query,scored.length);
      grid.innerHTML='';
      scored.forEach(function(item){
        var e=item.ed;
        var card=document.createElement('div');
        card.className='ed-row-card';
        card.onclick=function(){openEditorial(e.title,e.img);};
        card.innerHTML='<div class="ed-row-card-img"><img src="'+e.img+'" alt="'+e.title+'"></div><div class="ed-row-card-info"><div class="ed-row-card-cat">EDITORIAL - '+e.date+'</div><div class="ed-row-card-title">'+e.title+'</div></div>';
        grid.appendChild(card);
      });
      results.style.display='block';
      if(rows)rows.style.display='none';
    } else {
      var _st2=_searchTexts[lang]||_searchTexts.en;label.textContent=_st2.noResult(query);
      grid.innerHTML='';
      results.style.display='block';
      if(rows)rows.style.display='none';
    }
  }
}
