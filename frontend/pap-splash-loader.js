/**
 * PAP Magazine — Splash Loader (QA #310)
 *
 * 첫 방문 시 짧게(1.5초 정도) 스플래시 이미지를 오버레이로 노출.
 * /api/loading-images 에서 활성 이미지 목록을 가져와 랜덤으로 1장 선택.
 *
 * 규칙:
 * - sessionStorage 로 세션 내 재노출 방지 (탭 새로고침에는 안 뜸)
 * - prefers-reduced-motion 사용자에게는 페이드 없이 즉시 사라짐
 * - 뷰포트가 768px 이하면 image_url_mobile 우선, 없으면 PC 이미지 fallback
 * - API 실패해도 스플래시 없이 정상 렌더 (silent fail)
 * - 스플래시가 렌더되지 않아도 페이지 자체는 항상 정상 노출됨
 *
 * DOM: <div id="pap-splash-loader">
 *        <img id="pap-splash-img" ...>
 *        <img id="pap-splash-logo" src="pap-symbol-white.png">
 *      </div>
 */
(function(){
  'use strict';

  var STORAGE_KEY   = 'papSplashShown';
  var MIN_DISPLAY_MS = 900;    // 이미지 로드 후 최소 노출 시간 (깜빡임 방지)
  var MAX_DISPLAY_MS = 1800;   // 사용자 대기 상한
  var FADE_MS        = 400;

  // 세션 내에서 이미 봤으면 skip
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') return;
  } catch(_){ /* private mode 등 — 그냥 진행 */ }

  var reduced = false;
  try {
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch(_){}

  // splash 오버레이가 이미 HTML 에 있으면 재사용, 없으면 생성.
  var splash = document.getElementById('pap-splash-loader');
  if (!splash){
    splash = document.createElement('div');
    splash.id = 'pap-splash-loader';
    splash.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'background:#000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'opacity:1',
      'transition:opacity ' + FADE_MS + 'ms ease',
      'pointer-events:auto'
    ].join(';');
    var img = document.createElement('img');
    img.id = 'pap-splash-img';
    img.alt = '';
    img.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'object-fit:cover',
      'opacity:0.85'
    ].join(';');
    splash.appendChild(img);
    var logo = document.createElement('img');
    logo.id = 'pap-splash-logo';
    logo.src = '/pap-symbol-white.png';
    logo.alt = 'PAP';
    logo.style.cssText = [
      'position:relative',
      'width:120px',
      'height:auto',
      'z-index:2',
      'filter:drop-shadow(0 4px 24px rgba(0,0,0,.4))'
    ].join(';');
    splash.appendChild(logo);
    // 문서 시작에 삽입. body 가 아직 없으면 DOMContentLoaded 대기.
    if (document.body){
      document.body.appendChild(splash);
    } else {
      document.addEventListener('DOMContentLoaded', function(){
        document.body.appendChild(splash);
      }, { once: true });
    }
  }

  // 사용자가 스플래시를 클릭하면 즉시 dismiss
  splash.addEventListener('click', function(){ hide(); });

  var shown  = false;
  var hidden = false;
  var shownAt = 0;
  var safetyTimer = 0;

  function pickUrl(item){
    if (!item) return null;
    var isMobile = false;
    try { isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches; } catch(_){}
    if (isMobile && item.image_url_mobile) return item.image_url_mobile;
    return item.image_url_pc || item.image_url_mobile || null;
  }

  function hide(){
    if (hidden) return;
    hidden = true;
    try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch(_){}
    if (safetyTimer){ clearTimeout(safetyTimer); safetyTimer = 0; }
    // reduced motion: 페이드 없이 즉시 제거
    if (reduced){
      splash.style.transition = 'none';
      splash.style.display = 'none';
      if (splash.parentNode) splash.parentNode.removeChild(splash);
      return;
    }
    splash.style.opacity = '0';
    setTimeout(function(){
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, FADE_MS);
  }

  function showWithItem(item){
    var url = pickUrl(item);
    if (!url){ hide(); return; }
    var imgEl = document.getElementById('pap-splash-img');
    if (imgEl){
      // alt_text 없으면 빈 alt (decorative)
      imgEl.alt = item.alt_text || '';
      imgEl.onload = function(){
        shown = true;
        shownAt = Date.now();
        // MIN_DISPLAY_MS 만큼 유지 후 자동 dismiss
        setTimeout(hide, MIN_DISPLAY_MS);
      };
      imgEl.onerror = function(){
        // 이미지 로드 실패 → 즉시 dismiss
        hide();
      };
      imgEl.src = url;
    }
    // 안전 상한 — 어떤 사유든 MAX_DISPLAY_MS 넘으면 강제 dismiss
    safetyTimer = setTimeout(hide, MAX_DISPLAY_MS);
  }

  // API 조회 — 실패해도 조용히 숨김.
  var apiBase = (window.PAP_API_BASE || '/api').replace(/\/$/, '');
  fetch(apiBase + '/loading-images', { credentials: 'omit' })
    .then(function(r){ if (!r.ok) throw new Error('bad status ' + r.status); return r.json(); })
    .then(function(json){
      var list = (json && json.data) || [];
      if (!list.length){ hide(); return; }
      // 랜덤 1장 선택
      var pick = list[Math.floor(Math.random() * list.length)];
      showWithItem(pick);
    })
    .catch(function(err){
      if (typeof console !== 'undefined') console.warn('[splash] fetch failed:', err && err.message);
      hide();
    });

  // 페이지가 완전히 로드된 뒤에도 스플래시가 남아있으면
  // (fetch 지연 등), 사용자 경험을 위해 hide 재촉.
  window.addEventListener('load', function(){
    if (!hidden){
      // 이미 이미지가 보이는 중이면 MIN_DISPLAY_MS 존중, 아니면 즉시 hide.
      if (shown){
        var elapsed = Date.now() - shownAt;
        var wait = Math.max(0, MIN_DISPLAY_MS - elapsed);
        setTimeout(hide, wait);
      } else {
        hide();
      }
    }
  });
})();
