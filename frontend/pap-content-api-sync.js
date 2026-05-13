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
      // QA #162 — pass the embedded editorial (when /api/films joined it)
      // through to the overlay renderer so "Related Editorial" can be shown
      // without a second round-trip. Falls back to null when absent.
      rel: f.related_editorial || null,
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
      // DB UUID — needed by /api/editorials/:id/view tracking. Static-JSON
      // snapshot entries don't have this; tracker skips them on open.
      id:     apiEd._api_id || existing.id || '',
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
      html +=
        '<div class="ed-row-card" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
        'onclick=\'openEditorial("' + safeTitle + '","' + safeImg + '")\'>' +
          '<div class="ed-row-card-img">' +
            '<img loading="lazy" src="' + safeImg + '" alt="' + safeTitle + '" ' +
                 'onerror="if(window.edImgError)edImgError(this)">' +
          '</div>' +
          '<div class="ed-row-card-info">' +
            '<div class="ed-row-card-cat">' + catLabel + '</div>' +
            '<div class="ed-row-card-title">' + String(ed.title||'').toUpperCase() + '</div>' +
          '</div>' +
        '</div>';
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
            h += '<div class="ed-row-card" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
                 'onclick=\'openEditorial("' + safeTitle + '","' + safeImg + '")\'>' +
                   '<div class="ed-row-card-img">' +
                     '<img loading="lazy" src="' + safeImg + '" alt="' + safeTitle + '" ' +
                          'onerror="if(window.edImgError)edImgError(this)">' +
                   '</div>' +
                   '<div class="ed-row-card-info">' +
                     '<div class="ed-row-card-cat">' + catLabel + '</div>' +
                     '<div class="ed-row-card-title">' + String(ed.title || '').toUpperCase() + '</div>' +
                   '</div>' +
                 '</div>';
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
          html +=
            '<div class="ed-row-card" data-tags="' + tagsAttr + '" data-api-rendered="1" ' +
            'onclick=\'openEditorial("' + safeTitle + '","' + safeImg + '")\'>' +
              '<div class="ed-row-card-img">' +
                '<img loading="lazy" src="' + safeImg + '" alt="' + safeTitle + '" ' +
                     'onerror="if(window.edImgError)edImgError(this)">' +
              '</div>' +
              '<div class="ed-row-card-info">' +
                '<div class="ed-row-card-cat">' + catLabel + '</div>' +
                '<div class="ed-row-card-title">' + String(title).toUpperCase() + '</div>' +
              '</div>' +
            '</div>';
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
    }

    // STAGE 1: fast-path — newest 12 only.
    fetch(PAP_API_BASE + '/editorials?status=published&limit=12&page=1')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(res){
        if(!res || !Array.isArray(res.data) || res.data.length === 0) return;
        var quick = res.data.map(apiEditorialToLocal);
        applyToEdData(quick);
        _renderLatestRow();
        _renderTrendingRow();
        _renderThemeRows();
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
        });
      });
  }

  // Run sync after DOM is ready
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      syncFilms();
      syncArticles();
      syncEditorials();
      _renderCommunityCtaThumbs();
    });
  } else {
    // DOM already loaded — small delay to let page scripts initialize first
    setTimeout(function(){
      syncFilms();
      syncArticles();
      syncEditorials();
      _renderCommunityCtaThumbs();
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

