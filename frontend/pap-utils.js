// PAP Magazine — Shell utilities module (extracted from pap-app.js per
// HARNESS_CHECKLIST.md mission 5).
//
// ───────────────────────────────────────────────────────────────────────
// VIDEO EMBED URL NORMALISATION (shared by editorial detail + film admin)
// ───────────────────────────────────────────────────────────────────────
// Films and editorials both accept a single video URL. The detail page
// renders an <iframe> using the embed URL produced here; the admin form
// validates against this same function so the user gets a consistent
// "URL is valid" / "we'll fall back to a link" answer at save time.
//
// Returns one of:
//   { kind:'iframe', src, provider } — iframe-embeddable URL ready to drop
//                                       into <iframe src=…>
//   { kind:'link',   href, provider } — provider doesn't support iframe
//                                       embedding from arbitrary domains
//                                       (Instagram); render a card link
//                                       instead.
//   null                              — empty input or unrecognised URL.
//
// providers covered: youtube, vimeo, instagram (link only).
// Anything else returns null so the caller can decide whether to show
// a generic external-link fallback or skip the section entirely.
function normaliseEmbedUrl(rawUrl){
  if (!rawUrl) return null;
  var u = String(rawUrl).trim();
  if (!u) return null;

  // YouTube — covers six input shapes the admin form realistically receives:
  //   1) https://www.youtube.com/watch?v=ID  (canonical)
  //   2) https://youtu.be/ID                 (shortlink)
  //   3) https://www.youtube.com/shorts/ID   (shorts)
  //   4) https://www.youtube.com/embed/ID    (already-clean embed src)
  //   5) https://www.youtube.com/live/ID     (live broadcasts)
  //   6) https://www.youtube.com/ID          (bare path — non-standard but
  //                                           happens when an admin pastes a
  //                                           malformed link; QA caught the
  //                                           "Selects" film row created
  //                                           this way and the iframe broke)
  // Plus, further down, the case where the admin pastes JUST the 11-char id.
  //
  // Match the *first* video-id-shaped token after recognised path markers
  // so query strings like `?si=…&list=…` don't break extraction.
  var ytMatch =
       u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i)
    || u.match(/[?&]v=([A-Za-z0-9_-]{11})/)
    // Bare youtube.com path — youtube.com/ID without /watch?v=, /shorts/, etc.
    // Anchored to either end-of-string, ?, &, #, or / so we don't gobble half
    // of an unrelated path segment that happens to be 11 chars.
    || u.match(/youtube\.com\/([A-Za-z0-9_-]{11})(?:[?&\/#]|$)/i);
  if (ytMatch) {
    return {
      kind: 'iframe',
      // youtube-nocookie is the privacy-friendly variant; it accepts the
      // same /embed/{id} path but doesn't drop tracking cookies until
      // the user actually starts the video.
      src: 'https://www.youtube-nocookie.com/embed/' + ytMatch[1],
      provider: 'youtube',
    };
  }

  // Bare 11-character YouTube ID pasted with nothing else — common when the
  // admin copies the id manually off a URL. Strict equality so we don't
  // false-positive on partial Vimeo / Instagram ids (those are longer or
  // contain dots).
  if (/^[A-Za-z0-9_-]{11}$/.test(u)) {
    return {
      kind: 'iframe',
      src: 'https://www.youtube-nocookie.com/embed/' + u,
      provider: 'youtube',
    };
  }

  // Vimeo — vimeo.com/{id} (canonical), with optional /channels/, /groups/,
  // /album/, or /video/ prefixes that all resolve to the same player.
  var vimeoMatch = u.match(/vimeo\.com\/(?:.*?\/)?(\d{6,})/i);
  if (vimeoMatch) {
    return {
      kind: 'iframe',
      src: 'https://player.vimeo.com/video/' + vimeoMatch[1],
      provider: 'vimeo',
    };
  }

  // Instagram Reel / Post / TV — Instagram's embed.js requires loading
  // their script and crawls layout. Falling back to an external-link
  // card is much more robust across mobile + when their script is
  // blocked. The caller renders a styled <a target="_blank">.
  var igMatch = u.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (igMatch) {
    return {
      kind: 'link',
      href: 'https://www.instagram.com/' + (u.indexOf('/reel') >= 0 ? 'reel' : (u.indexOf('/tv') >= 0 ? 'tv' : 'p')) + '/' + igMatch[1] + '/',
      provider: 'instagram',
    };
  }

  return null;
}
// Make the helper available to non-module scripts (admin form + editorial
// detail) which read it as a bare global.
if (typeof window !== 'undefined') window.normaliseEmbedUrl = normaliseEmbedUrl;

// QA #343 (사용자 요청) — 기사/에디토리얼 상세페이지 영상 자동재생.
// 브라우저 정책상 사용자 제스처 없이 재생하려면 반드시 mute + playsinline 필요.
// - YouTube: autoplay=1, mute=1, playsinline=1, rel=0
// - Vimeo:   autoplay=1, muted=1, playsinline=1
// 기존 query 를 보존하면서 필요한 파라미터만 병합.
function appendAutoplayParams(src, provider){
  if (!src) return src;
  var isYouTube = provider === 'youtube'
    || /youtube\.com\/embed|youtube-nocookie\.com\/embed/i.test(src);
  var isVimeo   = provider === 'vimeo' || /player\.vimeo\.com\/video/i.test(src);
  if (!isYouTube && !isVimeo) return src;
  var params = isYouTube
    ? { autoplay:'1', mute:'1', playsinline:'1', rel:'0' }
    : { autoplay:'1', muted:'1', playsinline:'1' };
  var qIdx = src.indexOf('?');
  var base = qIdx >= 0 ? src.slice(0, qIdx) : src;
  var existing = qIdx >= 0 ? src.slice(qIdx + 1) : '';
  var seen = {};
  existing.split('&').filter(Boolean).forEach(function(kv){
    var eq = kv.indexOf('=');
    var k = eq >= 0 ? kv.slice(0, eq) : kv;
    seen[k] = kv;
  });
  Object.keys(params).forEach(function(k){
    seen[k] = k + '=' + params[k];
  });
  var qs = Object.keys(seen).map(function(k){ return seen[k]; }).join('&');
  return base + (qs ? '?' + qs : '');
}
if (typeof window !== 'undefined') window.appendAutoplayParams = appendAutoplayParams;


//
// Foundational pure-ish helpers shared across every page and harness:
//   - modal scroll lock (lockScroll / unlockScroll, ref-counted)
//   - horizontal carousel arrow-state + smooth scroll
//   - HTML escape / decode / whitespace normalize
//   - shared pagination component (PAP_PER_PAGE, buildPagination)
//
// All functions are top-level declarations so they attach to window in
// classic-script context — they are read as bare globals from pap-app.js,
// pap-static.js, articles.html, films.html, and the inline scroll-lock copies
// in about/business/contact/pullletter/pap-magazine-v5.
//
// No external dependencies. Should be loaded first in the script chain.

// ======== MODAL SCROLL LOCK (공통) ========
// 모달이 열릴 때 배경 스크롤을 잠그고, 닫힐 때 원래 위치로 복원합니다.
var _scrollLockCount=0;
var _savedScrollY=0;
function lockScroll(){
  if(_scrollLockCount===0){
    _savedScrollY=window.scrollY;
    document.body.style.overflow='hidden';
    document.body.style.position='fixed';
    document.body.style.top=(-_savedScrollY)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
  }
  _scrollLockCount++;
}
function unlockScroll(){
  _scrollLockCount--;
  if(_scrollLockCount<=0){
    _scrollLockCount=0;
    document.body.style.overflow='';
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    window.scrollTo(0,_savedScrollY);
  }
}

// ======== UNIFIED CAROUSEL ARROW STATE ========
// Toggles `.is-disabled` on the left arrow when scrollLeft is at 0 and on
// the right arrow when scrollLeft + clientWidth has reached scrollWidth.
// Single helper used by every horizontal-scroll carousel on the home page
// so the user sees the same "hide arrow when there's nothing to scroll
// to" behavior consistently across sections.
function _papUpdateArrows(track, leftBtn, rightBtn){
  if(!track) return;
  // 1px tolerance — fractional scroll positions on retina/zoom can leave
  // scrollLeft like 0.4 even when visually pinned to the start.
  var atStart = track.scrollLeft <= 1;
  var atEnd   = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
  // No overflow at all → both arrows hide (nothing to scroll).
  var noOverflow = track.scrollWidth <= track.clientWidth + 1;
  if(leftBtn)  leftBtn.classList.toggle('is-disabled',  noOverflow || atStart);
  if(rightBtn) rightBtn.classList.toggle('is-disabled', noOverflow || atEnd);
}
function _papWireCarousel(trackSel, leftSel, rightSel){
  var track = typeof trackSel === 'string' ? document.querySelector(trackSel) : trackSel;
  if(!track) return;
  // Find sibling buttons within the track's parent (works for ed-row-wrap,
  // nf-wrap, fashion-section, etc.)
  var wrap = track.parentElement;
  var left  = leftSel  ? (wrap.querySelector(leftSel)  || document.querySelector(leftSel))  : null;
  var right = rightSel ? (wrap.querySelector(rightSel) || document.querySelector(rightSel)) : null;
  function update(){ _papUpdateArrows(track, left, right); }
  track.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', update);
  // Mutation observer for content rendered later (cards added via API)
  var mo = new MutationObserver(update);
  try{ mo.observe(track, {childList:true, subtree:false}); }catch(_){}
  // Initial state — wait a frame for layout to settle.
  // setTimeout guarantees layout has settled and observer/scroll listeners
  // are attached before the first state computation. RAF chained twice was
  // intermittently not firing in some Vercel CDN cold-start scenarios.
  setTimeout(update, 0);
  setTimeout(update, 200);
  setTimeout(update, 1500);
}

// ======== SMOOTH SCROLL HELPER ========
// Used by Fashion / Editorial-row / Film-row carousels. See pap-app.js's
// moveCarousel/scrollEdRow/scrollFilm for callers.
//
// IMPORTANT: scrollBy({behavior:'smooth'}) silently fails on these tracks
// in some Chrome layouts (likely an interaction with the parent's
// overflow:hidden + flex container). Even direct scrollLeft assignment is
// queued/ignored when CSS scroll-behavior:smooth is set on the element.
//
// Strategy: temporarily force scroll-behavior:auto inline, set scrollLeft
// synchronously to the target, then on the next animation frame swap
// behavior back to its previous value AND set scrollLeft again — Chrome
// will animate from the current position with smooth scroll for the final
// frame, giving a visual easing without depending on rAF firing reliably.
// Works on hidden tabs (rAF throttled) too because the synchronous jump
// ensures the click ALWAYS produces movement.
function _papSmoothScrollBy(track, dx){
  if(!track || !dx) return;
  var prevBehavior = track.style.scrollBehavior;
  var max = Math.max(0, track.scrollWidth - track.clientWidth);
  var target = Math.max(0, Math.min(max, track.scrollLeft + dx));
  if(target === track.scrollLeft) return;
  // Phase 1 — synchronous instant jump (works regardless of rAF state).
  track.style.scrollBehavior = 'auto';
  track.scrollLeft = target;
  // Phase 2 — synthetic scroll event so listeners (e.g. arrow state updater)
  // run even when programmatic scroll didn't trigger a native scroll event.
  try { track.dispatchEvent(new Event('scroll', {bubbles:false})); } catch(_){}
  // Phase 3 — restore previous scroll-behavior on next frame (best-effort).
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function(){
      track.style.scrollBehavior = prevBehavior;
    });
  } else {
    track.style.scrollBehavior = prevBehavior;
  }
}

// ======== HTML helpers ========
function escapeHtml(t){if(!t)return '';return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// QA(2026-07) #8 — 발행일 표기 통일용 공용 포맷터. 메인홈 카드가 쓰는
// "DD Mon YYYY"(예: 12 Jul 2026) 형식을 목록/상세 등 다른 표면에서도 재사용해
// 페이지 위치에 따라 날짜 형식이 달라지던 문제(ISO·한글월 혼재)를 없앤다.
var _PAP_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function papFmtDate(dateStr){
  if(!dateStr) return '';
  var d=new Date(dateStr);
  if(isNaN(d.getTime())) return typeof dateStr==='string'?dateStr.substring(0,10):'';
  return ('0'+d.getDate()).slice(-2)+' '+_PAP_MONTHS[d.getMonth()]+' '+d.getFullYear();
}
if (typeof window !== 'undefined') window.papFmtDate = papFmtDate;

// 2026-07-20 (QA 재발 — 카테고리·발행일 표기 통일) — 메인홈/목록/상세 전 페이지
// 공통 포맷터. 표준: "Title,Case - DD Mon YYYY" (홈 카드 형식에 맞춤).
//   • 카테고리: 쉼표 구분 각 조각 첫 글자만 대문자 (DB는 소문자 저장 — QA #223)
//   • 발행일: papFmtDate (DD Mon YYYY)
//   • 구분자: " - " (카테고리·날짜 둘 다 있을 때만)
function papTitleCat(cat){
  return String(cat || '').split(',').map(function(p){
    p = p.trim();
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
  }).filter(Boolean).join(',');
}
function papFmtMeta(cat, date){
  var c = papTitleCat(cat || 'Article');
  var d = papFmtDate(date);
  return c + (c && d ? ' - ' : '') + d;
}
if (typeof window !== 'undefined') { window.papTitleCat = papTitleCat; window.papFmtMeta = papFmtMeta; }
function _decHtml(s){var d=document.createElement('div');d.innerHTML=s;return d.textContent||d.innerText||'';}
function _normWs(s){return s.replace(/[\u2018\u2019\u201C\u201D]/g,"'").replace(/\s+/g,' ').trim();}

// ======== UNIFIED PAGINATION COMPONENT ========
// Used by index (editorials), articles, films, and any other listing page.
// Ellipsis ('···') is rendered as a hover/focus-interactive button that
// morphs into «/» on hover and jumps ±5 pages on click. Mobile (no-hover)
// devices: a single tap on the '···' button reveals the arrow briefly and
// fires the jump (the :active state plus the .is-revealed class give users
// a visual hint that the element is interactive).
// QA #234 — bumped from 20 to 30 per editor request. Both editorials
// and films overlays read this directly; articles overrides it locally
// with ART_PER_PAGE=21 so the 3-column grid keeps filling complete rows.
var PAP_PER_PAGE=30;
var PAP_PAGE_JUMP=5; // number of pages the ellipsis jump skips
function buildPagination(container,currentPage,totalPages,onPageChange,isDark){
  container.innerHTML='';
  if(totalPages<=1) return;
  container.className='pap-pagination'+(isDark?' dark':'');

  // Numbered / arrow button
  function btn(label,page,isActive,isDisabled,cls){
    var b=document.createElement('button');
    b.type='button';
    b.textContent=label;
    if(isActive) b.className='active';
    if(isDisabled) b.disabled=true;
    if(cls) b.className=(b.className?b.className+' ':'')+cls;
    if(!isDisabled&&!isActive) b.onclick=function(){onPageChange(page);};
    container.appendChild(b);
    return b;
  }

  // Hover-interactive ellipsis with directional ±5 jump.
  // direction: -1 (prev block) → '···' morphs to '«', jumps to currentPage-5
  // direction: +1 (next block) → '···' morphs to '»', jumps to currentPage+5
  function jump(direction){
    var target = direction<0
      ? Math.max(1,currentPage-PAP_PAGE_JUMP)
      : Math.min(totalPages,currentPage+PAP_PAGE_JUMP);
    var b=document.createElement('button');
    b.type='button';
    b.className='pag-jump '+(direction<0?'pag-jump-prev':'pag-jump-next');
    var label=(typeof lang!=='undefined'&&lang==='ko')?((direction<0?'이전 ':'다음 ')+PAP_PAGE_JUMP+'페이지로 이동'):((direction<0?'Previous ':'Next ')+PAP_PAGE_JUMP+' pages');
    b.setAttribute('aria-label',label);
    b.title=(direction<0?'-':'+')+PAP_PAGE_JUMP+' pages';
    b.innerHTML='<span class="pag-jump-dots" aria-hidden="true">···</span>'+
                '<span class="pag-jump-arrow" aria-hidden="true">'+(direction<0?'«':'»')+'</span>';
    // Mobile / no-hover devices: first tap reveals the arrow (300ms hint),
    // second tap (within 1.2s) fires the jump. On hover-capable devices the
    // single click fires immediately because the arrow is already visible.
    var canHover = (typeof window.matchMedia==='function'
                    && window.matchMedia('(hover: hover)').matches);
    if(canHover){
      b.onclick=function(){onPageChange(target);};
    } else {
      var revealed=false, revealTimer=null;
      b.onclick=function(){
        if(revealed){
          revealed=false;
          if(revealTimer){clearTimeout(revealTimer);revealTimer=null;}
          b.classList.remove('is-revealed');
          onPageChange(target);
          return;
        }
        revealed=true;
        b.classList.add('is-revealed');
        if(revealTimer)clearTimeout(revealTimer);
        revealTimer=setTimeout(function(){
          revealed=false;
          b.classList.remove('is-revealed');
        },1200);
      };
    }
    container.appendChild(b);
    return b;
  }

  // prev arrow
  btn('‹',currentPage-1,false,currentPage===1);

  // page numbers
  if(totalPages<=9){
    for(var i=1;i<=totalPages;i++) btn(String(i),i,i===currentPage,false);
  } else {
    btn('1',1,1===currentPage,false);
    var start=Math.max(2,currentPage-1);
    var end=Math.min(totalPages-1,currentPage+1);
    if(currentPage<=4){start=2;end=Math.min(5,totalPages-1);}
    if(currentPage>=totalPages-3){start=Math.max(2,totalPages-4);end=totalPages-1;}
    if(start>2) jump(-1);
    for(var j=start;j<=end;j++) btn(String(j),j,j===currentPage,false);
    if(end<totalPages-1) jump(+1);
    btn(String(totalPages),totalPages,totalPages===currentPage,false);
  }

  // next arrow
  btn('›',currentPage+1,false,currentPage===totalPages);
}

/* ── 상단 IG 진입점 (2026-08-22) ────────────────────────────────────────
   도메니코: "모든 파이프라인에서 웹이 아닌 인스타그램에 유입되는 걸 최우선.
   웹에서도 기사와 에디토리얼에서 인스타그램으로 넘어오기 좋은 디자인으로."

   [무엇을 근거로 게시물인가] 같은 페이지·같은 방문자로 이미 비교돼 있다(30일):
       게시물(to=post)    약 1,394
       프로필(to=profile) 약   421      → 3.3 대 1
   노출이 같은 두 CTA 라 공정한 비교다. 그래서 원본이 있으면 게시물로 보내고,
   없을 때만 프로필로 떨어진다. (원본 보유율 실측: 화보 95.0% · 기사 87.7%)

   [왜 위인가 — 아직 모른다] 기존 진입점은 전부 페이지 맨 아래다. 위가 나은지는
   아무도 재본 적이 없다. 그래서 src 를 spa_top 으로 따로 둔다. 7일 뒤
   spa_top(위) 대 article·editorial(아래), ssr_top(위) 대 ssr_article(아래)을
   나란히 놓으면 판정이 숫자로 나온다. 추측으로 배치를 바꾸지 않는다.

   [규칙이 두 벌이 되지 않게] SSR(seoRenderer)과 SPA 가 같은 모양·같은 문구를
   쓰도록 여기 한 곳에만 둔다. 한쪽만 고쳐지는 사고를 막는다.

   반환: HTML 문자열. 넣을 자리가 없으면 호출부가 알아서 무시한다. */
function papIgTopHtml(igUrl, opts){
  opts = opts || {};
  var src = opts.src || 'spa_top';
  var raw = String(igUrl || '');
  var hasPost = /instagram\.com/.test(raw);
  /* 목적지 반반 (2026-08-22) — SSR(seoRenderer)과 **같은 규칙**이어야 한다.
     클릭은 게시물이 3.3배 많지만, 일별 상관은 팔로워 증가와 반대 방향이다:
         프로필 클릭 r=+0.323 · 게시물 클릭 r=-0.191 (31일, p≈0.08)
     도메니코가 원하는 건 클릭이 아니라 팔로워다. 팔로우 버튼은 프로필에 있다.
     확정이 아니므로 고정하지 않고 반반으로 갈라 7일 뒤 to_type 별로 판정한다.
     id 해시라 같은 글은 늘 같은 쪽 — 새로고침해도 화면이 안 흔들린다. */
  var bucketPost = hasPost;
  if (hasPost) {
    var h = 0;
    var key = String((opts && opts.key) || raw);
    for (var i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) % 1000;
    bucketPost = (h % 2) === 0;
  }
  var href = bucketPost
    ? '/api/ig-out?src=' + encodeURIComponent(src) + '&to=post&url=' + encodeURIComponent(raw.split('?')[0])
    : '/api/ig-out?src=' + encodeURIComponent(src) + '&to=profile&url=' + encodeURIComponent('https://www.instagram.com/pap_magazine/');
  var lang = 'ko';
  try { lang = localStorage.getItem('pap-lang') || 'ko'; } catch(_){}
  var T = {
    ko: { post: '인스타그램에서 기사 확인하기', prof: 'PAP 인스타그램 팔로우' },
    ja: { post: 'この記事のInstagram原文を見る',   prof: 'PAPのInstagramをフォロー' },
    zh: { post: '查看 Instagram 原帖',            prof: '关注 PAP Instagram' },
    it: { post: 'Guarda il post originale su Instagram', prof: 'Segui PAP su Instagram' },
    fr: { post: 'Voir le post original sur Instagram',   prof: 'Suivre PAP sur Instagram' },
    es: { post: 'Ver la publicación original en Instagram', prof: 'Seguir a PAP en Instagram' },
    de: { post: 'Originalbeitrag auf Instagram ansehen', prof: 'PAP auf Instagram folgen' },
    ru: { post: 'Смотреть оригинал в Instagram',  prof: 'Подписаться на PAP в Instagram' },
    en: { post: 'See the original post on Instagram',    prof: 'Follow PAP on Instagram' }
  };
  var t = T[lang] || T.en;
  var label = bucketPost ? t.post : t.prof;
  /* 인라인 스타일로 그린다 — pap-styles.css 는 SSR 에서 늦게 오고(preload→onload),
     이 줄은 첫 화면에 보여야 한다. SSR 쪽 .ig-top 과 같은 모양을 맞춘 값이다. */
  return '<a href="' + href + '" target="_blank" rel="noopener" class="ig-top" '
       + 'style="display:flex;align-items:center;gap:10px;margin:14px 0 0;padding:11px 14px;'
       + 'border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.03);color:#fff;'
       + 'text-decoration:none;font-size:12.5px;line-height:1.4">'
       + '<span aria-hidden="true" style="flex:0 0 auto;font-size:15px;opacity:.9">◎</span>'
       + '<span style="flex:1 1 auto;min-width:0">' + label + '</span>'
       + '<span aria-hidden="true" style="flex:0 0 auto;opacity:.6;font-size:13px">↗</span>'
       + '</a>';
}
try { window.papIgTopHtml = papIgTopHtml; } catch(_){}
