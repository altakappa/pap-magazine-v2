/**
 * PAP Geo Language Auto-Detection
 * --------------------------------
 * Automatically sets the site language based on visitor's geographic location.
 *
 * Priority:
 *   1. User's manual selection (localStorage.pap-lang) — never overridden
 *   2. IP-based country detection (cached 7 days)
 *   3. Browser language / timezone fallback
 *   4. English (default)
 *
 * Runs early so cookie banner + page content renders in correct language.
 * Include on every page BEFORE cookie-consent.js and pap-app.js.
 */
(function(){
  'use strict';

  var LS_LANG = 'pap-lang';
  var LS_GEO_CACHE = 'pap-geo-country';
  var LS_GEO_TS = 'pap-geo-ts';
  var LS_LANG_SOURCE = 'pap-lang-source'; // 'user' | 'geo' | 'auto'
  var CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  var SUPPORTED = ['ko','en','it','fr','es','ja','zh','ru'];

  // Country → language mapping
  var COUNTRY_LANG = {
    'KR':'ko',
    'JP':'ja',
    'CN':'zh', 'TW':'zh', 'HK':'zh', 'MO':'zh', 'SG':'zh',
    'IT':'it', 'SM':'it', 'VA':'it',
    'FR':'fr', 'BE':'fr', 'LU':'fr', 'MC':'fr', 'CH':'fr',
    'SN':'fr', 'CI':'fr', 'CM':'fr', 'DZ':'fr', 'MA':'fr', 'TN':'fr',
    'ES':'es', 'MX':'es', 'AR':'es', 'CO':'es', 'PE':'es', 'VE':'es',
    'CL':'es', 'EC':'es', 'GT':'es', 'CU':'es', 'BO':'es', 'DO':'es',
    'HN':'es', 'PY':'es', 'SV':'es', 'NI':'es', 'CR':'es', 'PA':'es',
    'UY':'es', 'PR':'es',
    'RU':'ru', 'BY':'ru', 'KZ':'ru', 'KG':'ru'
    // default for US/UK/CA/AU/NZ/IE/DE/NL/others → 'en'
  };

  // --- Storage helpers ---
  function getLang(){ try{ return localStorage.getItem(LS_LANG); }catch(e){ return null; } }
  function setLang(v){ try{ localStorage.setItem(LS_LANG, v); }catch(e){} }
  function getSource(){ try{ return localStorage.getItem(LS_LANG_SOURCE); }catch(e){ return null; } }
  function setSource(v){ try{ localStorage.setItem(LS_LANG_SOURCE, v); }catch(e){} }

  function getCachedCountry(){
    try{
      var ts = parseInt(localStorage.getItem(LS_GEO_TS) || '0', 10);
      if(!ts || Date.now() - ts > CACHE_MS) return null;
      return localStorage.getItem(LS_GEO_CACHE);
    }catch(e){ return null; }
  }
  function setCachedCountry(cc){
    try{
      localStorage.setItem(LS_GEO_CACHE, cc);
      localStorage.setItem(LS_GEO_TS, Date.now().toString());
    }catch(e){}
  }

  // --- Language detection strategies ---
  function browserSyncDetect(){
    var tz = ''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){}
    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if(nav.indexOf('ko') === 0 || tz.indexOf('Seoul') > -1) return 'ko';
    if(nav.indexOf('ja') === 0 || tz.indexOf('Tokyo') > -1) return 'ja';
    if(nav.indexOf('zh') === 0 || tz.indexOf('Shanghai') > -1 || tz.indexOf('Beijing') > -1 || tz.indexOf('Hong_Kong') > -1 || tz.indexOf('Taipei') > -1) return 'zh';
    if(nav.indexOf('it') === 0 || tz.indexOf('Rome') > -1) return 'it';
    if(nav.indexOf('fr') === 0 || tz.indexOf('Paris') > -1) return 'fr';
    if(nav.indexOf('es') === 0 || tz.indexOf('Madrid') > -1 || tz.indexOf('Mexico') > -1) return 'es';
    if(nav.indexOf('ru') === 0 || tz.indexOf('Moscow') > -1 || tz.indexOf('Petersburg') > -1) return 'ru';
    return 'en';
  }

  function countryToLang(cc){
    if(!cc) return null;
    return COUNTRY_LANG[cc.toUpperCase()] || 'en';
  }

  function applyLang(lang, source){
    if(!lang || SUPPORTED.indexOf(lang) < 0) return;
    var prev = getLang();
    if(prev === lang){ setSource(source); return; }
    setLang(lang);
    setSource(source);
    // If page has its own setLang(), call it to re-render
    if(typeof window.setLang === 'function' && window.setLang !== applyLang){
      try{ window.setLang(lang); }catch(e){}
    }
    // Update <select id="langSelect"> if present
    var sel = document.getElementById && document.getElementById('langSelect');
    if(sel && sel.value !== lang){
      try{ sel.value = lang; }catch(e){}
    }
    document.dispatchEvent(new CustomEvent('pap-lang-changed', {detail: {lang: lang, source: source}}));
  }

  // --- IP geolocation fetch (cached) ---
  function fetchCountry(){
    var cached = getCachedCountry();
    if(cached) return Promise.resolve(cached);

    // Use ipapi.co — HTTPS, CORS-enabled, 1000 req/day free, no API key
    var controller = null;
    if(typeof AbortController !== 'undefined'){
      controller = new AbortController();
      setTimeout(function(){ try{ controller.abort(); }catch(e){} }, 3500);
    }

    return fetch('https://ipapi.co/json/', controller ? {signal: controller.signal} : {})
      .then(function(r){
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data){
        var cc = data && data.country_code;
        if(cc){ setCachedCountry(cc); return cc; }
        return null;
      })
      .catch(function(err){
        // Silent fail — fall back to browser detection
        if(err && err.name !== 'AbortError'){
          console.info('[PAPGeoLang] IP geo skipped:', err.message || err);
        }
        return null;
      });
  }

  // --- Main detection flow ---
  function detectAndApply(){
    var existing = getLang();
    var source = getSource();

    // User explicitly chose a language? Don't override.
    if(existing && source === 'user'){
      return Promise.resolve(existing);
    }

    // Instant fallback: browser/timezone detection
    var syncLang = browserSyncDetect();
    if(!existing){
      applyLang(syncLang, 'auto');
    }

    // Refine with IP-based detection
    return fetchCountry().then(function(cc){
      if(!cc) return getLang();
      var geoLang = countryToLang(cc);
      if(geoLang && geoLang !== getLang()){
        applyLang(geoLang, 'geo');
      }
      return geoLang;
    });
  }

  // --- Public API ---
  window.papGeoLang = {
    detect: detectAndApply,
    countryToLang: countryToLang,
    // Call when user manually picks a language from UI
    setUserLanguage: function(lang){ applyLang(lang, 'user'); },
    // Reset stored detection (for testing)
    reset: function(){
      try{
        localStorage.removeItem(LS_LANG);
        localStorage.removeItem(LS_LANG_SOURCE);
        localStorage.removeItem(LS_GEO_CACHE);
        localStorage.removeItem(LS_GEO_TS);
      }catch(e){}
    }
  };

  // Auto-run
  detectAndApply();

  // Intercept manual language selector changes: mark as 'user' source
  document.addEventListener('DOMContentLoaded', function(){
    var sel = document.getElementById('langSelect');
    if(sel){
      sel.addEventListener('change', function(){
        setSource('user');
      }, true); // capture: true so we run before the inline onchange
    }
  });
})();
