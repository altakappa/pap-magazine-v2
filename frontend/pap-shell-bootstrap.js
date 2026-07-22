// PAP Magazine — Shell bootstrap module (final extraction from pap-app.js
// per HARNESS_CHECKLIST.md mission 11). pap-app.js is now an empty stub —
// every previously-resident block now lives in a focused module.
//
// This file owns the cross-cutting glue that doesn't fit any single content
// or feature harness:
//   - Beta config + isBetaActive() flag (referenced by pap-subscription.js)
//   - Page loader animation (LOADER IIFE + load handler + safety unlock timer)
//   - Hero slider auto-rotation
//   - getLangText helper (single-key inline message lookup, used by Content)
//   - ESC / Backspace global hotkey — cross-overlay close dispatcher
//   - NAV (toggleNav, closeNav) — hamburger + overlay + scroll lock
//   - FASHION CAROUSEL (moveCarousel) for the home fashion-section
//   - ED CAROUSEL (moveEdCarousel, ePos)
//   - SCROLL REVEAL (.sr → .v intersection-fade)
//   - scrollEdRow (editorial-row left/right buttons)
//   - Carousel arrows initialization IIFE — wires fashion / ed-row / nf-track
//   - popstate router — restores editorial / creator / film / article / all-X
//     overlays on browser back/forward
//   - Auto language detection IIFE — applies pap-lang from localStorage
//
// Public surface (consumed cross-script via globals):
//   isBetaActive()                  pap-subscription.js, inline static HTMLs
//   getLangText(key, fallback)       Content open/close helpers
//   toggleNav() / closeNav()         inline onclick= in every page header
//   moveCarousel(d) / moveEdCarousel(d) / scrollEdRow(btn,dir)
//                                    inline onclick= on home carousels
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js                → lockScroll/unlockScroll, _papWireCarousel,
//                                   _papUpdateArrows, _papSmoothScrollBy
//   - pap-i18n.js                 → setLang, lang
//   - pap-auth.js                 → isLoggedIn (referenced indirectly via
//                                   pap-subscription.js)
//   - pap-subscription.js         → showPremiumInterstitial, isStandardOrAbove
//                                   (interstitial gates + image-protect)
//   - pap-content-* modules       → openEditorial, closeEditorial,
//                                   _openCreatorPopup_noPush, getCreatorDB,
//                                   closeFilmDetail, closeArticleDetail,
//                                   closeAllX (referenced by ESC handler +
//                                   popstate router at click time)
//
// All cross-module references resolve at click / popstate time, by which
// point every script has loaded.

// ======== BETA MODE CONFIG ========
// 베타 기간 중에는 "로그인한 회원(무료/스탠다드/프리미엄 모두 포함)"에게만 전체 콘텐츠 오픈
// 비로그인 방문자는 유료 서비스에 접근 불가 (로그인 유도)
// 베타 종료 후에는 구독 등급(free/standard/premium)에 따라 접근 차등 적용
// 날짜 형식: 'YYYY-MM-DD' (예: '2026-12-31') 또는 null (베타 무기한)
var PAP_BETA_END = '2026-07-09';   // ← 베타 종료 완료 — 2026-07-10 정식 오픈, 구독 등급별 접근 적용

function isBetaActive(){
  if(!PAP_BETA_END) return true; // null이면 무기한 베타
  var now = new Date();
  var end = new Date(PAP_BETA_END + 'T23:59:59');
  return now <= end;
}

// Modal scroll lock (lockScroll/unlockScroll, _scrollLockCount, _savedScrollY)
// this file — the safety timer below references _scrollLockCount as a global.
//
// i18n (T dict, lang, setLang, _applyArticleCardI18n, _loadArticleI18n) extracted to
// modal / pagination code below reads `lang` and `T` as bare globals.

// ======== LOADER ========
(function(){
  var bg=document.getElementById('loaderBg');
  if(bg){
    var slides=document.querySelectorAll('.hero-slide-img');
    if(slides.length){
      // 성능 최적화: 슬라이드 2~4 는 data-defer-src 로 지연되므로 src 가
      // 빈 경우 defer 속성에서 읽는다 (랜덤 선택 동작은 그대로 유지).
      var el=slides[Math.floor(Math.random()*slides.length)];
      var src=el.getAttribute('src')||el.getAttribute('data-defer-src')||'';
      if(src){
        var img=new Image();
        img.onload=function(){bg.style.backgroundImage='url('+src+')';bg.classList.add('loaded');};
        img.src=src;
      }
    }
  }
})();
window.addEventListener('load',()=>{var _l=document.getElementById('loader');if(_l)setTimeout(()=>_l.classList.add('hidden'),800);});
setTimeout(()=>{var _l=document.getElementById('loader');if(_l)_l.classList.add('hidden');},3000);

// Safety: force unlock scroll if body is stuck after page load
setTimeout(function(){
  var bs=document.body.style;
  if(bs.overflow==='hidden' && bs.position==='fixed'){
    var noOverlay=!document.getElementById('premiumInterstitial')&&!document.querySelector('.signupPopup.active,.access-gate-overlay');
    if(noOverlay){ _scrollLockCount=0; unlockScroll(); console.warn('Scroll was stuck — force unlocked'); }
  }
},4000);

// ======== HERO SLIDER ========
// QA #242 tuning — was setInterval(..., 3000). 3 seconds is below the
// typical "comfortable read" threshold for an image-led hero, so
// consecutive slides blurred together and the cover-story text had no
// chance to register. Bumped to 10s per slide — within the 7–15s range
// most editorial publications use for cover carousels.
//
// While here, added the manual-control + accessibility hooks the QA
// ticket asked to "consider":
//   • Hover / touch pauses autoplay (cursor on the banner = the user is
//     actively looking; don't yank the slide away mid-glance).
//   • Tab visibility pauses autoplay (no point cycling slides nobody can
//     see; also avoids the jarring "skipped 5 slides while I was away"
//     effect when returning to the tab).
//   • prefers-reduced-motion stops autoplay entirely (users who opted
//     into reduced motion should not get a self-changing hero).
//   • setTimeout-loop instead of setInterval so pause/resume is exact
//     and we never queue overlapping ticks across visibility flips.
let hCur = 0;
let hSlides = document.querySelectorAll('.hero-slide');  // QA #295 — let, replaced after fetch.
// QA #319 — 10000 → 5000. QA 권장 전환 시간 3~5초의 상한 채택.
// (QA #242 에서 3s → 10s 로 늘렸으나, 운영 QA 에서 배너별 체감 전환
// 시간이 들쭉날쭉하다는 리포트와 함께 3~5초 통일 요청.)
const HERO_INTERVAL_MS = 5000;
let _heroTimer = null;
let _heroPaused = false;
// QA #319 — tick 루프 세대 토큰. 관찰된 증상 (배너별 전환 간격이
// 10s / 2~3s / 5s 로 제각각) 은 주기 10s 의 tick 루프 여러 개가
// 오프셋을 두고 동시에 도는 패턴과 일치한다. _heroTimer 참조가
// 어떤 경로로든 어긋나 clearTimeout 을 놓치면 이전 루프가 살아남아
// 겹치는데, 세대 토큰 불일치 시 자멸하게 만들어 이 계열의 버그를
// 구조적으로 차단한다 (start/stop 마다 세대 증가 → 이전 세대의
// 예약된 tick 은 실행 즉시 return).
let _heroLoopToken = 0;
// QA #295 — DB 에서 받아온 그룹/슬라이드 메타데이터. 각 슬라이드의 link
// 를 알아야 클릭 시 올바른 editorial 로 이동.
//   _heroSlideMeta[i] = { link: '/editorial/foo', issue: '...', title: '...' }
let _heroSlideMeta = [];

function heroGo(n){
  if(!hSlides.length) return;
  hSlides[hCur].classList.remove('active');
  hCur = (n + hSlides.length) % hSlides.length;
  hSlides[hCur].classList.add('active');
  // QA #303 — 슬라이드 전환 시 hero-content (발행호/제목) 도 그 슬라이드
  // 가 속한 그룹의 값으로 함께 업데이트. 이전에는 index.html 에 하드코딩
  // 된 정적 텍스트가 그대로 남아 admin 저장 데이터와 노출 데이터가
  // 어긋나는 결함이 있었음.
  _heroUpdateContentText(hCur);
}

function _heroUpdateContentText(idx){
  var meta = _heroSlideMeta[idx];
  if(!meta) return;
  var issueEl = document.querySelector('.hero-content .hero-issue');
  var titleEl = document.querySelector('.hero-content .hero-title');
  if(issueEl && meta.issue){
    // 정적 HTML 은 data-i18n 다국어 훅을 갖고 있어서 setLang 훅이 다시
    // 덮어쓸 수 있으므로 마킹 해제.
    issueEl.removeAttribute('data-i18n');
    issueEl.textContent = meta.issue;
  }
  if(titleEl && meta.title){
    titleEl.removeAttribute('data-i18n');
    titleEl.textContent = meta.title;
  }
}
function _heroTick(token){
  // QA #319 — stale 루프 자멸 가드. 새 start/stop 이후에 발화한
  // 이전 세대의 tick 은 아무것도 하지 않는다.
  if(token !== _heroLoopToken){ return; }
  if(_heroPaused){ _heroTimer = null; return; }
  heroGo(hCur + 1);
  _heroTimer = setTimeout(function(){ _heroTick(token); }, HERO_INTERVAL_MS);
}
function _heroStart(){
  if(_heroTimer || _heroPaused) return;
  var token = ++_heroLoopToken; // 새 세대 시작 — 이전 세대 전부 무효화
  _heroTimer = setTimeout(function(){ _heroTick(token); }, HERO_INTERVAL_MS);
}
function _heroStop(){
  _heroLoopToken++; // 진행 중인 모든 루프 무효화 (clearTimeout 누락 대비)
  if(_heroTimer){ clearTimeout(_heroTimer); _heroTimer = null; }
}
function _heroPause(){ _heroPaused = true; _heroStop(); }
function _heroResume(){ _heroPaused = false; _heroStart(); }

// QA #295 — 슬라이드 클릭 → 그룹 링크로 이동 라우팅.
// QA #304 — 좌우 화살표 + 재생/일시정지 버튼 제거. 매거진 톤에 UI 요소가
// 과했다는 운영자 피드백. 자동 슬라이드 / hover-pause / visibilitychange /
// reduced-motion 자동 제어는 그대로 유지 ─ 사용자 인터랙션은 콘텐츠 클릭
// 만으로 축소해 시각적 잡음을 줄임.
//
// 이전 QA #297 에서 넣었던 컨트롤 (prev / next / play 버튼) 은 완전 제거.
// CSS 의 .hero-nav* 스타일도 함께 삭제. 링크 라우팅만 남음.
function _heroInstallControls(){
  var heroEl = document.getElementById('hero');
  if(!heroEl) return;
  if(heroEl._papClickBound) return; // 중복 바인딩 방지
  heroEl._papClickBound = true;

  // 정적 fallback HTML 에 박혀 있는 inline onclick ('Folie' 하드코딩) 제거.
  // 동적 렌더 후에는 아래 위임 핸들러로 그 슬라이드의 그룹 링크로 이동.
  heroEl.removeAttribute('onclick');
  heroEl.addEventListener('click', function(e){
    var meta = _heroSlideMeta[hCur];
    if(!(meta && meta.link)) return;
    var url = String(meta.link);
    try {
      // QA #318 — 배너 클릭 시 URL 만 바뀌고 상세가 안 열리던 결함 fix.
      // 기존 구현은 history.pushState({}, '', url) 후 state 없는
      // PopStateEvent 를 수동 발송했는데, 아래 popstate 라우터는 전적으로
      // e.state 플래그 (st.editorial / st.film / st.article / …) 로만
      // 분기한다. 수동 이벤트는 e.state=null 이라 catch-all("열려 있는
      // 오버레이 닫기") 로 떨어져 아무것도 열리지 않았다.
      // 수정: /editorial/<slug> 링크는 slug → edData 행을 찾아
      // openEditorial(title) 을 직접 호출 (openEditorial 이 오버레이
      // 렌더 + pushState 를 모두 처리). 매칭 실패·그 외 경로는 풀
      // 네비게이션 — /editorial/:slug, /film/:slug 는 Vercel rewrite 의
      // SSR 페이지가 받으므로 어느 쪽이든 상세에 도달한다.
      if(url.indexOf('http') === 0){
        window.location.href = url;
        return;
      }
      var m = url.match(/^\/editorial\/([^\/?#]+)/);
      if(m && typeof openEditorial === 'function'){
        var slug = m[1];
        try { slug = decodeURIComponent(slug); } catch(_){}
        var slugLc = slug.toLowerCase();
        var row = null;
        if(typeof edData !== 'undefined' && Array.isArray(edData)){
          for(var i = 0; i < edData.length; i++){
            var r = edData[i];
            if(!r) continue;
            // 1순위: DB slug 일치. 2순위: 제목 기반 fallback slug 일치
            // (slug 컬럼이 없는 legacy 정적 행 대비).
            if(typeof r.slug === 'string' && r.slug.toLowerCase() === slugLc){ row = r; break; }
            if(!row && typeof _editorialTitleToSlug === 'function'
               && r.title && _editorialTitleToSlug(r.title) === slugLc){ row = r; }
          }
        }
        if(row && row.title){
          openEditorial(row.title, row.img || '');
          return;
        }
        // 2026-07-22 QA(히어로 배너 공백) — 카탈로그에 없는 slug(최신12 밖 + 시드 밖)는
        // 서버에서 1건 직조회해 주입 후 리로드 없이 연다. 실패 시에만 SSR 풀 이동.
        if(typeof window._papFetchEditorialBySlug === 'function'){
          window._papFetchEditorialBySlug(slug, function(local){
            if(local && local.title){ try{ openEditorial(local.title, local.img || ''); return; }catch(_){} }
            window.location.href = url;
          });
          return;
        }
      }
      // edData 미로딩 / 매칭 실패 / editorial 외 경로 → SSR 풀 이동.
      window.location.href = url;
    } catch(_){
      window.location.href = url;
    }
  });
}

// QA #295 — DB 에서 받은 그룹 리스트로 hero 슬라이드 DOM 재구성. 활성
// 그룹들의 모든 이미지를 평탄화해서 슬라이드로 렌더. 응답이 비어있거나
// 실패하면 정적 fallback 그대로 두어 LCP 보호.
// QA #296 — 모바일 viewport (≤768px) 에서는 image_url_mobile 우선
// 사용. NULL 이면 image_url 으로 자연스럽게 폴백. 캐시된 그룹 데이터
// (_heroBannerGroups) 를 보관해서 resize 시 재렌더.
let _heroBannerGroups = null;

function _heroIsMobile(){
  try { return window.innerWidth <= 768; } catch(_) { return false; }
}

function _heroRenderFromBanners(groups){
  var heroEl = document.getElementById('hero');
  if(!heroEl) return;
  if(!Array.isArray(groups) || groups.length === 0) return;

  _heroBannerGroups = groups;
  var isMobile = _heroIsMobile();

  // 활성 그룹 × 이미지 평탄화. viewport 에 맞는 src 선택.
  var newSlides = [];
  groups.forEach(function(g){
    var imgs = Array.isArray(g.images) ? g.images : [];
    imgs.forEach(function(im){
      if(!im) return;
      var chosen = (isMobile && im.image_url_mobile) ? im.image_url_mobile : im.image_url;
      if(chosen){
        newSlides.push({
          src: chosen,
          alt: (g.title || '') + (g.issue ? ' — ' + g.issue : ''),
          link: g.link_url || '',
          issue: g.issue || '',
          title: g.title || ''
        });
      }
    });
  });
  if(newSlides.length === 0) return;

  // 기존 슬라이드 / 고정 콘텐츠 / 심볼 캐싱 → 모두 제거 후 재주입.
  var existingContent = heroEl.querySelector('.hero-content');
  var existingSymbol  = heroEl.querySelector('.hero-symbol');
  Array.prototype.slice.call(heroEl.querySelectorAll('.hero-slide, .hero-nav'))
    .forEach(function(el){ el.remove(); });

  var frag = document.createDocumentFragment();
  newSlides.forEach(function(s, i){
    var slide = document.createElement('div');
    slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
    slide.style.background = '#111';
    var img = document.createElement('img');
    img.className = 'hero-slide-img';
    img.src = s.src;
    img.alt = s.alt || '';
    img.loading = (i === 0 ? 'eager' : 'lazy');
    img.onerror = function(){ this.remove(); };
    slide.appendChild(img);
    var grad = document.createElement('div');
    grad.className = 'hero-slide-gradient';
    slide.appendChild(grad);
    frag.appendChild(slide);
  });
  heroEl.insertBefore(frag, existingContent || existingSymbol || null);

  // 슬라이드 노드 + 메타 갱신.
  hSlides = heroEl.querySelectorAll('.hero-slide');
  _heroSlideMeta = newSlides;
  hCur = 0;
  // QA #303 — 첫 슬라이드에 맞춰 hero-content(발행호/제목) 도 즉시
  // 반영. 이후 heroGo 가 슬라이드 전환 시마다 다시 갱신.
  _heroUpdateContentText(0);

  // 컨트롤 (화살표/일시정지) 재주입 + click 위임 다시 걸기.
  _heroInstallControls();

  // 자동 재생 재시작 (reduced-motion 사용자는 건너뜀).
  var _rm = false;
  try { _rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_){}
  if(!_rm){
    _heroStop();
    _heroStart();
  }
}

if(hSlides.length){
  // Honor reduced-motion: hold on the first slide, no autoplay at all.
  var _heroReduceMotion = false;
  try { _heroReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_){}
  if(!_heroReduceMotion){
    _heroStart();
    var _heroEl = document.getElementById('hero');
    if(_heroEl){
      // Pause on hover / touch — finger or cursor on the banner means
      // the user is engaging; don't change the slide under them.
      _heroEl.addEventListener('mouseenter', _heroPause);
      _heroEl.addEventListener('mouseleave', _heroResume);
      _heroEl.addEventListener('touchstart', _heroPause, {passive:true});
      _heroEl.addEventListener('touchend',   function(){ setTimeout(_heroResume, 400); }, {passive:true});
    }
    // Pause when the tab is hidden, resume on focus.
    document.addEventListener('visibilitychange', function(){
      if(document.hidden) _heroPause(); else _heroResume();
    });
  }

  // QA #295 — 기본 컨트롤(화살표/일시정지) 주입. 정적 fallback HTML 에
  // 도 동작하도록 fetch 결과와 무관하게 먼저 설치.
  _heroInstallControls();

  // QA #295 — DB 그룹 데이터 fetch → 도착하면 슬라이드 동적 교체.
  // edge cache 5분 + SWR 1h 라 가벼움. 실패해도 정적 fallback 유지.
  try {
    fetch('/api/banners')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(json){
        if(json && Array.isArray(json.data) && json.data.length > 0){
          _heroRenderFromBanners(json.data);
        }
      })
      .catch(function(err){ console.warn('[hero] banners fetch failed', err); });
  } catch(_){}

  // QA #296 — viewport 가 PC ↔ 모바일 breakpoint(768px) 를 가로질러
  // resize 될 때만 hero 를 다시 그려서 image_url / image_url_mobile
  // 사이를 자동 전환. debounce 200ms 로 회전/창 드래그 시 폭발 방지.
  var _wasHeroMobile = _heroIsMobile();
  var _heroResizeT = null;
  window.addEventListener('resize', function(){
    if(_heroResizeT) clearTimeout(_heroResizeT);
    _heroResizeT = setTimeout(function(){
      var nowMobile = _heroIsMobile();
      if(nowMobile !== _wasHeroMobile && _heroBannerGroups){
        _wasHeroMobile = nowMobile;
        _heroRenderFromBanners(_heroBannerGroups);
      }
    }, 200);
  });
}
// Expose for debugging / future manual nav buttons.
window._papHero = { go: heroGo, pause: _heroPause, resume: _heroResume,
                    intervalMs: HERO_INTERVAL_MS,
                    renderFromBanners: _heroRenderFromBanners };

// ======== SEARCH ========
// ======== LANG HELPER ========
function getLangText(key,fallback){var lang=localStorage.getItem('pap-lang')||'ko';var msgs={edAccessFree:{ko:'에디토리얼 전체보기는 스탠다드 이상 회원만 이용 가능합니다.',en:'Standard membership or above is required to browse all editorials.',it:'Per accedere a tutti gli editoriali è necessario un abbonamento Standard o superiore.',fr:'Un abonnement Standard ou supérieur est requis pour parcourir tous les éditoriaux.',es:'Se requiere una membresía Estándar o superior para ver todos los editoriales.',ja:'全エディトリアルの閲覧にはスタンダード以上の会員登録が必要です。',zh:'浏览所有社论需要标准会员或以上。',ru:'Для просмотра всех редакционных материалов требуется подписка Standard или выше.'}};var m=msgs[key];if(!m)return fallback||'';return m[lang]||m.en||fallback||'';}

// toggleSearch / search input listeners / searchEditorials: extracted to
// Both pap-auth.js and pap-search.js MUST be loaded before this file.
//
// The ESC/Backspace global hotkey handler below STAYS here — it closes
// search UI but ALSO closes editorial / film / article overlays and the nav,
// which belong to other harnesses. Splitting it would cross-couple them.
document.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Backspace'){var isInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable;if(e.key==='Backspace'&&isInput)return;var _sb=document.getElementById('searchBar');if(_sb)_sb.classList.remove('active');var _sdd=document.getElementById('searchDropdown');if(_sdd)_sdd.classList.remove('active');var _ssi=document.getElementById('searchInput');if(_ssi)_ssi.value='';var _ad=document.getElementById('accountDropdown');if(_ad)_ad.classList.remove('active');closeNav();var edOv=document.getElementById('edOverlay');if(edOv&&edOv.classList.contains('active')){closeEditorial();e.preventDefault();return;}closeAllEditorials();closeAllFilms();closeAllArticles();if(document.getElementById('filmDetailOverlay'))document.getElementById('filmDetailOverlay').classList.remove('active');if(document.getElementById('artDetailOverlay'))document.getElementById('artDetailOverlay').classList.remove('active');if(e.key==='Backspace')e.preventDefault();}});

// ======== NAV ========
function toggleNav(){
  var _n=document.getElementById('navOverlay');
  if(!_n) return;
  var opening = !_n.classList.contains('active');
  _n.classList.toggle('active');

  // Hamburger ≡ ↔ X morph
  // QA #98 — toggle BOTH .is-active AND .active so pages with stale
  // page-level CSS keyed off `.hamburger.active` (e.g. magazine.html)
  // also morph into an X. Pages keyed off `.is-active` (the canonical
  // class — pap-styles.css, pap-header.js injected style) keep working
  // unchanged because we still toggle that class too.
  var hb = document.querySelector('.hamburger');
  if(hb){
    if(opening){
      hb.classList.add('is-active');
      hb.classList.add('active');
    } else {
      hb.classList.remove('is-active');
      hb.classList.remove('active');
    }
  }

  // Scroll lock
  if(opening) lockScroll();
  else unlockScroll();

  // Floating logo
  var fLogo=document.getElementById('floatingLogo');
  var heroEl=document.querySelector('.hero');
  if(fLogo){
    if(opening){
      fLogo.style.display='none';
      if(heroEl) heroEl.style.cursor='';
    } else {
      fLogo.style.display='';
    }
  }
}
function closeNav(){
  var _n=document.getElementById('navOverlay');
  if(_n && _n.classList.contains('active')) toggleNav();
}

// Carousel helpers (_papUpdateArrows, _papWireCarousel, _papSmoothScrollBy)
// below call _papSmoothScrollBy as a global at click time.

// ======== FASHION CAROUSEL ========
function moveCarousel(d){
  var t = document.getElementById('fashionTrack');
  if(!t) return;
  // Scroll by ~one card width (estimated from first child or fallback).
  var first = t.firstElementChild;
  var step = (first ? first.offsetWidth + 24 : 320);
  // Reset legacy transform if any prior state set it.
  if(t.style.transform) t.style.transform = '';
  _papSmoothScrollBy(t, d * step);
}

// ======== ED CAROUSEL ========
let ePos=0;
function moveEdCarousel(d){const t=document.getElementById('edTrack');if(!t||!t.firstElementChild)return;const w=t.firstElementChild.offsetWidth+20;ePos=Math.max(0,Math.min(ePos+d,3));t.style.transform=`translateX(-${ePos*w}px)`}

// ======== SCROLL REVEAL ========
const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('v')}),{threshold:.05});
document.querySelectorAll('.sr').forEach(e=>obs.observe(e));

// ======== INIT ========

// ======== TERMS & PRIVACY PAGES ========
// openPage / closePage / _legalNoticeTexts: extracted to pap-static.js
// (mission 7). _legalNoticeTexts now lives in pap-i18n.js. Both must be
// loaded before this file (already wired so via the script tag order).

// ======== EDITORIAL ROWS SCROLL ========
function scrollEdRow(btn,dir){
  var track=btn.parentElement.querySelector('.ed-row-track');
  if(track) _papSmoothScrollBy(track, dir*460);
}

// QA #239 — Single source of truth: overlay id → close function name.
// Exposed on window so per-content modules can call
// _papCloseOtherOverlays() before they open a new overlay (avoids the
// nested-layer stacking the user reported: clicking a contributor name
// inside an editorial used to leave the editorial open behind a film
// overlay behind a profile popup — three layers deep, browser-back
// chaos).
window._PAP_OVERLAY_CLOSE_MAP = {
  'edAllOverlay':       'closeAllEditorials',
  'filmAllOverlay':     'closeAllFilms',
  'artAllOverlay':      'closeAllArticles',
  'edOverlay':          'closeEditorial',
  'filmDetailOverlay':  'closeFilmDetail',
  'artDetailOverlay':   'closeArticleDetail'
};

// QA #239 v2 — close every other active SPA overlay before opening a
// new one. Each close fn already accepts a skipHistory truthy arg so
// we don't push extra history.back() calls when the caller is about
// to push its own state. Safe to call from inside an open() flow.
window._papCloseOtherOverlays = function(exceptId){
  var MAP = window._PAP_OVERLAY_CLOSE_MAP;
  Object.keys(MAP).forEach(function(id){
    if(id === exceptId) return;
    var el = document.getElementById(id);
    if(!el || !el.classList.contains('active')) return;
    try {
      var fn = window[MAP[id]];
      if(typeof fn === 'function') fn(true); // skipHistory
    } catch(_){}
  });
};

// QA #329 — 오버레이 미니헤더에서 X + HOME 버튼 제거.
// 기존(QA #239): edAll/filmAll/artAll 오버레이 좌측에 X + HOME 을 자동 주입해서
// "닫기 + 홈 이동" 을 1-클릭 제공했지만, 사용자가 "다른 페이지 헤더와 UI 가 다르다"
// 는 이슈를 제기 → 다른 페이지(articles.html, films.html 등)처럼 햄버거 + 검색만
// 남기고 X + HOME 은 삭제. 오버레이 닫기는:
//   - 햄버거 클릭 시 자동 닫힘 (기존 로직 유지)
//   - 중앙 PAP 로고 클릭 시 홈 이동 (기존 로직 유지)
//   - 브라우저 뒤로가기 (히스토리 popstate)
// 로 해소되므로 사용성 저하 없음.
//
// 아래 IIFE 는 이전에 X + HOME 을 주입하던 로직이었음.
// 렌더링은 완전 비활성화하고, 이미 DOM 에 남아있는 legacy 마크업/JS-주입 버튼도
// 정리해서 어느 배포 시점에 로드된 페이지든 즉시 통일된 UI 를 보게 함.
(function _papCleanOverlayLegacyButtons(){
  function _clean(){
    var MAP = window._PAP_OVERLAY_CLOSE_MAP || {};
    Object.keys(MAP).forEach(function(id){
      var overlay = document.getElementById(id);
      if (!overlay) return;
      // 정적 마크업(index.html edAllOverlay 등)에 남아있는 X + HOME 제거.
      overlay.querySelectorAll('.overlay-mini-close, .overlay-mini-home').forEach(function(el){
        el.remove();
      });
    });
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _clean);
  } else {
    _clean();
  }
})();

// Initialize unified arrow-state for every home-page horizontal carousel.
// Runs once at DOMContentLoaded; carousels added later (e.g. by API render)
// can call this again or rely on the MutationObserver inside _papWireCarousel.
(function _papInitCarouselArrows(){
  function init(){
    // Fashion section ("최신기사") — single track, fixed left/right arrows
    var fashionTrack = document.getElementById('fashionTrack');
    if(fashionTrack){
      var section = fashionTrack.closest('.fashion-section');
      var L = section && section.querySelector('.carousel-arrow.left');
      var R = section && section.querySelector('.carousel-arrow.right');
      _papWireCarousel(fashionTrack, '.carousel-arrow.left', '.carousel-arrow.right');
      // The left/right arrow query above scopes to wrap (parentElement of
      // track), but fashion uses section as the relative parent — wire by
      // direct ref too:
      if(L || R){
        function update(){ _papUpdateArrows(fashionTrack, L, R); }
        fashionTrack.addEventListener('scroll', update, {passive:true});
        window.addEventListener('resize', update);
        // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
      }
    }
    // Editorial rows — multiple tracks, each wrapped in .ed-row-wrap
    document.querySelectorAll('.ed-row-wrap').forEach(function(wrap){
      var track = wrap.querySelector('.ed-row-track');
      var left  = wrap.querySelector('.ed-row-arrow.ed-row-left');
      var right = wrap.querySelector('.ed-row-arrow.ed-row-right');
      if(!track) return;
      function update(){ _papUpdateArrows(track, left, right); }
      track.addEventListener('scroll', update, {passive:true});
      window.addEventListener('resize', update);
      var mo = new MutationObserver(update);
      try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
      // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
    });
    // Film carousel — .nf-wrap with .nf-track inside
    document.querySelectorAll('.nf-wrap').forEach(function(wrap){
      var track = wrap.querySelector('.nf-track');
      var left  = wrap.querySelector('.nf-nav-left');
      var right = wrap.querySelector('.nf-nav-right');
      if(!track) return;
      function update(){ _papUpdateArrows(track, left, right); }
      track.addEventListener('scroll', update, {passive:true});
      window.addEventListener('resize', update);
      var mo = new MutationObserver(update);
      try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
      // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


window.addEventListener('popstate',function(e){
  var st=e.state;
  var edOv=document.getElementById('edOverlay');
  var cpOv=document.getElementById('creatorPopup');

  // If navigating back to a creator profile state → restore creator popup
  if(st && st.creator && st.handle){
    // Close editorial overlay if open (without history manipulation)
    if(edOv && edOv.classList.contains('active')){
      edOv.classList.remove('active');
      document.body.style.overflow='';
    }
    // Restore creator popup from saved data or by handle
    if(window._lastCreatorData){
      var cr=window._lastCreatorData;
      var h=cr.handle||cr.instagram||cr.name||'';
      if(h.replace('@','').toLowerCase()===st.handle.replace('@','').toLowerCase()){
        // Re-open with saved data (no pushState)
        _openCreatorPopup_noPush(cr);
        return;
      }
    }
    // Fallback: open by handle from DB
    var db=typeof getCreatorDB==='function'?getCreatorDB():{};
    var key=st.handle.toLowerCase();
    if(db[key]){
      _openCreatorPopup_noPush(db[key]);
    } else {
      _openCreatorPopup_noPush({name:st.handle.replace('@',''),handle:st.handle,role:'Contributor',editorials:[],imgs:[]});
    }
    return;
  }

  // If navigating back to a previous editorial state → restore that editorial
  if(st && st.editorial && st.title){
    // Close creator popup if open
    var _wasCpActive = !!(cpOv && cpOv.classList.contains('active'));
    if(_wasCpActive){cpOv.classList.remove('active');unlockScroll();}
    _openEditorialInner_noPush(st.title, st.thumb||'');
    // If we just closed a creator popup that was opened ON TOP of the
    // editorial, restore the scroll position the user was at when they
    // clicked the credit. Without this they get snapped to the top
    // because _openEditorialInner_noPush ends with scrollTop=0.
    if(_wasCpActive && typeof window._papEdScrollBeforeCreator === 'number'){
      try {
        var _edOv2 = document.getElementById('edOverlay');
        if(_edOv2) _edOv2.scrollTop = window._papEdScrollBeforeCreator;
      } catch(_){}
      window._papEdScrollBeforeCreator = null;
    }
    return;
  }

  // QA #166 — film/article/list states need EXPLICIT restore handling.
  // The catch-all below "close whatever is active" mistakenly closes the
  // underlying overlay when the user dismisses a popup that sat on top
  // of it (e.g. clicking × on a creator popup that was opened from a
  // film detail's credit row). After closeCreatorPopup → history.back(),
  // popstate fires with st={film:true,idx:N} and the catch-all would
  // close the film detail because it's still .active — even though the
  // user just wanted to dismiss the popup and return to the detail view.
  //
  // The blocks below treat these states as "stay here" anchors: dismiss
  // anything that's stacked on top, but leave the target overlay alone.

  // Back to a film detail page
  if(st && st.film){
    // QA #287 — creator popup이 film 위에 있다가 닫힌 경우만 popup 정리하고 film 유지.
    // creator popup이 없는데 popstate(st.film)가 fired됐다면 → 사용자가 직접
    // 뒤로가기를 눌렀거나 YouTube embed가 추가 entry를 만들어 stale state로 popped된 것.
    // 둘 다 사용자의 의도는 "film에서 벗어나기" — film overlay도 닫음.
    var _wasCpActive = !!(cpOv && cpOv.classList.contains('active'));
    if(_wasCpActive){
      cpOv.classList.remove('active');
      unlockScroll();
      return; // popup만 닫고 film 유지 (creator drilling 케이스)
    }
    var _fd=document.getElementById('filmDetailOverlay');
    if(_fd && _fd.classList.contains('active')){
      // film이 이미 active + 위에 popup도 없음 → 사용자 뒤로가기 = film 닫기 의도.
      closeFilmDetail(true);
      // URL이 여전히 /film/<slug>면 한 단계 더 뒤로 가서 진짜 이전 페이지로.
      if(window.location.pathname.indexOf('/film/') === 0){
        try { history.back(); } catch(e){}
      }
      return;
    }
    // Forward/back across a page reload — overlay is gone; re-create it.
    if(typeof openFilmDetail==='function' && typeof st.idx==='number'){
      openFilmDetail(st.idx);
    }
    return;
  }
  // Back to an article detail page
  if(st && st.article){
    if(cpOv && cpOv.classList.contains('active')){cpOv.classList.remove('active');unlockScroll();}
    var _ad=document.getElementById('artDetailOverlay');
    if((!_ad || !_ad.classList.contains('active')) && typeof openArticleDetail==='function' && typeof st.idx==='number'){
      openArticleDetail(st.idx);
    }
    return;
  }
  // Back to a list overlay (films-all / articles-all / editorials-all).
  // The list is still .active underneath whatever sat on top. Dismiss
  // any detail / popup that's stacked, but leave the list alone.
  // closeFilmDetail(true) etc. pass skipHistory so we don't fire a
  // second popstate by chaining history.back() in the closers.
  if(st && st.overlay){
    if(cpOv && cpOv.classList.contains('active')){cpOv.classList.remove('active');unlockScroll();}
    var _fdL=document.getElementById('filmDetailOverlay');
    if(_fdL && _fdL.classList.contains('active')){closeFilmDetail(true);}
    var _adL=document.getElementById('artDetailOverlay');
    if(_adL && _adL.classList.contains('active')){closeArticleDetail(true);}
    // Note: edOverlay is the editorial DETAIL overlay (single editorial),
    // and edAllOverlay is the editorial LIST. The list never has a detail
    // overlay opened on top of it in the same stack, so we don't touch
    // edOv here — the catch-all paths above handle editorial cases.
    return;
  }

  // Otherwise, close whatever overlay is open
  // Close creator popup first
  if(cpOv && cpOv.classList.contains('active')){
    cpOv.classList.remove('active');
    unlockScroll();
    return;
  }
  if(edOv && edOv.classList.contains('active')){
    closeEditorial(true);
    return;
  }
  // Close all-editorials overlay
  var edAll=document.getElementById('edAllOverlay');
  if(edAll && edAll.classList.contains('active')){closeAllEditorials(true);return;}
  // Close film/article overlays on back button
  var filmDet=document.getElementById('filmDetailOverlay');
  if(filmDet && filmDet.classList.contains('active')){closeFilmDetail(true);return;}
  var filmAll=document.getElementById('filmAllOverlay');
  // QA #244 — closeAllFilms / closeAllArticles now call history.back()
  // when skipHistory is false. popstate is the one place we MUST pass
  // true, otherwise we'd pop the stack twice (the browser already did
  // one pop to fire popstate).
  if(filmAll && filmAll.classList.contains('active')){closeAllFilms(true);return;}
  var artDet=document.getElementById('artDetailOverlay');
  if(artDet && artDet.classList.contains('active')){closeArticleDetail(true);return;}
  var artAll=document.getElementById('artAllOverlay');
  if(artAll && artAll.classList.contains('active')){closeAllArticles(true);return;}
});




// AUTO LANGUAGE DETECTION
// Language detection is delegated to pap-geo-lang.js (loaded before this script).
// That module handles: IP geolocation → browser/timezone fallback → user preference respect.
// Here we simply apply whatever has already been resolved in localStorage.
(function(){
  var saved = localStorage.getItem('pap-lang') || 'en';
  setLang(saved);
})();









window.artData=artData;window.filmAllData=filmAllData;








// ======== PAGINATION UTILITY ========
// Pagination component (PAP_PER_PAGE, PAP_PAGE_JUMP, buildPagination)
// and the editorial-list section below as a global.
