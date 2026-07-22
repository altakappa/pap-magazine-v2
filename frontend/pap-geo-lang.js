/**
 * PAP Geo Language Auto-Detection
 * --------------------------------
 * Automatically sets the site language based on visitor's geographic location.
 *
 * Priority:
 *   1. User's manual selection — never overridden. 저장된 pap-lang 에 출처(source)
 *      기록이 없으면(레거시·직접 setLang) 그것도 사용자 선택으로 간주해 보호한다.
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

  var SUPPORTED = ['ko','en','it','fr','es','ja','zh','ru','de'];

  // Country → language mapping
  var COUNTRY_LANG = {
    'KR':'ko',
    'JP':'ja',
    'CN':'zh', 'TW':'zh', 'HK':'zh', 'MO':'zh', 'SG':'zh',
    'IT':'it', 'SM':'it', 'VA':'it',
    'FR':'fr', 'BE':'fr', 'LU':'fr', 'MC':'fr',
    'SN':'fr', 'CI':'fr', 'CM':'fr', 'DZ':'fr', 'MA':'fr', 'TN':'fr',
    'ES':'es', 'MX':'es', 'AR':'es', 'CO':'es', 'PE':'es', 'VE':'es',
    'CL':'es', 'EC':'es', 'GT':'es', 'CU':'es', 'BO':'es', 'DO':'es',
    'HN':'es', 'PY':'es', 'SV':'es', 'NI':'es', 'CR':'es', 'PA':'es',
    'UY':'es', 'PR':'es',
    'RU':'ru', 'BY':'ru', 'KZ':'ru', 'KG':'ru',
    'DE':'de', 'AT':'de', 'CH':'de', 'LI':'de'
    // default for US/UK/CA/AU/NZ/IE/NL/others → 'en'
    // Note: CH (Switzerland) defaults to 'de' (largest linguistic group);
    // French/Italian Swiss users can manually switch.
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
    if(nav.indexOf('de') === 0 || tz.indexOf('Berlin') > -1 || tz.indexOf('Vienna') > -1 || tz.indexOf('Zurich') > -1) return 'de';
    return 'en';
  }

  function countryToLang(cc){
    if(!cc) return null;
    return COUNTRY_LANG[cc.toUpperCase()] || 'en';
  }

  var _applying = false; // applyLang 내부에서 window.setLang 호출 중임을 표시 (외부 수동호출과 구분)
  function applyLang(lang, source){
    if(!lang || SUPPORTED.indexOf(lang) < 0) return;
    var prev = getLang();
    // 2026-07-22 QA — 'user' 소스는 자동 감지가 절대 강등하지 못한다.
    if(prev === lang){ if(source === 'user' || getSource() !== 'user') setSource(source); return; }
    setLang(lang);
    setSource(source);
    // If page has its own setLang(), call it to re-render
    if(typeof window.setLang === 'function' && window.setLang !== applyLang){
      _applying = true;
      try{ window.setLang(lang); }catch(e){}
      _applying = false;
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
    // 2026-07-22 QA (아티클 제목 영문 표기) — 저장된 언어가 있는데 출처 기록이 없으면
    // 이 스크립트 도입 전(레거시) 또는 다른 경로(setLang 직접 호출)로 사용자가 고른
    // 값이다. 자동 감지가 이를 덮으면 안 되므로 사용자 선택으로 승격·보호한다.
    // (기존엔 source 가 'user' 딱 하나일 때만 보호돼, 'auto'/'geo'/null 상태의 ko 가
    //  IP 미매핑 국가(VPN·프록시·해외망)에서 'en' 으로 덮였다 — 라이브 재현 확인.)
    if(existing && !source){
      setSource('user');
      return Promise.resolve(existing);
    }

    // Instant fallback: browser/timezone detection
    var syncLang = browserSyncDetect();
    var autoSetNow = false; // 이번 로드에서 '방금' 자동 추측을 넣었는가
    if(!existing){
      applyLang(syncLang, 'auto');
      autoSetNow = true;
    }

    // Refine with IP-based detection.
    // 2026-07-22 QA — IP 보정은 '이번 로드에서 방금 넣은 자동 추측'만 고칠 수 있다.
    // (첫 방문: 브라우저 추측 → 수 초 뒤 IP 로 정정 = 정상 UX)
    // 지난 방문에서 저장된 값은 출처가 'auto' 였어도 사용자가 그 언어로 써 온 것이므로
    // 절대 덮지 않는다 — VPN·프록시·해외망에서 ko 가 en 으로 뒤집히던 원인.
    return fetchCountry().then(function(cc){
      if(!cc) return getLang();
      var geoLang = countryToLang(cc);
      if(autoSetNow && geoLang && geoLang !== getLang()){
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

  // Intercept manual language selector changes: mark as 'user' source.
  // 2026-07-22 QA — 기존 방식(DOMContentLoaded 에 #langSelect 를 한 번 찾아 리스너 부착)은
  // 헤더가 주입/재구성되며 셀렉터 노드가 교체되면 리스너가 사라져 'user' 표시가 누락됐다.
  // 문서 레벨 위임(캡처)으로 바꿔 노드 교체와 무관하게 항상 잡는다.
  document.addEventListener('change', function(e){
    var t = e.target;
    if(t && (t.id === 'langSelect' || (t.matches && t.matches('select[id*="lang" i], select[class*="lang" i]')))){
      setSource('user');
    }
  }, true);
  // 보강: 어떤 UI 경로든 전역 setLang(pap-i18n.js) 이 직접 불리면 — 이 스크립트 내부
  // 호출(_applying)이 아닌 한 — 사용자 의사로 간주해 'user' 로 기록한다.
  document.addEventListener('DOMContentLoaded', function(){
    var orig = window.setLang;
    if(typeof orig === 'function' && !orig._papGeoWrapped){
      var wrapped = function(l){ if(!_applying) setSource('user'); return orig.apply(this, arguments); };
      wrapped._papGeoWrapped = true;
      window.setLang = wrapped;
    }
  });
})();
