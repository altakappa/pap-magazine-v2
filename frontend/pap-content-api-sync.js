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

// 2026-08-05 — 에디토리얼 카드 링크 언어 접두어 헬퍼 (다인, 3차 라운드).
// 문제: 아래 카드 생성기들이 항상 '/editorial/<slug>' (한국어 정본) 을 써서,
// /en·/ja 페이지에서 SSR 이 올바르게 심어 둔 <a href="/en/editorial/..."> 를
// 클라이언트 렌더가 덮어썼다. 크롤러가 JS 실행 후 보는 내부 링크 그래프가
// 통째로 한국어로 되돌아간다(2026-08-05 라이브 확인).
// 제약: 무조건 접두어를 붙이면 안 된다 — api/seo/editorial/[slug].js 는
// 번역이 없는 항목에 대해 302(→/en) 를 내므로 "리디렉션이 포함된 페이지"가
// 다시 늘어난다. 그래서 /api/editorials/untranslated?lang=xx 로 '번역 없는
// 예외 목록'만 받아 제외한다(실측 최대 16편 — 응답 수십 바이트).
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
if (!window._papEdHref) {
  // null = 아직 미도착. 미도착일 땐 접두어를 붙이지 않는다(안전측 = 기존 동작).
  window.__papEdMissing = window.__papEdMissing || null;

  window._papEdHref = function(slugOrId){
    var base = '/editorial/' + encodeURIComponent(slugOrId);
    var p = window._papLangPrefix ? window._papLangPrefix() : '';
    if (!p) return base;                 // 한국어 정본
    if (p === '/en') return p + base;    // en 은 DB 원본 필드 — 항상 존재, 302 없음
    var miss = window.__papEdMissing;
    if (!miss) return base;
    return miss.has(String(slugOrId)) ? base : p + base;
  };

  // 예외 목록이 늦게 도착하면 이미 그려진 카드의 href 를 올려준다.
  // 대상은 우리가 심은 data-paped 앵커로 한정 — 다른 링크는 건드리지 않는다.
  window._papEdUpgradeHrefs = function(){
    try{
      var list = document.querySelectorAll('a[data-paped]');
      for (var i = 0; i < list.length; i++){
        var s = list[i].getAttribute('data-paped');
        if (s) list[i].setAttribute('href', window._papEdHref(s));
      }
    }catch(_){}
  };

  (function _papEdLoadMissing(){
    var p = window._papLangPrefix ? window._papLangPrefix() : '';
    if (!p || p === '/en') return;       // ko·en 은 조회 자체가 불필요
    if (window.__papEdMissingLoading) return;
    window.__papEdMissingLoading = true;
    try{
      fetch('/api/editorials/untranslated?lang=' + encodeURIComponent(p.slice(1)))
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){
          if (!j) return;
          var keys = [];
          (j.slugs || []).forEach(function(s){ keys.push(String(s)); });
          (j.ids   || []).forEach(function(s){ keys.push(String(s)); });
          window.__papEdMissing = new Set(keys);
          window._papEdUpgradeHrefs();
        })
        .catch(function(){ /* 실패 시 미도착 상태 유지 = 기존 동작 */ });
    }catch(_){}
  })();
}

window._papShortsRender = function(){ buildShortsCarousel(); };

// 홈 메인 플레이어에 넣을 videoId 로 iframe 을 세팅한다(자동재생·무음·루프).
function _papSetHomeVideo(vid){
  if(!vid) return false;
  var fp = document.getElementById('filmMainPlayer');
  if(!fp || !(fp.src === 'about:blank' || fp.src === '')) return false;
  // 개선요청 2026-07-16 — playsinline=1. iOS/모바일 사파리·크롬은 인라인 재생
  // 허용이 없으면 muted 여도 자동재생을 차단한다(전체화면 강제 전환 방지 정책).
  fp.src = 'https://www.youtube.com/embed/' + vid + '?rel=0&autoplay=1&mute=1&loop=1&playsinline=1&playlist=' + vid;
  return true;
}

// Auto-play in main player when film data loads (muted for autoplay policy)
//
// 2026-07-21 도메니코 요청 — "유튜브에서 홈 영상을 바꿀 때마다 그 영상이
// 홈페이지 영상으로 대체되게." 유튜브 채널 대표 영상(트레일러)을 /api/home-video
// 로 조회해 그걸 우선 튼다. 값이 없거나 조회 실패면 기존대로 최신 필름을 튼다.
// 폴백이 있어 유튜브 쪽 문제로 홈이 비지 않는다.
window._papFilmAutoPlay = function(){
  var fp = document.getElementById('filmMainPlayer');
  if(!fp || !(fp.src === 'about:blank' || fp.src === '')) return;
  var apiBase = (window.PAP_API_BASE || '/api').replace(/\/$/, '');
  fetch(apiBase + '/home-video')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      var vid = j && j.videoId;
      if(vid && _papSetHomeVideo(vid)) return;         // 대표 영상 우선
      if(filmAllData.length > 0) _papSetHomeVideo(filmAllData[0].yt); // 폴백: 최신 필름
    })
    .catch(function(){
      // 네트워크 실패 — 기존 동작(최신 필름)으로 폴백
      if(filmAllData.length > 0) _papSetHomeVideo(filmAllData[0].yt);
    });
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
    // 2026-07-12 — 정적 스냅샷(articles.json)이 stale해지는 문제 해소: DB에서 항상
    // 최신을 주는 스냅샷 API(엣지 캐시)를 우선 사용, 실패 시 정적 파일로 폴백.
    (function(){
      var _artRender = function(){ if(window._papArticleRenderCards) window._papArticleRenderCards(); };
      fetch((window.PAP_API_BASE || '/api') + '/articles-snapshot')
        .then(function(r){ if(!r.ok) throw new Error('snap'); return r.json(); })
        .then(function(data){
          if(!Array.isArray(data) || !data.length) throw new Error('empty');
          if(_apiSynced.articles){ _artRender(); return; } // API가 이미 최신이면 덮어쓰지 않음
          artData.length = 0; data.forEach(function(i){ artData.push(i); });
          _artRender();
        })
        .catch(function(){
          // 스냅샷 API 실패 → 기존 정적 파일 폴백(현행과 동일 동작)
          loadJSON('data/articles.json', artData, _artRender, 'articles');
        });
    })();
    // 2026-07-22 QA(/editorial 1분 지연) — 기존 loadJSON(renderCb=null) 은 두 가지 문제:
    //  (a) 시드(2371건)가 도착해도 목록 오버레이를 재렌더하지 않음
    //  (b) API STAGE 1(최신 12건)이 _apiSynced 플래그를 먼저 세우면 시드가 통째로 버려져,
    //      전체 동기화가 끝날 때까지 edData 가 12건뿐 → /editorial 이 빈 화면으로 대기.
    // 시드를 'API 아래에' 제목 중복 제거로 병합하고, 오버레이가 열려 있으면 즉시 그린다.
    // (STAGE 2 전체 동기화가 끝나면 어차피 authoritative 데이터로 재정리된다.)
    fetch('data/editorials.json').then(function(r){ return r.json(); }).then(function(data){
      if(!Array.isArray(data) || !data.length) return;
      if(_apiSynced.editorials){
        var seen = {};
        edData.forEach(function(e){ var k=(e.title||'').trim().toLowerCase(); if(k) seen[k]=true; });
        data.forEach(function(e){ var k=(e.title||'').trim().toLowerCase(); if(k && !seen[k]){ seen[k]=true; edData.push(e); } });
      } else {
        edData.length = 0;
        data.forEach(function(e){ edData.push(e); });
      }
      if(typeof _renderEdAllPage === 'function' && typeof edAllBuilt !== 'undefined' && edAllBuilt){
        try { _renderEdAllPage(); } catch(_){}
      }
    }).catch(function(){ console.warn('[PAP] Could not load data/editorials.json, using API sync fallback'); });
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
      // 2026-08-08 — SSR 에만 있던 FAQ·MORE ARTICLES 를 SPA 로 (화면 두 벌 통일).
      // 목록 응답에는 faq 가 없으므로 undefined 로 남고, 상세 GET 이 채운다
      // (undefined = 아직 안 물어봄, null = 물어봤는데 없음 — 재요청 방지 구분).
      faq: (a.faq === undefined ? undefined : (Array.isArray(a.faq) ? a.faq : null)),
      _more: a.more_articles || undefined,
      // Pass through any i18n fields the API exposes (varies by backend schema)
      //
      // QA(2026-07) #30 — 다국어 전환 시 제목 번역 미적용.
      // 프론트는 ti18n(다국어 맵)만 소비하는데 articles 테이블엔 title_i18n 컬럼이
      // 없고 title_en(영문 단일)만 있다. 게다가 title_en 은 API select 에서도
      // 빠져 있어(지금 추가) 프론트까지 오지도 않았다 → 언어를 바꿔도 대부분의
      // 기사 제목이 한국어로 고정됐다(IG 연동 기사만 정적 JSON 의 ti18n 덕에 번역됨).
      // 이제 title_en 을 ti18n.en 으로 실어 일관된 폴백을 만든다:
      //   한국어 → 원문 제목,  그 외 언어 → 영문 제목(있으면), 없으면 원문.
      // (렌더 폴백: ko → ti18n.ko||원문||en, 그 외 → ti18n[lang]||en||원문 — 2026-07-22 교정)
      ti18n: a.title_i18n || a.titleI18n || a.ti18n
             || (a.title_en && String(a.title_en).trim() ? { en: String(a.title_en).trim() } : null),
      subi18n: a.subtitle_i18n || a.subtitleI18n || a.subi18n || null,
      desci18n: a.content_i18n || a.contentI18n || a.desci18n || (a.content_en && String(a.content_en).trim() ? { en: String(a.content_en).trim() } : null)
    };
  }

  // Merge: API items first, then hardcoded (deduplicated by slug/title).
  // If local JSON has ti18n/subi18n for an API-matched article, enrich the API item
  // with those translations so the UI can render non-Korean titles.
  // authoritative=true 는 "apiItems 가 공개 기사 전량"이라는 뜻이다.
  // 이때 API 에 없는 시드 항목은 목록에서 뺀다 — 자세한 이유는 아래 마지막 블록 참고.
  function mergeData(apiItems, localItems, authoritative){
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
    // ── QA 2026-07-21 "아티클 상세 공백 페이지" 근본 원인 ──────────────────
    // 여기서 "API 가 안 돌려준 시드 항목"을 목록에 그대로 밀어넣고 있었다.
    // 그런데 API 가 안 돌려주는 이유는 대개 "그 기사가 공개 상태가 아니다"이다.
    // 결과: 카드는 시드에서 생기고(제목·카테고리·날짜·해시태그 있음),
    // 상세는 DB 를 보는데 공개 본문이 없어 대표이미지·본문만 빈 페이지가 됐다.
    // 실측(2026-07-21): 시드 61건 중 20건이 이 상태 — draft 19 + 본문 없는 published 1.
    //
    // 시드 파일(pap-article-db.json)은 "번역 사전"이지 콘텐츠 소스가 아니다.
    // 위쪽 ti18n 보강은 그대로 두고, 목록 주입만 막는다.
    //
    // 단 authoritative=false(최신 12건만 받은 fast path)에서는 시드를 빼면 안 된다.
    // 그 순간엔 API 결과가 전량이 아니라서, 빼면 목록이 12건으로 쪼그라든다.
    // 전량을 받은 syncArticles 가 authoritative=true 로 정리한다.
    if(!authoritative || !merged.length){
      localItems.forEach(function(item){
        var key=(item.t||'').trim().toLowerCase();
        if(key && !seen[key]){
          seen[key]=true;
          merged.push(item);
        }
      });
    }
    return merged;
  }

  // Fetch all pages of a collection.
  //
  // 2026-08-22 순차 → 병렬. 예전엔 1쪽을 받고 그 응답을 본 뒤에야 2쪽을 요청하는
  // 재귀였다. 실측(홈 · warm cache · 데스크톱): /articles 26쪽 + /editorials 24쪽
  // 을 하나씩 받느라 716ms → 4030ms, 3.3초가 통째로 날아갔다. 왕복이 느린
  // 모바일 필드에서는 이 구간이 LCP 6.0초의 본체다.
  //
  // 이제 1쪽으로 총 쪽수를 안 뒤 나머지를 동시 6개씩 받는다. 요청 "횟수"는
  // 그대로라 Vercel 함수 호출 비용은 동일하고, 대기 시간만 왕복 N번 → N/6번으로
  // 줄어든다. 동시 6개 상한은 이미지·폰트 대역폭을 다 빼앗지 않도록 일부러 둔 것.
  var FETCH_ALL_CONCURRENCY = 6;
  function fetchAll(endpoint, converter, callback){
    var limit = 100;
    function pageUrl(p){
      return PAP_API_BASE + endpoint + '?status=published&limit=' + limit + '&page=' + p;
    }
    function flatten(buckets){
      var all = [];
      for (var i = 0; i < buckets.length; i++){
        var b = buckets[i];
        if (!b) continue;
        for (var j = 0; j < b.length; j++) all.push(converter(b[j]));
      }
      return all;
    }
    fetch(pageUrl(1))
      .then(function(r){ return r.json(); })
      .then(function(res){
        var first = (res && res.data) || [];
        if (!first.length){ callback([]); return; }
        var pages = (res.pagination && res.pagination.pages) || 1;
        var buckets = new Array(pages);
        buckets[0] = first;
        if (pages <= 1){ callback(flatten(buckets)); return; }

        var next = 2;      // 다음에 요청할 쪽
        var running = 0;   // 진행 중인 요청 수
        var settled = 0;   // 끝난 요청 수 (2쪽부터 셀다)
        var doneCalled = false;
        function finish(){
          if (doneCalled) return;
          doneCalled = true;
          callback(flatten(buckets));
        }
        function pump(){
          while (running < FETCH_ALL_CONCURRENCY && next <= pages){
            var p = next;
            next++;
            running++;
            (function(pageNo){
              fetch(pageUrl(pageNo))
                .then(function(r){ return r.json(); })
                .then(function(res2){ buckets[pageNo - 1] = (res2 && res2.data) || []; })
                .catch(function(err){
                  // 한 쪽이 실패해도 나머지는 살린다 (순차판은 거기서 멈췄다)
                  console.warn('[PAP Sync] page fetch error:', endpoint, pageNo, err);
                  buckets[pageNo - 1] = [];
                })
                .then(function(){
                  running--;
                  settled++;
                  if (settled >= pages - 1) finish();
                  else pump();
                });
            })(p);
          }
        }
        pump();
      })
      .catch(function(err){
        console.warn('[PAP Sync] Fetch error:', endpoint, err);
        callback([]);
      });
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

  // FAST PATH (2026-07-11): 홈 '최신기사' 갱신 지연 해소.
  // 기존엔 정적 4월 스냅샷이 먼저 깔리고, syncArticles가 유휴 시점에
  // 전체(451편·5페이지)를 다 받은 뒤에야 새 기사를 앞에 붙여서 갭이 컸다.
  // 여기서 최신 12편만 즉시 받아 홈 캐러셀에 프리펜드 → 새 기사가 바로 뜬다.
  // 전체 동기화(검색·전체목록용)는 기존대로 백그라운드에서 이어진다.
  function syncArticlesFast(){
    if(typeof artData==='undefined') return;
    fetch(PAP_API_BASE + '/articles?status=published&limit=12&page=1')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(res){
        if(!res || !Array.isArray(res.data) || !res.data.length) return;
        var quick = res.data.map(apiArticleToLocal);
        // 2026-07-12 — 목록 페이지(/articles)도 최신이 즉시 뜨도록 quick을 artData에
        // 병합 후 재렌더. 기존엔 홈 캐러셀만 갱신하고 artData 미병합이라, 목록은 전체
        // syncArticles(수 페이지, ~10초)가 끝나야 최신이 떠 '최근 기사 안 뜸'으로 보였다.
        // mergeData는 제목 기준 dedup이라 이후 전체 동기화와 충돌 없음.
        try {
          var _merged = mergeData(quick, artData);
          artData.length = 0;
          _merged.forEach(function(a){ artData.push(a); });
          window._apiSynced.articles = true; // 늦게 도착하는 정적 스냅샷이 덮어쓰지 못하게
        } catch(e){ /* non-fatal */ }
        try { _renderHomeFashionArticles(quick); } catch(e){ /* non-fatal */ }
        if(typeof window._papArticleRenderCards==='function'){
          try { window._papArticleRenderCards(); } catch(_){}
        }
        if(window.papReveal && typeof window.papReveal.refresh === 'function'){
          try { window.papReveal.refresh(); } catch(_){}
        }
      })
      .catch(function(){ /* 실패 시 전체 syncArticles가 백업 */ });
  }

  // Sync articles
  function syncArticles(){
    if(typeof artData==='undefined') return;
    fetchAll('/articles',apiArticleToLocal,function(apiArticles){
      if(apiArticles.length>0){
        var origLen=artData.length;
        // 전량 동기화이므로 authoritative — API 에 없는 시드는 여기서 정리된다
        var merged=mergeData(apiArticles, artData, true);
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
    // 버그수정 2026-07-16 — "홈 최신기사가 옛 기사에서 멈춤" (이중 prepend 순서 버그).
    // 이 함수는 syncArticlesFast(최신 12)와 syncArticles(전체)가 각각 호출하는데,
    // 기존엔 이미 화면에 있는 카드(JS 생성분 포함)를 전부 dedup 으로 건너뛰고
    // 나머지만 맨 앞에 prepend 했다. 그래서 fast 가 먼저 붙인 "진짜 최신 12장" 위로
    // 뒤늦은 전체 동기화가 그보다 오래된 중간 시기 기사를 얹어, 최신 기사가
    // 캐러셀 400번대 위치로 밀렸다(실측: 첫 카드가 07-14 안티뱅크시).
    // 수정: JS 생성 카드에 data-dyn 마킹을 하고, dedup(건너뛰기)은 정적 HTML 카드에만
    // 적용한다. 기존 dyn 카드는 candidates 에 다시 포함시키되 DOM 요소를 재사용해
    // (insertBefore 는 이동) 항상 apiArticles(published_date DESC) 순서로 재정렬한다.
    // 정적 마크업은 기존처럼 건드리지 않는다(첫 페인트 무변화).
    var existingSlugs = {};
    var existingTitles = {};
    var dynBySlug = {};
    var dynByTitle = {};
    var cards = track.querySelectorAll('.fashion-card');
    for(var ci = 0; ci < cards.length; ci++){
      var c = cards[ci];
      var isDyn = c.getAttribute('data-dyn') === '1';
      var s = c.getAttribute('data-slug');
      var tEl = c.querySelector('.fashion-card-title');
      var tt = tEl ? String(tEl.textContent || '').trim() : '';
      if(isDyn){
        if(s) dynBySlug[s] = c;
        if(tt) dynByTitle[tt] = c;
      } else {
        if(s) existingSlugs[s] = 1;
        if(tt) existingTitles[tt] = 1;
      }
    }
    // 2026-07-21 QA(표기 재발) — 자체 월 이름표/_fmt 제거.
    // 발행일 표기는 pap-utils.js 의 papFmtMeta 하나만 쓴다.
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
      // 버그수정 2026-07-16 — 이미 JS 로 생성돼 화면에 있는 dyn 카드는 새로 만들지
      // 않고 기존 요소를 맨 앞으로 이동(insertBefore 는 move)시켜 재정렬만 한다.
      // 이미지 재로드 없이 순서가 항상 apiArticles(최신순)를 따르게 된다.
      var _title = (a.t || '').trim();
      var existingDyn = (a.slug && dynBySlug[a.slug]) || (_title && dynByTitle[_title]) || null;
      if(existingDyn){
        track.insertBefore(existingDyn, track.firstChild);
        return;
      }
      // SEO — 실제 <a href> 카드로 생성. 크롤러(구글 JS 렌더 포함)가
      // 목록 → 상세(/article/<slug>) 링크 그래프를 따라갈 수 있게 한다.
      // 클릭은 preventDefault 후 기존 SPA 오버레이 그대로.
      var card = document.createElement('a');
      card.className = 'fashion-card';
      card.setAttribute('data-dyn', '1');
      var slugAttr = a.slug || '';
      if(slugAttr){
        card.setAttribute('data-slug', slugAttr);
        card.setAttribute('href', '/article/' + encodeURIComponent(slugAttr));
      } else {
        card.setAttribute('href', '#');
      }
      card.setAttribute('onclick', 'event.preventDefault();openArticleFromCard(this)');
      var img = a.th || a.img || '';
      // 2026-07-20 QA 표기통일 — 공통 papFmtMeta(pap-utils)로 단일화.
      // (기존 로컬 Title-case + _fmt 조합과 동일 결과지만, 이제 전 페이지가
      //  한 함수를 공유해 표기가 갈릴 여지를 없앤다.)
      // 2026-07-21 QA(표기 재발) — 폴백을 없앴다. 폴백은 Title-case 를 안 해서
      // 조용히 다른 표기를 만들었고, 그게 이 QA 가 반복된 방식이다.
      // pap-utils.js 는 이 파일보다 먼저 로드된다(전 페이지 defer 순서 확인).
      // 만에 하나 없으면 눈에 띄게 실패하는 편이 조용히 갈리는 것보다 낫다.
      var meta = papFmtMeta(a.cat || '', a.d || a.published_date || '');
      // 2026-07-26 — 카드 제목을 현재 언어로. ko/en 을 data 속성에 실어
      // setLang→_applyArticleCardI18n 이 정적 JSON 없이도 즉시 전환하게 한다.
      var _lt = (typeof _papLocTitle==='function' && a.ti18n) ? (_papLocTitle(a)||a.t||'') : (a.t||'');
      var _enT = (a.ti18n && a.ti18n.en) ? a.ti18n.en : '';
      if(a.t) card.setAttribute('data-title-ko', a.t);
      if(_enT) card.setAttribute('data-title-en', _enT);
      card.innerHTML =
        '<div class="fashion-card-img"><img loading="' + loadingAttr + '" decoding="async"' + priorityAttr + ' src="' + _esc(img) + '" alt="' + _esc(_lt) + '"></div>' +
        '<div class="fashion-card-info">' +
          '<div class="fashion-card-cat">' + _esc(meta) + '</div>' +
          '<div class="fashion-card-title">' + _esc(_lt) + '</div>' +
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
      // 2026-08-21 — 열람 게이트. 공개 목록은 이미지 세트를 싣지 않고
      // '몇 장인지 / 어느 등급이 필요한지'만 준다. 광고를 띄울지 말지를
      // 여기서 판단해야 '광고 보고 → 잠금화면' 이라는 최악의 동선을 피한다.
      requiredTier: e.required_tier || '',
      galleryCount: Number(e.gallery_count || 0),
      // QA #192 — keep KR field for backward compat + ship EN separately
      // so anything downstream that wants language switching can read it.
      description: e.description || '',
      description_en: e.description_en || '',
      // QA #163 — films pointing at this editorial via the
      // related_editorial_id FK. /api/editorials embeds them under
      // related_films; pass through unmodified so the detail overlay
      // can render a "Related Films" card section.
      related_films: Array.isArray(e.related_films) ? e.related_films : [],
      // 2026-07-28 — 관리자가 인스타 편집 모달에서 조정한 로고/프레이밍 설정.
      // 회원 다운로드(_papDownloadLogoZip)가 관리자 ZIP 과 같은 결과를 내려면
      // 이 값이 상세 화면까지 흘러야 한다. 없으면 null → 기존 기본값 합성.
      insta_logo_settings: (e.insta_logo_settings && typeof e.insta_logo_settings === 'object')
        ? e.insta_logo_settings : null,
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
      // 2026-07-28 — 인스타 합성 로고/프레이밍 설정(관리자 저장값).
      // 회원 다운로드 버튼이 data-logosettings 로 실어 보낸다.
      instaLogoSettings: apiEd.insta_logo_settings || existing.instaLogoSettings || null,
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
      requiredTier: apiEd.requiredTier || existing.requiredTier || '',
      galleryCount: Number(apiEd.galleryCount || existing.galleryCount || 0),
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
      // 2026-07-22 QA 날짜 표기통일 — 홈 카드도 공통 papFmtDate(DD Mon YYYY) 사용
      var dateLabel = ed.date ? (window.papFmtDate ? papFmtDate(ed.date) : String(ed.date).split('T')[0]) : '';
      var catLabel  = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
      var tagsAttr  = Array.isArray(ed.tags) ? ed.tags.join(',') : '';
      // SEO — 실제 <a href="/editorial/<slug>"> 카드 (크롤러 링크 그래프용).
      var latestHref = ed.slug ? window._papEdHref(ed.slug) : '#';
      var latestPed  = String(ed.slug || '').replace(/"/g, '&quot;');
      html +=
        '<a class="ed-row-card" href="' + latestHref + '" data-paped="' + latestPed + '" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
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
            // 2026-07-22 QA 날짜 표기통일 — 공통 papFmtDate
            var dateLabel = ed.date ? (window.papFmtDate ? papFmtDate(ed.date) : String(ed.date).split('T')[0]) : '';
            var catLabel  = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
            var tagsAttr  = Array.isArray(ed.tags) ? ed.tags.join(',') : '';
            // SEO — 실제 <a href="/editorial/<slug>"> 로 렌더. 크롤러가
            // 홈 → 에디토리얼 상세 링크를 따라갈 수 있게 한다 (클릭은
            // preventDefault 후 기존 SPA 오버레이 유지).
            var edHref = ed.slug ? window._papEdHref(ed.slug) : '#';
            var edPed  = String(ed.slug || '').replace(/"/g, '&quot;');
            h += '<a class="ed-row-card" href="' + edHref + '" data-paped="' + edPed + '" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
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
          // 2026-07-22 QA 날짜 표기통일 — 공통 papFmtDate
          var dateLabel = ed.published_date ? (window.papFmtDate ? papFmtDate(ed.published_date) : String(ed.published_date).split('T')[0]) : '';
          var catLabel  = 'EDITORIAL' + (dateLabel ? (' - ' + dateLabel) : '');
          var tagsAttr  = Array.isArray(ed.tags) ? ed.tags.join(',') : '';
          // SEO — 실제 <a href="/editorial/<slug>"> 카드 (크롤러 링크 그래프용).
          var trendHref = ed.slug ? window._papEdHref(ed.slug) : '#';
          var trendPed  = String(ed.slug || '').replace(/"/g, '&quot;');
          html +=
            '<a class="ed-row-card" href="' + trendHref + '" data-paped="' + trendPed + '" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
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

  // 2026-07-22 QA(히어로 배너 공백) — slug 로 에디토리얼 1건을 서버에서 직접 가져와
  // 로컬 카탈로그(edData/edDetails)에 주입하는 훅. 딥링크(?ed=)·배너 클릭이 클라이언트
  // 카탈로그에 아직 없는 항목(최신12 밖 + 정적 시드 밖)을 만나면 이걸로 복구한다.
  window._papFetchEditorialBySlug = function(slug, cb){
    cb = (typeof cb === 'function') ? cb : function(){};
    if(!slug){ cb(null); return; }
    fetch(PAP_API_BASE + '/editorials/' + encodeURIComponent(String(slug).toLowerCase()))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var row = j && (j.data || j.editorial || (j.id ? j : null));
        if(!row || !row.id){ cb(null); return; }
        var local = apiEditorialToLocal(row);
        var exists = false;
        try{ exists = edData.some(function(e){ return e && (e._api_id === row.id || (e.title||'') === (local.title||'')); }); }catch(_){}
        if(!exists){ try{ edData.push(local); }catch(_){} }
        try{ _populateEdDetailsFromApi(local); }catch(_){}
        cb(local);
      })
      .catch(function(){ cb(null); });
  };

  // 2026-08-08 — 기사 딥링크(?art=) 안전핀. SSR 브릿지가 &artid=<uuid> 를 실어
  // 보내므로, 전량 목록 동기화(451편·수 초)가 아직 안 끝났어도 단건 GET 으로
  // 즉시 열 수 있다. 이미 목록에 있으면 그 인덱스를, 없으면 push 한 인덱스를
  // 돌려준다. 실패는 -1 — 호출부(pap-content-seo.js)가 폴링으로 폴백한다.
  window._papFetchArticleById = function(id, cb){
    cb = (typeof cb === 'function') ? cb : function(){};
    if(!id || typeof artData === 'undefined'){ cb(-1); return; }
    fetch(PAP_API_BASE + '/articles/' + encodeURIComponent(id))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var row = j && j.data;
        if(!row || !row.id){ cb(-1); return; }
        for(var i = 0; i < artData.length; i++){
          if(artData[i] && artData[i]._api_id === row.id){ cb(i); return; }
        }
        var local = apiArticleToLocal(row);
        artData.push(local);
        cb(artData.length - 1);
      })
      .catch(function(){ cb(-1); });
  };

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
        // 2026-07-22 QA(/editorial 1분 지연) — 목록 오버레이가 이미 열려 있으면
        // STAGE 2(전체 카탈로그, 수십 초)를 기다리지 말고 최신 12건으로 먼저 그린다.
        // 기존엔 STAGE 2 완료時에만 재렌더해, /editorial 진입 시 빈 화면이 length
        // 동기화 내내 유지됐다(실측: 카드 0개가 20초+).
        if(typeof _renderEdAllPage === 'function' && typeof edAllBuilt !== 'undefined' && edAllBuilt){
          try { _renderEdAllPage(); } catch(_){}
        }
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
        // 2026-08-22 — 예전엔 여기서 곧바로 시작해 첫 화면이 그려지는 동안
        // 24쪽을 받았다. 이제 _queueFullSync 에 넣어 load 이후 유휴에 돈다.
        _queueFullSync(function(){
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
  //
  // 2026-08-22 — 그 "유휴"가 충분히 늦지 않았다. requestIdleCallback 의
  // timeout:1500 은 DOMContentLoaded(≈350ms) 기준이라 실제로는 700ms 쯤,
  // 즉 첫 화면이 그려지는 도중에 터졌다. 그때부터 3.3초 동안 51번의 목록
  // 요청이 돌아 화면에 보이지도 않는 5,000건을 받아 파싱했다 — LCP·INP 를
  // 그만큼 밀어냈고, DOM 은 19,557 노드까지 불었다.
  //
  // 이제 전체 카탈로그(articles·films·editorials STAGE 2)는:
  //   • load 이벤트 이후 + 유휴(최대 3초 대기)에만 시작하고,
  //   • 사용자가 검색을 먼저 열면 타이머를 기다리지 않고 즉시 시작한다.
  // 화면에 보이는 최신 12건(STAGE 1 · syncArticlesFast)은 종전 그대로 즉시.
  var _fullQueue = [];
  var _fullFired = false;
  function _queueFullSync(fn){
    if(_fullFired){ try { fn(); } catch(e){ console.warn('[PAP Sync] full:', e); } return; }
    _fullQueue.push(fn);
  }
  function _flushFullSyncs(){
    if(_fullFired) return;
    _fullFired = true;
    var q = _fullQueue;
    _fullQueue = [];
    q.forEach(function(fn){ try { fn(); } catch(e){ console.warn('[PAP Sync] full:', e); } });
  }
  // 검색·전체목록이 완전한 카탈로그를 필요로 할 때 직접 부를 수 있는 문.
  window.papEnsureFullCatalog = _flushFullSyncs;

  // 홈인가? — 홈은 화면에 최신 12건만 보인다. 목록·상세 화면은 전체 카탈로그가
  // 곧 화면 그 자체라서 미루면 안 된다. 그래서 미루기는 홈에서만 한다.
  function _isHomePath(){
    try {
      var p = String(location.pathname || '/').replace(/\/+$/, '');
      p = p.replace(/^\/(ko|ja|en|fr|it|es|de|ru|zh)(?=\/|$)/, '');
      return p === '' || p === '/index.html';
    } catch(_){ return false; }
  }

  function _scheduleFullSyncs(){
    var idleSoon = (typeof requestIdleCallback === 'function')
      ? function(cb){ requestIdleCallback(cb, { timeout: 1500 }); }
      : function(cb){ setTimeout(cb, 400); };

    if(!_isHomePath()){
      idleSoon(_flushFullSyncs);   // 목록·상세는 종전 그대로
      return;
    }

    // 홈 — load 이후 유휴까지 미룬다.
    var go = function(){
      if(typeof requestIdleCallback === 'function'){
        requestIdleCallback(_flushFullSyncs, { timeout: 3000 });
      } else {
        setTimeout(_flushFullSyncs, 1200);
      }
    };
    if(document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });

    // 사용자가 먼저 움직이면(검색창 열기·카드 클릭) 타이머를 기다리지 않는다.
    var _origToggleSearch = window.toggleSearch;
    if(typeof _origToggleSearch === 'function'){
      window.toggleSearch = function(){
        try { _flushFullSyncs(); } catch(_){}
        return _origToggleSearch.apply(this, arguments);
      };
    }
    try {
      document.addEventListener('pointerdown', function(){
        try { _flushFullSyncs(); } catch(_){}
      }, { once: true, passive: true, capture: true });
    } catch(_){}
  }

  function _kickDeferredSyncs(){
    _queueFullSync(function(){ syncFilms(); });
    _queueFullSync(function(){ syncArticles(); });
    // 커뮤니티 CTA 썸네일은 요청 1건짜리 화면 요소 — 종전대로 유휴에 바로.
    var idle = (typeof requestIdleCallback === 'function')
      ? function(cb){ requestIdleCallback(cb, { timeout: 1500 }); }
      : function(cb){ setTimeout(cb, 400); };
    idle(function(){ try { _renderCommunityCtaThumbs(); } catch(e){ console.warn(e); } });
    _scheduleFullSyncs();
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      syncEditorials();
      syncArticlesFast();   // 홈 최신기사 즉시 갱신 (전체 목록은 아래 유휴 동기화)
      _kickDeferredSyncs();
    });
  } else {
    // DOM already loaded — small delay to let page scripts initialize first
    setTimeout(function(){
      syncEditorials();
      syncArticlesFast();   // 홈 최신기사 즉시 갱신 (전체 목록은 아래 유휴 동기화)
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

