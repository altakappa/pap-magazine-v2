// PAP Magazine — Content harness, API sync + lazy loading sub-module
// (extracted from pap-app.js per HARNESS_CHECKLIST.md mission 8e).
//
// Owns:
//   - window._papShortsRender / window._papFilmAutoPlay render-callback hooks
//     (set early so they're available when JSON arrives)
//   - LAZY DATA LOADING IIFE: fetches data/articles.json, data/films.json,
//     data/shorts.json, data/creators.json — populates the corresponding
//     dataset slots and fires render callbacks
//   - SUPABASE API AUTO-SYNC IIFE: hydrates editorials, films, articles from
//     /api/editorials etc. on top of the static JSON, merging by slug, and
//     re-renders home cards + the all-editorials overlay if already built
//   - shortsResizeTimer (window resize → updateShortsPositions)
//
// Public surface:
//   window._papShortsRender / window._papFilmAutoPlay (callbacks)
//   window._papArticleRenderCards (referenced by pap-i18n.js's
//     _loadArticleI18n on language change for translation backfill)
//   window._papReapplyAIThemeLabels (for AI theme row re-translation)
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js                   → escapeHtml, lockScroll/unlockScroll
//   - pap-i18n.js                    → lang
//   - pap-content-editorial.js       → edData, _renderEdAllPage, edAllBuilt,
//                                      openEditorial
//   - pap-content-article.js         → artData
//   - pap-content-film.js            → filmAllData
//   - pap-content-creator-shorts.js  → creatorData, buildShortsCarousel,
//                                      updateShortsPositions
//
// All references resolve at call time (fetch promise → render), by which
// point every script has loaded.

// ======== SUPABASE API AUTO-SYNC + LAZY DATA LOADING ========
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
// 성능 최적화 (2026-07): 정적 JSON 6개(합계 ~6.7MB, 그중
// editorial-details.json 단독 4.5MB)가 첫 페인트와 대역폭을 놓고
// 경쟁하며 홈 로드를 10MB급으로 만들던 문제. 이 데이터는 API 싱크의
// 폴백/보강용이므로 첫 화면에는 필요 없다 → load 이벤트 후 유휴
// 시점으로 지연. 단, 딥링크(/editorial/... 직접 진입 등)는 상세
// 데이터가 곧바로 필요하므로 즉시 로드해 기존 동작을 100% 유지한다.
(function(){
  // QA(2026-07) — 정적 스냅샷이 API 동기화 결과를 덮어쓰는 경합 방지.
  // 정적 JSON 로드와 API 동기화(syncFilms/syncArticles/syncEditorials)가 각각
  // 배열을 비우고 채우는데, 늦게 끝난 쪽이 이겨서 정적 fetch 가 API 뒤에 도착하면
  // 최신 데이터가 오래된 정적 스냅샷으로 '리셋'됐다(특히 필름). 아래 플래그로
  // API 가 이미 채운 컬렉션은 정적 로드가 건드리지 않게 한다(API 가 항상 최신).
  // FIX(2026-07-10): 이 플래그는 아래 sync 함수들(별도 스코프)에서도 쓰이므로
  // IIFE 지역변수가 아닌 전역이어야 한다. var 선언이면 sync 쪽에서 ReferenceError
  // 로 동기화 전체가 죽어 카드가 스켈레톤으로 남는다.
  window._apiSynced = window._apiSynced || {};
  var _apiSynced = window._apiSynced;
  function loadJSON(url, target, renderCb, key){
    fetch(url).then(function(r){ return r.json(); }).then(function(data){
      // 이 fetch 가 도착했을 때 이미 API 가 최신으로 채웠으면 덮어쓰지 않는다.
      // FIX(2026-07-10): 단, 렌더 콜백은 실행한다 — 콜백에는 홈 필름 플레이어
      // 오토플레이(_papFilmAutoPlay) 같은 초기화가 실려 있어, 통째로 return
      // 하면 API 가 이긴 날 메인 필름이 about:blank 로 남는다.
      if(key && _apiSynced[key]){ if(renderCb) renderCb(); return; }
      target.length = 0;
      data.forEach(function(item){ target.push(item); });
      if(renderCb) renderCb();
      /* Loaded items from JSON */
    }).catch(function(e){
      console.warn('[PAP] Could not load ' + url + ', using API sync fallback');
    });
  }

  function startStaticLoads(){
    // Use late-binding wrappers so callbacks are resolved when JSON arrives, not when loadJSON is called
    loadJSON('data/films.json', filmAllData, function(){ if(window._papFilmRenderCards) window._papFilmRenderCards(); if(window._papFilmAutoPlay) window._papFilmAutoPlay(); }, 'films');
    loadJSON('data/articles.json', artData, function(){ if(window._papArticleRenderCards) window._papArticleRenderCards(); }, 'articles');
    loadJSON('data/editorials.json', edData, null, 'editorials');
    loadJSON('data/creators.json', creatorData);
    loadJSON('data/shorts.json', shortsData, function(){ if(window._papShortsRender) window._papShortsRender(); });
  }
  function startDetailsLoad(){
    // For edDetails (object, not array):
    fetch('data/editorial-details.json?v=2').then(function(r){return r.json();}).then(function(data){
      Object.keys(data).forEach(function(k){ edDetails[k]=data[k]; });
      if(window._papEdDetailsReady){ window._papEdDetailsReady(); }
      /* Loaded editorial details */
    }).catch(function(e){ console.warn('[PAP] Could not load editorial details'); });
  }

  // Only load JSON if not running from file:// protocol
  if(window.location.protocol !== 'file:'){
    // 딥링크/해시 진입 = 상세 콘텐츠를 즉시 열어야 함 → 지연 없이 로드
    var deepLink = /^\/(editorial|article|film|short)\//.test(window.location.pathname)
      || /#(editorial|article|film|short)/.test(window.location.hash || '');

    if(deepLink){
      startStaticLoads();
      startDetailsLoad();
    } else {
      var kick = function(){
        // 가벼운 5종(합계 ~2.2MB)은 첫 유휴 시점, 4.5MB 상세맵은 그 뒤에
        setTimeout(startStaticLoads, 800);
        setTimeout(startDetailsLoad, 2000);
      };
      if(document.readyState === 'complete'){ kick(); }
      else { window.addEventListener('load', kick); }
    }
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
      // QA #162 — pass the embedded editorial (when /api/films joined it)
      // through to the overlay renderer so "Related Editorial" can be shown
      // without a second round-trip. Falls back to null when absent.
      rel: f.related_editorial || null,
      // QA #166 — slug for /film/<slug> clean URLs. Mirrors editorial flow.
      slug: f.slug || '',
      _api_id: f.id
    };
  }

  // Convert Supabase article record → hardcoded artData format
  //
  // QA #201 — articles.content was being treated as raw HTML/text in the
  // SPA renderer, but the admin editor (QA #199/#200) actually saves a
  // JSON-encoded block array: [{type:'text', content:'...'}, {type:'image', url:'...', content:'caption'}, ...].
  // When that string hit _renderArticleDetail unparsed, the raw JSON
  // bracket soup was either dumped as HTML (because it has < / > chars
  // in attribute values) or wrapped in a single <p>. Both look broken
  // on the public site. Here we parse once and expose:
  //   - `blocks`: the parsed array when content is valid JSON blocks
  //   - `desc`:   the original string for legacy articles (no blocks)
  // so the renderer can branch cleanly without re-parsing on every paint.
  function apiArticleToLocal(a){
    var rawContent = a.content || '';
    var parsedBlocks = null;
    if(typeof rawContent === 'string' && rawContent.trim().charAt(0) === '['){
      try {
        var maybe = JSON.parse(rawContent);
        if(Array.isArray(maybe)){
          // Coerce each entry to the canonical {type, content, url} shape
          // so the renderer never has to guess. Unknown types become
          // plain text so we never silently swallow content.
          parsedBlocks = maybe.map(function(b){
            if(!b || typeof b !== 'object') return { type:'text', content:String(b||'') };
            var t = b.type || 'text';
            // QA #221 — preserve every field the admin editor wrote.
            // Earlier we only copied content+url, which dropped quote.source
            // and any future block-specific attribute. Spread the original
            // block so unknown fields ride through, then normalise the two
            // well-known string fields.
            var out = Object.assign({}, b);
            out.type = t;
            out.content = typeof b.content === 'string' ? b.content : '';
            out.url = b.url || '';
            return out;
          });
        }
      } catch(_){ parsedBlocks = null; }
    }
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
      // Keep the raw string for legacy articles whose `content` is HTML
      // or plain text; the renderer falls back to this when `blocks` is null.
      desc: parsedBlocks ? '' : rawContent,
      blocks: parsedBlocks,
      gallery: Array.isArray(a.gallery)? a.gallery : [],
      videos: Array.isArray(a.videos)? a.videos : [],
      _api_id: a.id,
      // 참여 증폭 (2026-07) — 원본 IG 게시물 딥링크 (좋아요·저장·보내기 CTA)
      ig: a.source_instagram_url || '',
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
        window._apiSynced.films = true; // 이후 늦게 도착하는 정적 films.json 이 덮어쓰지 못하게
        /* Films synced from API */
      } else {
        /* Using hardcoded films only */
      }
      // Re-render film cards if the page has a renderCards function (/films)
      if(typeof window._papFilmRenderCards==='function'){
        window._papFilmRenderCards();
      }
      // FIX(2026-07-10): 홈 메인 필름 플레이어 시작 — 정적 films.json 경로에만
      // 있던 호출이라 API 동기화가 먼저 끝나면 재생이 시작되지 않았다.
      if(typeof window._papFilmAutoPlay==='function'){
        window._papFilmAutoPlay();
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
        window._apiSynced.articles = true; // 늦게 도착하는 정적 articles.json 이 덮어쓰지 못하게
        /* Articles synced from API */
      } else {
        /* Using hardcoded articles only */
      }
      // Re-render article cards if available (/articles)
      if(typeof window._papArticleRenderCards==='function'){
        window._papArticleRenderCards();
      }
      // QA #226 — also surface newly-published articles on the home-page
      // "최신기사" carousel. The carousel HTML is a long list of static
      // cards (kept around so the page paints instantly with no JS), so
      // the API result is used to PREPEND any rows whose slug isn't
      // already on screen. This lets newly-published news show up at
      // the front without requiring a manual edit to index.html.
      try { _renderHomeFashionArticles(apiArticles); } catch(e){ /* non-fatal */ }
      // QA #238 — refresh scroll-reveal so the freshly prepended fashion
      // cards animate in like the static ones do.
      if(window.papReveal && typeof window.papReveal.refresh === 'function'){
        try { window.papReveal.refresh(); } catch(_){}
      }
    });
  }

  // QA #226 — prepend home-carousel cards for any article whose slug
  // isn't already a static card. We only consider the newest N posts
  // and intentionally avoid touching the existing static markup so the
  // first paint stays as-is (no flash, no reorder). The card markup
  // mirrors the static cards in index.html so the same CSS + click
  // handler (openArticleFromCard) keeps working.
  function _renderHomeFashionArticles(apiArticles){
    var track = document.getElementById('fashionTrack');
    if(!track || !Array.isArray(apiArticles) || !apiArticles.length) return;
    var existingSlugs = {};
    var existingTitles = {};
    var cards = track.querySelectorAll('.fashion-card');
    for(var ci = 0; ci < cards.length; ci++){
      var c = cards[ci];
      var s = c.getAttribute('data-slug');
      if(s) existingSlugs[s] = 1;
      var tEl = c.querySelector('.fashion-card-title');
      if(tEl){
        var tt = String(tEl.textContent || '').trim();
        if(tt) existingTitles[tt] = 1;
      }
    }
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function _fmt(dateStr){
      if(!dateStr) return '';
      var d = new Date(dateStr);
      if(isNaN(d.getTime())) return '';
      var dd = ('0' + d.getDate()).slice(-2);
      return dd + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }
    function _esc(s){
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    // QA #344 — 이전에는 slice(0,8)로 최신 8개만 prepend했는데,
    // 그러면 API에는 있고 정적 HTML에는 없는 "중간 시기" 아티클들이
    // 홈 최신기사 캐로셀에 영원히 노출되지 않는 문제가 있었다.
    // 이제는 전체 API 결과 중 정적 카드에 없는 것을 모두 prepend한다.
    // /api/articles가 published_date DESC로 정렬돼 오므로 순서는 그대로.
    var candidates = apiArticles.filter(function(a){
      if(!a) return false;
      var title = (a.t || '').trim();
      var slug = a.slug || '';
      if(slug && existingSlugs[slug]) return false;
      if(title && existingTitles[title]) return false;
      return !!(title);
    });
    // Reverse so insertBefore(track.firstChild) yields newest-first order.
    // QA #344 — 첫 화면에 노출되는 카드 3장은 loading="eager" + fetchpriority="high"
    // 로 명시해서 lazy-load 지연으로 인한 '뒤늦게 로드' 체감을 줄인다.
    // (candidates가 reverse된 상태이므로 원래 배열 기준 앞 3개 = reverse의 뒤 3개)
    var _n = candidates.length;
    var _eagerCutoff = Math.max(0, _n - 3); // 이 인덱스 이상은 eager
    candidates.reverse().forEach(function(a, idx){
      // reverse 이후 idx가 클수록 원래 배열의 앞쪽(=최신). 상위 3장은 eager.
      var isTop = idx >= _eagerCutoff;
      var loadingAttr = isTop ? 'eager' : 'lazy';
      var priorityAttr = isTop ? ' fetchpriority="high"' : '';
      // SEO — 실제 <a href> 카드로 생성. 크롤러(구글 JS 렌더 포함)가
      // 목록 → 상세(/article/<slug>) 링크 그래프를 따라갈 수 있게 한다.
      // 클릭은 preventDefault 후 기존 SPA 오버레이 그대로.
      var card = document.createElement('a');
      card.className = 'fashion-card';
      var slugAttr = a.slug || '';
      if(slugAttr){
        card.setAttribute('data-slug', slugAttr);
        card.setAttribute('href', '/article/' + encodeURIComponent(slugAttr));
      } else {
        card.setAttribute('href', '#');
      }
      card.setAttribute('onclick', 'event.preventDefault();openArticleFromCard(this)');
      var img = a.th || a.img || '';
      var rawCat = a.cat || '';
      // Match the static-card formatting: "Fashion - 02 Mar 2026". We
      // Title-case the first letter of each comma-separated category
      // (incoming values are stored lowercase since QA #223).
      var catLabel = rawCat.split(',').map(function(p){
        p = p.trim();
        if(!p) return '';
        return p.charAt(0).toUpperCase() + p.slice(1);
      }).filter(Boolean).join(',');
      var dateStr = _fmt(a.d || a.published_date || '');
      var meta = catLabel + (catLabel && dateStr ? ' - ' : '') + dateStr;
      card.innerHTML =
        '<div class="fashion-card-img"><img loading="' + loadingAttr + '" decoding="async"' + priorityAttr + ' src="' + _esc(img) + '" alt="' + _esc(a.t || '') + '"></div>' +
        '<div class="fashion-card-info">' +
          '<div class="fashion-card-cat">' + _esc(meta) + '</div>' +
          '<div class="fashion-card-title">' + _esc(a.t || '') + '</div>' +
        '</div>';
      track.insertBefore(card, track.firstChild);
    });
    // QA #344 — 위 prepend가 끝난 뒤, 정적 HTML의 첫 3장도 eager로 강제 승격.
    // (사용자 최초 뷰포트에 들어가는 카드가 항상 즉시 로드되도록 안전 장치)
    try {
      var _allCards = track.querySelectorAll('.fashion-card img');
      for(var i = 0; i < Math.min(3, _allCards.length); i++){
        _allCards[i].setAttribute('loading', 'eager');
        _allCards[i].setAttribute('fetchpriority', 'high');
        _allCards[i].setAttribute('decoding', 'async');
      }
    } catch(_){}
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
      // QA #166 — slug for clean URL routing (/editorial/<slug>).
      // edDetails consumer reads this when building pushState so the
      // in-app navigation matches the SSR endpoint served on direct hits.
      slug:  slug,
      tags:  Array.isArray(e.tags) ? e.tags : (typeof e.tags==='string' ? e.tags.split(',').map(function(t){return t.trim();}).filter(Boolean) : []),
      // 참여 증폭 2.0 (2026-07) — 원본 IG 게시물 permalink.
      ig:    e.source_instagram_url || '',
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
      // QA #192 — keep KR field for backward compat + ship EN separately
      // so anything downstream that wants language switching can read it.
      description: e.description || '',
      description_en: e.description_en || '',
      // QA #163 — films pointing at this editorial via the
      // related_editorial_id FK. /api/editorials embeds them under
      // related_films; pass through unmodified so the detail overlay
      // can render a "Related Films" card section.
      related_films: Array.isArray(e.related_films) ? e.related_films : [],
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
  //   "4월호"           + 2026 → "VOL.31 ISSUE"
  //   "2026년 4월호"           → "VOL.31 ISSUE"
  //   "MAR. ISSUE"      + 2026 → "VOL.29 ISSUE"
  //   "APR."            + 2026 → "VOL.31 ISSUE"
  //   "APR. 2026 ISSUE"        → "VOL.31 ISSUE"   (re-normalized)
  //   "VOL.31 ISSUE"           → "VOL.31 ISSUE"   (early-return)
  //   "2026-04-15" date         → "VOL.31 ISSUE"
  function _normalizeIssueLabel(raw, dateSource){
    var monthAbbrevs = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var monthFullEn = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    var s = (raw == null) ? '' : String(raw).trim();

    // Already vol-formatted? Keep the editor's exact wording. Matches
    // "VOL.31", "Vol. 30", "VOL 30 ISSUE" etc.
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
      // DB UUID — needed by /api/editorials/:id/view tracking. Static-JSON
      // snapshot entries don't have this; tracker skips them on open.
      id:     apiEd._api_id || existing.id || '',
      // QA #166 — slug for clean URL routing. _openEditorialInner reads
      // this when building the pushState URL (/editorial/<slug>).
      // Static-snapshot entries lack a slug; the consumer falls back to
      // a title-derived slug for those.
      slug:   apiEd.slug || existing.slug || '',
      // 참여 증폭 2.0 — 원본 IG 게시물 permalink (detail 렌더러가 임베드).
      ig:     apiEd.ig || existing.ig || '',
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
      // QA #192 — pass description as an object keyed by language so the
      // detail renderer (pap-content-editorial.js line ~470) can swap
      // between ko/en based on the user's localStorage 'pap-lang'. The
      // renderer ALREADY supports the object form; it just wasn't
      // receiving one — the API mapper used to ship plain Korean only,
      // so non-Korean visitors saw KR text regardless of locale.
      //
      // Fallback chain inside the renderer:
      //   user lang exact match → en → ko → '' (empty)
      // For the 7 locales without a stored translation (it/fr/es/ja/zh/
      // ru/de) the .en value lands them on English copy, which matches
      // the rest of the SPA's "EN as global fallback" pattern.
      desc: (function(){
        var ko = apiEd.description || (existing.desc && existing.desc.ko) || '';
        var en = apiEd.description_en || (existing.desc && existing.desc.en) || '';
        if(!ko && !en){
          // Backward compat — older edDetails entries kept desc as a
          // bare string. Preserve that shape rather than substituting
          // an empty object that the renderer's typeof-check treats
          // as "object" and renders nothing for.
          return existing.desc || '';
        }
        return { ko: ko, en: en };
      })(),
      // QA #163 — films pointing at this editorial. apiFilmToLocal/...
      // doesn't run on these (they come straight from the editorials
      // join), so use the raw column names here.
      relatedFilms: Array.isArray(apiEd.related_films) ? apiEd.related_films : (existing.relatedFilms || [])
    };
    // If API came back with no credits at all but the curated entry had
    // some, keep those so the detail page doesn't go blank on edit.
    if((!apiEd.credits || (Array.isArray(apiEd.credits) && apiEd.credits.length===0))
       && Array.isArray(existing.credits) && existing.credits.length){
      edDetails[key].credits = existing.credits;
    }
  }

  // Populates the right-side thumbnail strip on the community CTA banner
  // (between hero and 최신기사). Pulls trending moodboards from the
  // discovery API; gracefully no-ops when the API is empty (cold-start
  // period before any boards exist), leaving the centered text-only banner
  // intact. Hidden on mobile via CSS so we never fight responsive layout.
  function _renderCommunityCtaThumbs(){
    var holder = document.getElementById('ccaThumbs');
    if(!holder) return; // index.html only — community page doesn't render this
    var apiBase = (window.PAP_CONFIG && window.PAP_CONFIG.API_BASE) || '/api';
    fetch(apiBase + '/community/discovery')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(json){
        if(!json) return;
        // Discovery API can return `trendingMoodboards` (preferred — visual)
        // or `recentScraps`. Use whichever is non-empty; fall back gracefully.
        var pool = (Array.isArray(json.trendingMoodboards) && json.trendingMoodboards.length)
          ? json.trendingMoodboards
          : (Array.isArray(json.recentScraps) ? json.recentScraps : []);
        if(!pool.length) return;
        var html = '';
        for(var i = 0; i < pool.length && i < 4; i++){
          var item = pool[i] || {};
          // Try multiple shape variants — discovery API hasn't been formally
          // contract-locked, so be defensive about field names.
          var img = item.cover_image || item.image_url || item.thumbnail
                 || (Array.isArray(item.images) ? item.images[0] : '')
                 || item.url || '';
          if(!img) continue;
          var safeImg = String(img).replace(/"/g, '&quot;');
          html += '<div class="community-cta-thumb" style="background-image:url(\'' + safeImg + '\')"></div>';
        }
        if(html) holder.innerHTML = html;
      })
      .catch(function(){ /* Banner stays valid without thumbs — never block UX */ });
  }

  // Re-renders the "최신 에디토리얼" row on the home page from edData,
  // sorted by published_date desc (newest first), capped at 12 cards.
  // Called after syncEditorials merges the API response into edData so the
  // home page always reflects what's currently in the database.
  function _renderLatestRow(){
    if(typeof edData === 'undefined' || !Array.isArray(edData)) return;
    var track = document.querySelector('#editorials .ed-row .ed-row-track')
             || document.querySelector('.ed-row-track');
    if(!track) return;

    // Sort by date desc — fall back to 0 for items without a date so they
    // sink to the bottom rather than reordering randomly.
    var sorted = edData.slice().sort(function(a, b){
      var da = a && a.date ? new Date(a.date).getTime() : 0;
      var db = b && b.date ? new Date(b.date).getTime() : 0;
      return (db||0) - (da||0);
    });

    // Take top 12, skip records without a thumbnail (broken renders).
    var top = [];
    for(var i = 0; i < sorted.length && top.length < 12; i++){
      var e = sorted[i];
      if(e && e.img && e.title) top.push(e);
    }

    var html = '';
    for(var j = 0; j < top.length; j++){
      var ed = top[j];
      var safeTitle = String(ed.title||'').replace(/"/g, '&quot;');
      var safeImg   = String(ed.img||'').replace(/"/g, '&quot;');
      var dateLabel = ed.date ? String(ed.date).split('T')[0] : '';
      var catLabel  = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
      var tagsAttr  = Array.isArray(ed.tags) ? ed.tags.join(',') : '';
      // SEO — 실제 <a href="/editorial/<slug>"> 카드 (크롤러 링크 그래프용).
      var latestHref = ed.slug ? '/editorial/' + encodeURIComponent(ed.slug) : '#';
      html +=
        '<a class="ed-row-card" href="' + latestHref + '" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
        'onclick=\'event.preventDefault();openEditorial("' + safeTitle + '","' + safeImg + '")\'>' +
          '<div class="ed-row-card-img">' +
            '<img loading="lazy" src="' + safeImg + '" alt="' + safeTitle + '" ' +
                 'onerror="if(window.edImgError)edImgError(this)">' +
          '</div>' +
          '<div class="ed-row-card-info">' +
            '<div class="ed-row-card-cat">' + catLabel + '</div>' +
            '<div class="ed-row-card-title">' + String(ed.title||'').toUpperCase() + '</div>' +
          '</div>' +
        '</a>';
    }
    track.innerHTML = html;
  }

  // Re-renders the personalised theme rows from /api/editorials/themes.
  // Replaces the previous inline IIFE in index.html that scored hardcoded
  // theme bundles against DOM-card data-tags. Source of truth for theme
  // definitions now lives in api/_lib/themes.js.
  //
  // Containers: split across #aiThemeRows1 (between Film and Shorts) and
  // #aiThemeRows2 (below Shorts). Each gets exactly 2 rows, per the
  // "에디토리얼은 2/2/2 짝지어 노출" home design rule. The /editorials/themes
  // endpoint returns 4 rows total — first 2 land in container #1, the
  // remaining 2 in container #2.
  //
  // Logged-in personalisation: server picks themes from user_preferences;
  // client-side here also reorders cards inside each row "unseen first"
  // using the localStorage `pap-viewed-eds` set populated by
  // _openEditorialInner. Within the seen / unseen halves we keep the
  // server's order (which is published_date desc), so the row stays
  // chronologically coherent.
  function _renderThemeRows(){
    var c1 = document.getElementById('aiThemeRows1');
    var c2 = document.getElementById('aiThemeRows2');
    if(!c1) return;
    var lang = localStorage.getItem('pap-lang') || 'ko';
    var apiBase = (window.PAP_CONFIG && window.PAP_CONFIG.API_BASE) || '/api';
    fetch(apiBase + '/editorials/themes?lang=' + encodeURIComponent(lang) + '&perRow=10', {
      headers: (function(){
        var t = localStorage.getItem('pap-token');
        return t ? { 'Authorization': 'Bearer ' + t } : {};
      })()
    })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(json){
        if(!json || !Array.isArray(json.rows) || json.rows.length === 0) return;

        // Unseen-first reorder. Empty set on first visit = no-op (server
        // order wins, which is published_date desc).
        var seenSet = (function(){
          try {
            var raw = localStorage.getItem('pap-viewed-eds');
            var arr = raw ? JSON.parse(raw) : [];
            var s = {};
            (Array.isArray(arr) ? arr : []).forEach(function(id){ s[id] = 1; });
            return s;
          } catch(_){ return {}; }
        })();
        function unseenFirst(cards){
          var unseen = [], seen = [];
          cards.forEach(function(c){
            if(c && c.id && seenSet[c.id]) seen.push(c); else unseen.push(c);
          });
          return unseen.concat(seen);
        }

        function buildRow(row){
          var ordered = unseenFirst(row.cards || []);
          if(ordered.length === 0) return '';
          var h = '<div class="ed-row"><h3 class="ed-row-label" data-theme-id="' + row.themeId + '">' + (row.label || '') + '</h3>';
          h += '<div class="ed-row-wrap"><button class="ed-row-arrow ed-row-left" onclick="scrollEdRow(this,-1)" aria-label="Scroll left">&#8249;</button><div class="ed-row-track">';
          ordered.forEach(function(ed){
            var safeTitle = String(ed.title || '').replace(/"/g, '&quot;');
            var safeImg   = String(ed.img   || '').replace(/"/g, '&quot;');
            var dateLabel = ed.date ? String(ed.date).split('T')[0] : '';
            var catLabel  = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
            var tagsAttr  = Array.isArray(ed.tags) ? ed.tags.join(',') : '';
            // SEO — 실제 <a href="/editorial/<slug>"> 로 렌더. 크롤러가
            // 홈 → 에디토리얼 상세 링크를 따라갈 수 있게 한다 (클릭은
            // preventDefault 후 기존 SPA 오버레이 유지).
            var edHref = ed.slug
              ? '/editorial/' + encodeURIComponent(ed.slug)
              : '#';
            h += '<a class="ed-row-card" href="' + edHref + '" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
                 'onclick=\'event.preventDefault();openEditorial("' + safeTitle + '","' + safeImg + '")\'>' +
                   '<div class="ed-row-card-img">' +
                     '<img loading="lazy" src="' + safeImg + '" alt="' + safeTitle + '" ' +
                          'onerror="if(window.edImgError)edImgError(this)">' +
                   '</div>' +
                   '<div class="ed-row-card-info">' +
                     '<div class="ed-row-card-cat">' + catLabel + '</div>' +
                     '<div class="ed-row-card-title">' + String(ed.title || '').toUpperCase() + '</div>' +
                   '</div>' +
                 '</a>';
          });
          h += '</div><button class="ed-row-arrow ed-row-right" onclick="scrollEdRow(this,1)" aria-label="Scroll right">&#8250;</button></div></div>';
          return h;
        }

        // Split rows: first 2 → upper container (between Film and Shorts),
        // remaining (typically 2) → lower container (below Shorts). Slicing
        // is defensive — if the API returns fewer than 4 rows the lower
        // container simply renders fewer cards rather than breaking layout.
        var rows = json.rows || [];
        c1.innerHTML = rows.slice(0, 2).map(buildRow).join('');
        if(c2) c2.innerHTML = rows.slice(2, 4).map(buildRow).join('');

        // Re-translate row labels when the language picker changes — same
        // hook the previous inline IIFE used so other modules don't need
        // to know themes moved.
        window._papReapplyAIThemeLabels = function(newLang){
          var curLang = newLang || localStorage.getItem('pap-lang') || 'ko';
          // Refetch with the new lang so labels stay in sync. Cheap (60s
          // edge cache, returns the same theme picks since they're either
          // user-pref-based or day-of-year-based, neither lang-dependent).
          _renderThemeRows();
          // Suppress lint about unused var — caller may pass a lang we
          // already wrote into localStorage before invoking us.
          return curLang;
        };
      })
      .catch(function(){ /* themes are nice-to-have, never block UX */ });
  }

  // Re-renders the "인기 에디토리얼" row from /api/editorials/trending.
  // Uses the same card markup as _renderLatestRow so the visual is identical
  // — only the source of the order differs (view count vs published_date).
  //
  // Cold-start safety: trending API needs view records to return anything
  // useful. If it returns fewer than 6 items we leave the static-HTML cards
  // in place so the row never looks broken in the early days post-launch.
  // Same threshold as a "ed-row scrolls comfortably" floor.
  function _renderTrendingRow(){
    var track = document.getElementById('edTrendingTrack');
    if(!track) return;
    var apiBase = (window.PAP_CONFIG && window.PAP_CONFIG.API_BASE) || '/api';
    fetch(apiBase + '/editorials/trending?period=7d&limit=12')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(json){
        if(!json || !Array.isArray(json.data) || json.data.length < 6) return;
        var html = '';
        json.data.forEach(function(ed){
          // RPC returns the joined editorial fields; mirror the field
          // selection apiEditorialToLocal does for the latest row.
          var thumb = ed.thumbnail || ed.cover_image || '';
          var title = ed.title || '';
          if(!thumb || !title) return;
          var safeTitle = String(title).replace(/"/g, '&quot;');
          var safeImg   = String(thumb).replace(/"/g, '&quot;');
          var dateLabel = ed.published_date ? String(ed.published_date).split('T')[0] : '';
          var catLabel  = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
          var tagsAttr  = Array.isArray(ed.tags) ? ed.tags.join(',') : '';
          // SEO — 실제 <a href="/editorial/<slug>"> 카드 (크롤러 링크 그래프용).
          var trendHref = ed.slug ? '/editorial/' + encodeURIComponent(ed.slug) : '#';
          html +=
            '<a class="ed-row-card" href="' + trendHref + '" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
            'onclick=\'event.preventDefault();openEditorial("' + safeTitle + '","' + safeImg + '")\'>' +
              '<div class="ed-row-card-img">' +
                '<img loading="lazy" src="' + safeImg + '" alt="' + safeTitle + '" ' +
                     'onerror="if(window.edImgError)edImgError(this)">' +
              '</div>' +
              '<div class="ed-row-card-info">' +
                '<div class="ed-row-card-cat">' + catLabel + '</div>' +
                '<div class="ed-row-card-title">' + String(title).toUpperCase() + '</div>' +
              '</div>' +
            '</a>';
        });
        if(html) track.innerHTML = html;
      })
      .catch(function(){ /* trending is a nice-to-have, never block UX */ });
  }

  function syncEditorials(){
    if(typeof edData==='undefined') return;

    // Two-stage sync to fix "newest editorial appears with a delay" UX:
    //
    //   STAGE 1 — fetch only the first 12 (newest) and re-render the home
    //   "최신 에디토리얼" row + trending + theme rows IMMEDIATELY. The
    //   static index.html now ships skeleton cards (no stale 데이터),
    //   so this is the first paint with real data the user sees.
    //
    //   STAGE 2 — paginate the rest in the background to populate edData
    //   for search and the edAllOverlay. Re-render the overlay once it's
    //   already been opened. The home row doesn't need re-rendering after
    //   stage 2 because the top-12 ordering can't change from receiving
    //   older items.
    //
    // Why this matters: previously fetchAll() awaited every page (~2-5
    // round-trips when the catalog grew past 100 items) before rendering
    // anything, so a freshly published editorial took 0.5-2s to appear
    // above the static HTML cards.

    function applyToEdData(items){
      var merged = mergeEditorials(items, edData);
      edData.length = 0;
      merged.forEach(function(e){
        edData.push(e);
        _populateEdDetailsFromApi(e);
      });
      window._apiSynced.editorials = true; // 늦게 도착하는 정적 editorials.json 이 2371로 되돌리지 못하게
    }

    // STAGE 1: fast-path — newest 12 only.
    fetch(PAP_API_BASE + '/editorials?status=published&limit=12&page=1&public=1')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(res){
        if(!res || !Array.isArray(res.data) || res.data.length === 0) return;
        var quick = res.data.map(apiEditorialToLocal);
        applyToEdData(quick);
        _renderLatestRow();
        _renderTrendingRow();
        _renderThemeRows();
        // QA #238 — re-scan the DOM so the freshly inserted cards pick up
        // the global fade-in-up scroll reveal. Without this, dynamic rows
        // bypassed the IntersectionObserver setup (which only ran once at
        // DOMContentLoaded against whatever was already in the markup).
        if(window.papReveal && typeof window.papReveal.refresh === 'function'){
          try { window.papReveal.refresh(); } catch(_){}
        }
      })
      .catch(function(err){ console.warn('[PAP Sync] editorials fast fetch:', err); })
      .finally(function(){
        // STAGE 2: full catalog in the background — populates search + overlay.
        fetchAll('/editorials', apiEditorialToLocal, function(apiEds){
          if(apiEds.length === 0) return;
          applyToEdData(apiEds);
          if(typeof _renderEdAllPage === 'function' && typeof edAllBuilt !== 'undefined' && edAllBuilt){
            try { _renderEdAllPage(); } catch(_){}
          }
          // QA #238 — same refresh hook for the full-catalog second pass.
          if(window.papReveal && typeof window.papReveal.refresh === 'function'){
            try { window.papReveal.refresh(); } catch(_){}
          }
        });
      });
  }

  // QA #186 — staggered fetch strategy. Before this change, all four
  // syncs fired in parallel on DOMContentLoaded, so the homepage was
  // hitting 13+ API endpoints at once. With Vercel serverless cold
  // starts that meant 5-7s waits everywhere. Now:
  //   • syncEditorials (newest 12) is the ONLY critical-path call —
  //     it powers what the user sees above the fold.
  //   • Everything else (films, articles, community discovery) is
  //     deferred to `requestIdleCallback` so it runs after first
  //     paint settles. Below-the-fold sections render skeletons in
  //     the meantime; users on slow connections actually see the
  //     editorial grid up to 2s earlier.
  function _kickDeferredSyncs(){
    var idle = (typeof requestIdleCallback === 'function')
      ? function(cb){ requestIdleCallback(cb, { timeout: 1500 }); }
      : function(cb){ setTimeout(cb, 400); };
    idle(function(){ try { syncFilms(); } catch(e){ console.warn(e); } });
    idle(function(){ try { syncArticles(); } catch(e){ console.warn(e); } });
    idle(function(){ try { _renderCommunityCtaThumbs(); } catch(e){ console.warn(e); } });
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      syncEditorials();
      _kickDeferredSyncs();
    });
  } else {
    // DOM already loaded — small delay to let page scripts initialize first
    setTimeout(function(){
      syncEditorials();
      _kickDeferredSyncs();
    },100);
  }
})();

// ======== SHORTS RESIZE TIMER (sub-shorts) ========
// buildShortsCarousel() is now called via _papShortsRender callback after data loads

var shortsResizeTimer=null;
window.addEventListener('resize',function(){
  clearTimeout(shortsResizeTimer);
  shortsResizeTimer=setTimeout(updateShortsPositions,150);
});

