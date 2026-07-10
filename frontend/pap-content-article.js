// PAP Magazine — Content harness, Article sub-module (extracted from
// pap-app.js per HARNESS_CHECKLIST.md mission 8c).
//
// Owns:
//   - artData (article dataset, populated lazily from /api/articles +
//     pap-article-db.json via pap-i18n.js's _loadArticleI18n)
//   - openAllArticles / closeAllArticles
//   - openArticleBySlug / openArticleFromCard
//   - openArticleDetail / closeArticleDetail
//
// Public surface (consumed cross-script via globals):
//   var artData                      article dataset (window.artData mirrored
//                                    by pap-app.js, also referenced by
//                                    pap-i18n.js's _loadArticleI18n for
//                                    translation backfill, and by pap-search.js)
//   window.openAllArticles() / closeAllArticles()
//   window.openArticleBySlug(slug) / openArticleFromCard(card)
//   window.openArticleDetail(idx) / closeArticleDetail(skipHistory)
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js        → lockScroll/unlockScroll, escapeHtml, _decHtml,
//                           _normWs, buildPagination
//   - pap-i18n.js         → lang, _articleI18n
//   - pap-subscription.js → showPremiumInterstitial, isStandardOrAbove
//
// The cross-content popstate handler in pap-app.js calls closeArticleDetail
// and closeAllArticles as bare globals at click time.

// ======== ALL ARTICLES OVERLAY + openArticleBySlug + openArticleFromCard + openArticleDetail + closeArticleDetail ========
// ======== ALL ARTICLES OVERLAY ========
function openAllArticles(){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllArticlesInner(); });
    return;
  }
  _openAllArticlesInner();
}
function _openAllArticlesInner(){
  var overlay=document.getElementById('artAllOverlay');
  if(!overlay) return;
  var grid=document.getElementById('artAllGrid');
  var count=document.getElementById('artAllCount');
  var filterWrap=document.getElementById('artFilterWrap');
  grid.innerHTML='';
  // Gather unique categories
  var cats={};
  artData.forEach(function(a){(a.cat||'').split(',').forEach(function(c){c=c.trim();if(c)cats[c]=1;});});
  var catList=Object.keys(cats).sort();
  // Build filter
  filterWrap.innerHTML='<button class="art-filter-btn active" data-cat="all">ALL</button>'+catList.map(function(c){return '<button class="art-filter-btn" data-cat="'+c+'">'+c.toUpperCase()+'</button>';}).join('');
  filterWrap.querySelectorAll('.art-filter-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      filterWrap.querySelectorAll('.art-filter-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      filterArticles(btn.getAttribute('data-cat'));
    });
  });
  // Build article cards
  artData.forEach(function(a,i){
    // SEO — 실제 <a href="/article/<slug>"> 카드 (크롤러 링크 그래프용).
    var card=document.createElement('a');
    card.className='art-all-card';
    card.setAttribute('href', a.slug ? '/article/'+encodeURIComponent(a.slug) : '#');
    card.setAttribute('data-cats',(a.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(e){ if(e&&e.preventDefault)e.preventDefault(); openArticleDetail(i); };
    var dateStr=a.d?a.d.substring(0,10):'';
    card.innerHTML='<div class="art-all-thumb"><img src="'+(a.img||a.th)+'" alt="'+escapeHtml(a.t)+'" loading="lazy" onerror="edImgError(this)"></div><div class="art-all-info"><div class="art-all-cat">'+(a.cat||'ARTICLE').toUpperCase()+' · '+dateStr+'</div><div class="art-all-title">'+escapeHtml(a.t)+'</div>'+(a.sub?'<div class="art-all-sub">'+escapeHtml(a.sub)+'</div>':'')+'</div>';
    grid.appendChild(card);
  });
  count.textContent=artData.length+' ARTICLES';
  // QA #330 — 히스토리 스택 정합성 (film/editorial 과 동일 로직).
  // `/articles` clean path 또는 `/#articles-all` hash 로 진입한 경우 URL 이
  // 이미 이 상태를 나타냄 → replaceState. 그 외는 pushState.
  var alreadyOnArticlesUrl =
    window.location.hash === '#articles-all' ||
    window.location.pathname === '/articles';
  var targetArticlesUrl = window.location.pathname + '#articles-all';
  if(alreadyOnArticlesUrl){
    history.replaceState({overlay:'articles'},'', targetArticlesUrl);
  } else {
    history.pushState({overlay:'articles'},'', targetArticlesUrl);
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
}
function filterArticles(cat){
  var cards=document.querySelectorAll('.art-all-card');
  var shown=0;
  cards.forEach(function(c){
    if(cat==='all'||c.getAttribute('data-cats').indexOf(cat.toLowerCase())>=0){c.style.display='';shown++;}
    else{c.style.display='none';}
  });
  var count=document.getElementById('artAllCount');
  if(count) count.textContent=shown+' ARTICLES';
}
function closeAllArticles(skipHistory){
  var overlay=document.getElementById('artAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
    // QA #244 — Mirror closeArticleDetail / closeEditorial: a header X
    // click goes back in history so URL and overlay stay in sync.
    if(!skipHistory){ try { history.back(); } catch(e){} }
  }
}
// escapeHtml / _decHtml / _normWs extracted to pap-utils.js (mission 5).
function openArticleBySlug(slug){
  for(var i=0;i<artData.length;i++){if(artData[i].slug===slug){openArticleDetail(i);return;}}
}
function openArticleFromCard(card){
  // Prefer data-slug (language-agnostic) over title matching
  var slug=card.getAttribute('data-slug');
  if(slug){
    for(var j=0;j<artData.length;j++){
      if(artData[j].slug===slug){openArticleDetail(j);return;}
    }
  }
  var titleEl=card.querySelector('.fashion-card-title')||card.querySelector('.art-all-title');
  if(!titleEl){ _papArticleCardFallback(card, slug); return; }
  var raw=titleEl.innerHTML||'';
  var title=_normWs(_decHtml(raw));
  // Match by any language variant in ti18n
  for(var i=0;i<artData.length;i++){
    var at=_normWs(artData[i].t||'');
    if(at===title||at.toUpperCase()===title){openArticleDetail(i);return;}
    if(artData[i].ti18n){
      for(var lk in artData[i].ti18n){
        var lt=_normWs(artData[i].ti18n[lk]||'');
        if(lt===title||lt.toUpperCase()===title){openArticleDetail(i);return;}
      }
    }
  }
  for(var i=0;i<artData.length;i++){
    var at=_normWs(artData[i].t||'');
    if(at.length>3&&title.length>3&&(at.indexOf(title)===0||title.indexOf(at)===0)){openArticleDetail(i);return;}
  }
  // 2026-07 — 매칭 전부 실패 시(카드가 artData 보다 최신인 레이스 등)
  // 조용히 죽지 않고 SSR 기사 페이지로 직접 이동. 모든 기사에 /article/<slug>
  // SSR 이 존재하므로 클릭이 절대 무반응이 되지 않는다.
  _papArticleCardFallback(card, slug);
}
function _papArticleCardFallback(card, slug){
  var href=card.getAttribute && card.getAttribute('href');
  if(href && href!=='#'){ window.location.href=href; return; }
  if(slug){ window.location.href='/article/'+encodeURIComponent(slug); }
}
// QA #283 — 슬라이드 블록의 좌우 네비 버튼 클릭 핸들러.
// 현재 가장 가운데 보이는 figure를 찾고, dir(±1)만큼 떨어진 figure로
// 부드럽게 scroll. block 내부의 .article-slide-track + figure들 사용.
function _papSlideNav(btn, dir){
  var block = btn && btn.closest && btn.closest('.article-slide-block');
  if(!block) return;
  var track = block.querySelector('.article-slide-track');
  if(!track) return;
  var figures = block.querySelectorAll('.article-slide-track > figure');
  if(!figures.length) return;
  // 현재 view 중심 기준 가장 가까운 figure 인덱스
  var center = track.scrollLeft + track.clientWidth / 2;
  var current = 0, minDist = Infinity;
  for(var i = 0; i < figures.length; i++){
    var f = figures[i];
    var fc = f.offsetLeft + f.offsetWidth / 2;
    var d = Math.abs(fc - center);
    if(d < minDist){ minDist = d; current = i; }
  }
  var target = Math.max(0, Math.min(figures.length - 1, current + dir));
  var tgt = figures[target];
  if(tgt){
    var left = tgt.offsetLeft - (track.clientWidth - tgt.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }
}

// QA #283 — article overlay 본문이 렌더된 직후 호출. 모든
// .article-slide-block에 대해:
//   - 스크롤 이벤트 listener 등록 (카운터 + 좌우 버튼 opacity 동기화)
//   - 초기 카운터 표시 (1 / N)
function _papInitSlideBlocks(root){
  var scope = root || document;
  var blocks = scope.querySelectorAll ? scope.querySelectorAll('.article-slide-block') : [];
  blocks.forEach(function(block){
    if(block.dataset.slideInit === '1') return;
    block.dataset.slideInit = '1';
    var track = block.querySelector('.article-slide-track');
    var figures = block.querySelectorAll('.article-slide-track > figure');
    var counter = block.querySelector('.slide-counter');
    var prevBtn = block.querySelector('.slide-prev');
    var nextBtn = block.querySelector('.slide-next');
    var total = figures.length;
    if(!track || !total) return;

    function update(){
      var center = track.scrollLeft + track.clientWidth / 2;
      var current = 0, minDist = Infinity;
      for(var i = 0; i < figures.length; i++){
        var f = figures[i];
        var fc = f.offsetLeft + f.offsetWidth / 2;
        var d = Math.abs(fc - center);
        if(d < minDist){ minDist = d; current = i; }
      }
      if(counter) counter.textContent = (current + 1) + ' / ' + total;
      if(prevBtn) prevBtn.style.opacity = current === 0 ? '.3' : '1';
      if(nextBtn) nextBtn.style.opacity = current === total - 1 ? '.3' : '1';
    }

    var raf = 0;
    track.addEventListener('scroll', function(){
      if(raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    }, { passive: true });
    // 초기 1회
    update();
  });
}

// QA #201 — block array → semantic HTML for the SPA article overlay.
// Mirrors the admin editor's four block types so what the editor sees
// is what the reader gets:
//   text    → <p>
//   image   → <figure><img><figcaption>caption</figcaption></figure>
//   quote   → <blockquote>
//   video   → embedded YouTube/Vimeo iframe (with a graceful URL fallback)
// Anything else (unknown type) is rendered as escaped plain text so
// unknown content never silently disappears.
function _renderArticleBlocks(blocks){
  if(!Array.isArray(blocks) || !blocks.length) return '';
  var html = '';
  blocks.forEach(function(b){
    if(!b || typeof b !== 'object') return;
    var t = b.type || 'text';
    var content = (b.content || '').toString();
    var url = (b.url || '').toString();

    if(t === 'text'){
      // Split on blank lines so multi-paragraph blocks render correctly,
      // but escape so admin text never injects markup unintentionally.
      // QA #282 — paragraph 간격 + line-height 확장 (기사 가독성).
      var paragraphs = content.split(/\n\n+/).map(function(p){
        // Single newlines inside a paragraph become <br>.
        return '<p style="margin:0 0 22px;line-height:1.9">' +
          escapeHtml(p).replace(/\n/g, '<br>') +
          '</p>';
      }).join('');
      html += paragraphs;
    } else if(t === 'image'){
      if(!url) return; // skip blocks that lost their upload
      // QA #282 — 이미지 블록 위/아래 여백 확대 + 캡션 line-height 보강.
      html += '<figure style="margin:36px 0">'
        + '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(content) + '" loading="lazy" style="width:100%;display:block;border-radius:2px" onerror="edImgError && edImgError(this)">'
        + (content ? '<figcaption style="margin-top:12px;font-size:12px;color:#888;text-align:center;letter-spacing:.04em;line-height:1.6">' + escapeHtml(content) + '</figcaption>' : '')
        + '</figure>';
    } else if(t === 'quote'){
      // QA #201 — show attribution under the quote when it's provided.
      // QA #282 — 인용구 위/아래 여백 + 내부 padding 확대 + 본문 폰트 크기 매칭.
      var source = (b.source || '').toString();
      html += '<blockquote style="margin:36px 0;padding:20px 26px;border-left:3px solid #999;font-style:italic;color:#ddd;font-size:16px;line-height:1.85">'
        + escapeHtml(content)
        + (source ? '<footer style="margin-top:14px;font-size:11px;color:#888;font-style:normal;text-align:right">— ' + escapeHtml(source) + '</footer>' : '')
        + '</blockquote>';
    } else if(t === 'video'){
      // Reuse the normaliseEmbedUrl helper when available so we accept
      // the same set of YouTube formats the film admin already vets.
      var embed = null;
      var src = content || url;
      try {
        if(typeof normaliseEmbedUrl === 'function') embed = normaliseEmbedUrl(src);
      } catch(_){ embed = null; }
      if(embed && embed.src){
        // QA #282 — video iframe 위/아래 여백 확대.
        html += '<div style="margin:36px 0;position:relative;padding-bottom:56.25%;height:0;overflow:hidden">'
          + '<iframe src="' + escapeHtml((typeof appendAutoplayParams==='function'?appendAutoplayParams(embed.src,embed.provider):embed.src)) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>'
          + '</div>';
      } else if(src){
        // Surface the raw URL as a clickable fallback rather than dropping
        // the block silently. This makes broken video entries obvious in QA.
        html += '<p style="margin:36px 0;font-size:12px"><a href="' + escapeHtml(src) + '" target="_blank" rel="noopener" style="color:#aaa">' + escapeHtml(src) + '</a></p>';
      }
    } else if(t === 'videogroup'){
      // QA #281 Phase C — 여러 YouTube/Vimeo 영상을 세로로 쌓아 렌더.
      // 각 영상은 normaliseEmbedUrl로 정규화된 iframe + 캡션.
      var vids = Array.isArray(b.videos) ? b.videos : [];
      if(!vids.length) return;
      // QA #282 — 영상 그룹 블록도 동일한 36px 외곽 + 내부 24px gap.
      html += '<div style="margin:36px 0;display:flex;flex-direction:column;gap:24px">';
      vids.forEach(function(v){
        if(!v || !v.url) return;
        var vembed = null;
        try {
          if(typeof normaliseEmbedUrl === 'function') vembed = normaliseEmbedUrl(v.url);
        } catch(_){ vembed = null; }
        if(vembed && vembed.src){
          html += '<figure style="margin:0">'
            + '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden">'
            + '<iframe src="' + escapeHtml(vembed.src) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>'
            + '</div>'
            + (v.caption ? '<figcaption style="margin-top:6px;font-size:11px;color:#888;text-align:center;letter-spacing:.04em">' + escapeHtml(v.caption) + '</figcaption>' : '')
            + '</figure>';
        } else {
          html += '<p style="margin:0;font-size:12px"><a href="' + escapeHtml(v.url) + '" target="_blank" rel="noopener" style="color:#aaa">' + escapeHtml(v.url) + '</a></p>';
        }
      });
      html += '</div>';
    } else if(t === 'gallery'){
      // QA #281 Phase B — gallery block: responsive grid (auto-fill, 2~3 columns).
      // Each cell shows the image full-bleed with an optional caption underneath.
      var galImgs = Array.isArray(b.images) ? b.images : [];
      if(!galImgs.length) return;
      // QA #288 — 패션/아트 콘텐츠에 맞게 변경:
      //   • 데스크탑: 2열 (한 줄에 2개)
      //   • 모바일 (≤640px): 1열로 자동 전환 (CSS 미디어쿼리)
      //   • 비율: 4:5 (세로 화보 비율) — 1:1보다 크롭 최소화
      var galId = 'gal-' + Math.random().toString(36).slice(2, 8);
      html += '<div class="article-gallery-block" data-gal-id="' + galId + '" style="margin:36px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px">';
      galImgs.forEach(function(im){
        if(!im || !im.url) return;
        html += '<figure style="margin:0">'
          + '<img src="' + escapeHtml(im.url) + '" alt="' + escapeHtml(im.caption || '') + '" loading="lazy" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:2px;cursor:zoom-in" onerror="edImgError && edImgError(this)">'
          + (im.caption ? '<figcaption style="margin-top:8px;font-size:11px;color:#888;text-align:center;line-height:1.5">' + escapeHtml(im.caption) + '</figcaption>' : '')
          + '</figure>';
      });
      html += '</div>';
    } else if(t === 'slide'){
      // QA #281 Phase B + QA #283 — slide carousel:
      //   - mobile: native swipe (CSS scroll-snap, momentum)
      //   - desktop: ◀ ▶ 좌우 네비 버튼 → 다음/이전 슬라이드로 부드럽게 이동
      //   - 인디케이터: "3 / 5" 카운터 (스크롤에 맞춰 자동 갱신)
      var slideImgs = Array.isArray(b.images) ? b.images : [];
      if(!slideImgs.length) return;
      var sid = 'slide-' + Math.random().toString(36).slice(2, 8);
      html += '<div class="article-slide-block" data-slide-id="' + sid + '" data-total="' + slideImgs.length + '" style="margin:36px 0;position:relative">';
      // 좌우 네비 버튼. 첫/마지막 슬라이드에서 opacity 감소.
      html += '<button class="slide-nav-btn slide-prev" type="button" aria-label="이전 이미지" onclick="_papSlideNav(this,-1)" style="position:absolute;top:calc(50% - 30px);left:8px;z-index:5;width:40px;height:40px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:.3;transition:opacity .2s">‹</button>';
      html += '<button class="slide-nav-btn slide-next" type="button" aria-label="다음 이미지" onclick="_papSlideNav(this,1)" style="position:absolute;top:calc(50% - 30px);right:8px;z-index:5;width:40px;height:40px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:1;transition:opacity .2s">›</button>';
      html += '<div class="article-slide-track" style="display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:8px;-webkit-overflow-scrolling:touch">';
      slideImgs.forEach(function(im){
        if(!im || !im.url) return;
        // QA #289 — 슬라이드 이미지도 갤러리와 동일한 4:5 비율로 통일.
        // max-height 제거 + aspect-ratio:4/5 명시 → 패션 화보 원본 비율에 가장 가깝게.
        html += '<figure style="margin:0;flex:0 0 88%;scroll-snap-align:center">'
          + '<img src="' + escapeHtml(im.url) + '" alt="' + escapeHtml(im.caption || '') + '" loading="lazy" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:2px;cursor:zoom-in" onerror="edImgError && edImgError(this)">'
          + (im.caption ? '<figcaption style="margin-top:8px;font-size:11px;color:#888;text-align:center;letter-spacing:.04em;line-height:1.6">' + escapeHtml(im.caption) + '</figcaption>' : '')
          + '</figure>';
      });
      html += '</div>';
      // 카운터 (n / total). 스와이프/버튼 둘 다에 의해 갱신됨.
      html += '<div class="slide-indicator" style="display:flex;justify-content:center;align-items:center;gap:6px;margin-top:14px">'
        + '<span class="slide-counter" style="font-size:11px;color:#aaa;letter-spacing:.12em;font-variant-numeric:tabular-nums">1 / ' + slideImgs.length + '</span>'
        + '</div>';
      html += '</div>';
    } else {
      // Unknown type — render escaped so nothing ever vanishes silently.
      // QA #282 — margin/line-height 보강.
      html += '<p style="margin:0 0 22px;line-height:1.9">' + escapeHtml(content) + '</p>';
    }
  });
  return html;
}

// 허브-스포크 퍼널 (2026-07) — 기사 카테고리에 맞는 PAP 니치 계정을
// 메인(@pap_magazine)과 나란히 노출해 이중 팔로우를 유도한다.
function _papNicheIg(cat){
  var c=String(cat||'').toLowerCase();
  if(c.indexOf('beauty')>-1) return 'papbeauty_';
  if(c.indexOf('fashion')>-1) return 'papfashion_';
  if(c.indexOf('news')>-1||c.indexOf('celeb')>-1||c.indexOf('music')>-1) return 'pap_celeb';
  if(c.indexOf('art')>-1) return 'papstudios_';
  if(c.indexOf('culture')>-1||c.indexOf('life')>-1||c.indexOf('trend')>-1) return 'pap_trends';
  return null;
}

function _renderArticleDetail(a,det){
  // #1 (2026-07) — 릴스/영상 게시물 재생.
  // 릴스 연동 기사는 대부분 원본 mp4 가 수집되지 않고(예: 49건 중 46건 videos 빈값)
  // permalink 와 썸네일만 있다. 이 경우 히어로에 정지 썸네일 대신 인스타그램
  // 임베드(재생 가능)를 노출한다. mp4(videos)가 있으면 기존 <video>(갤러리)가
  // 처리하므로 히어로는 썸네일 유지. 하단 CTA 의 중복 임베드는 제거(아래).
  var _heroImg=document.getElementById('artDetailImg');
  var _heroWrap=_heroImg?_heroImg.parentNode:null;
  var _artEmbeddable=!!(a.ig && /instagram\.com\/(p|reel|tv)\//.test(String(a.ig)));
  var _artHasVideo=Array.isArray(a.videos)&&a.videos.length>0;
  if(_heroWrap){var _oldHero=_heroWrap.querySelector('.art-hero-ig');if(_oldHero)_oldHero.remove();}
  if(_artEmbeddable && !_artHasVideo && _heroWrap){
    if(_heroImg) _heroImg.style.display='none';
    var _hp=String(a.ig).split('?')[0]; if(!/\/$/.test(_hp)) _hp+='/';
    _heroWrap.insertAdjacentHTML('beforeend',
      '<div class="art-hero-ig" style="max-width:420px;margin:0 auto;background:#000">'
      +'<blockquote class="instagram-media" data-instgrm-permalink="'+_hp.replace(/"/g,'&quot;')+'" data-instgrm-version="14" style="background:#000;border:0;margin:0 auto;max-width:420px;min-width:280px;width:100%"></blockquote>'
      +'</div>');
    if(typeof _papLoadIgEmbed==='function'){try{_papLoadIgEmbed();}catch(_){}}
  } else if(_heroImg){
    _heroImg.style.display='block';
    _heroImg.src=a.img||a.th;
  }
  // 참여 증폭 2.0 (2026-07) — 원본 IG 게시물을 링크가 아니라 '임베드'로
  // 페이지 안에 직접 띄운다. 게시물이 눈앞에 보이면 좋아요·저장이
  // 한 클릭 거리로 줄어든다. 임베드 불가 URL(프로필 등)은 기존 링크 CTA만.
  // '친구에게 보내기' 버튼은 모바일에서 카카오톡 포함 네이티브 공유 시트.
  var igCta=document.getElementById('artIgPostCta');
  if(igCta){
    if(a.ig && /instagram\.com/.test(a.ig)){
      var _igSafe=a.ig.replace(/"/g,'&quot;');
      var _permalink=String(a.ig).split('?')[0];
      if(!/\/$/.test(_permalink)) _permalink+='/';
      var _canEmbed=/instagram\.com\/(p|reel|tv)\//.test(_permalink);
      // #1 (2026-07) — 원본 IG 임베드는 히어로로 승격했으므로 하단엔 텍스트 CTA만.
      // IG 유입 전환 (2026-07-10, 도메니코 결정) — '웹에서 읽으세요' 카피 폐기.
      // 인스타그램 유입이 최우선 목표: 주버튼=원본 게시물 열기, 보조=팔로우,
      // 공유는 텍스트 링크로 유지. (이전 '공유만 남김' 결정을 대체한다)
      igCta.innerHTML=
        '<aside style="margin:28px 0 0;padding:26px 24px;border:1px solid rgba(255,255,255,.16);text-align:center">'
        +(function(){
          var _ko=(localStorage.getItem('pap-lang')||'ko')==='ko';
          // IG 유입 계측 (B-2) — 직링크 대신 /api/ig-out 경유로 클릭 로깅
          var _pSafe='/api/ig-out?src=article&to=post&url='+encodeURIComponent(_permalink);
          var _body=_ko
            ? '이 기사의 원본 게시물이 <b style="color:#fff">인스타그램</b>에 있습니다.<br>좋아요·저장하고, 매일 공개되는 새 에디토리얼을 가장 먼저 만나보세요.'
            : 'The original post lives on <b style="color:#fff">Instagram</b>.<br>Like &amp; save it — and catch new editorials there first, every day.';
          var _view=_ko ? '인스타그램에서 보기 ↗' : 'View on Instagram ↗';
          var _share=_ko ? '이 기사 공유' : 'Share this story';
          return '<div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#999;margin-bottom:10px">On Instagram</div>'
            +'<div style="font-size:13.5px;line-height:1.7;color:#ddd;margin-bottom:16px">'+_body+'</div>'
            +'<a href="'+_pSafe+'" target="_blank" rel="noopener" style="display:inline-block;margin:4px 5px 0;background:#fff;color:#000;padding:12px 26px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none">'+_view+'</a>'
            +'<a href="/api/ig-out?src=article&to=profile&url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" target="_blank" rel="noopener" style="display:inline-block;margin:4px 5px 0;background:transparent;color:#ddd;border:1px solid rgba(255,255,255,.28);padding:12px 22px;font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-decoration:none">Follow @pap_magazine</a>'
            +'<div style="margin-top:14px"><button onclick="_papShareArticle()" style="background:none;border:none;color:#888;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;text-decoration:underline;text-underline-offset:3px">'+_share+' ↗</button></div>';
          })()
        +'</aside>';
      igCta.style.display='';
      if(_canEmbed) _papLoadIgEmbed();
    } else { igCta.innerHTML=''; igCta.style.display='none'; }
  }
  // 2026-07 — 원본 게시물 CTA 와 팔로우 깔때기의 역할 중복 해소:
  // IG 소스가 있으면(위 박스에 Follow 포함) 아래 깔때기는 숨긴다.
  var funnelEl=document.getElementById('artIgFunnel');
  if(funnelEl){
    funnelEl.style.display=(a.ig && /instagram\.com/.test(a.ig)) ? 'none' : '';
    // 허브-스포크: 카테고리 니치 계정 버튼 + 네트워크 링크 (기사마다 갱신)
    var _nn=_papNicheIg(a.cat);
    var _nEl=funnelEl.querySelector('[data-niche-follow]');
    if(_nn){
      if(!_nEl){
        _nEl=document.createElement('a');
        _nEl.setAttribute('data-niche-follow','1');
        _nEl.target='_blank'; _nEl.rel='noopener';
        _nEl.style.cssText='display:inline-block;margin:10px 0 0 10px;background:transparent;color:#bbb;border:1px solid rgba(255,255,255,.22);padding:12px 24px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;text-decoration:none';
        funnelEl.appendChild(_nEl);
      }
      _nEl.href='/api/ig-out?src=article&to=profile&url='+encodeURIComponent('https://www.instagram.com/'+_nn+'/');
      _nEl.textContent='+ @'+_nn;
      _nEl.style.display='';
    } else if(_nEl){ _nEl.style.display='none'; }
    if(!funnelEl.querySelector('[data-network-link]')){
      var _net=document.createElement('div');
      _net.setAttribute('data-network-link','1');
      _net.style.cssText='margin-top:14px;font-size:11px;letter-spacing:.08em';
      _net.innerHTML='<a href="/network" style="color:#888;text-decoration:underline">패션·뷰티·셀럽·아트 — PAP 인스타그램 네트워크 전체 보기 →</a>';
      funnelEl.appendChild(_net);
    }
  }
  // Use localized title/sub if available
  var _curLang=(typeof lang!=='undefined'?lang:(localStorage.getItem('pap-lang')||'ko'));
  var _locTitle=(a.ti18n && (a.ti18n[_curLang]||a.ti18n.en))||a.t||'';
  var _locSub=(a.subi18n && (a.subi18n[_curLang]||a.subi18n.en))||a.sub||'';
  document.getElementById('artDetailTitle').textContent=_locTitle;
  document.getElementById('artDetailCat').textContent=(a.cat||'ARTICLE')+' · '+(a.d||'');
  document.getElementById('artDetailSub').textContent=_locSub;
  var descEl=document.getElementById('artDetailDesc');
  if(descEl){
    // QA #201 — render block-structured articles (admin v2) first.
    // If `a.blocks` was parsed by apiArticleToLocal, walk it and emit
    // semantic markup per block type. Otherwise fall back to the
    // legacy raw-HTML / raw-text path so older articles still render.
    if(Array.isArray(a.blocks) && a.blocks.length){
      descEl.innerHTML = _renderArticleBlocks(a.blocks);
      descEl.style.display='';
      // QA #283 — 슬라이드 블록 좌우 네비 + 카운터 활성화.
      try { _papInitSlideBlocks(descEl); } catch(_){}
    } else if(a.desc){
      if(a.desc.indexOf('<')!==-1&&a.desc.indexOf('>')!==-1){
        descEl.innerHTML=a.desc;
      } else {
        // QA #282 — legacy plain-text fallback도 동일한 paragraph spacing.
        descEl.innerHTML=a.desc.split('\n').filter(function(p){return p.trim();}).map(function(p){return '<p style="margin:0 0 22px;line-height:1.9">'+escapeHtml(p)+'</p>';}).join('');
      }
      descEl.style.display='';
    } else { descEl.innerHTML='';descEl.style.display='none'; }
  }
  var creditsEl=document.getElementById('artDetailCredits');
  if(det&&det.credits&&det.credits.length){
    creditsEl.innerHTML=det.credits.map(function(c){
      var handles=(c.h||[]).map(function(h){var u=h.replace('@','');return '<a href="https://www.instagram.com/'+u+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">'+h+'</a>';}).join('  ');
      return '<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">'+c.r+'</span><br>'+handles+'</div>';
    }).join('');
    if(det.fashion&&det.fashion.length){
      creditsEl.innerHTML+='<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Fashion</span><br>'+det.fashion.map(function(f){var u=f.replace('@','');return '<a href="https://www.instagram.com/'+u+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">'+f+'</a>';}).join('  ')+'</div>';
    }
    creditsEl.style.display='';
  } else if(a.cr&&a.cr.length){
    creditsEl.innerHTML=a.cr.map(function(c){
      var people=(c.p||'').split(',').map(function(p){p=p.trim();return p?'<a href="https://www.instagram.com/'+p+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">@'+p+'</a>':'';}).filter(Boolean).join(', ');
      return '<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">'+escapeHtml(c.r)+'</span><br>'+people+'</div>';
    }).join('');
    creditsEl.style.display='';
  } else { creditsEl.style.display='none'; }
  var tagsEl=document.getElementById('artDetailTags');
  if(a.tags){
    var tagArr=Array.isArray(a.tags)?a.tags:(typeof a.tags==='string'?a.tags.split(','):[]);
    // QA #326 — Unified tag search. Route the click to /search?tag=<value>
    // which surfaces BOTH editorials + articles carrying that tag, so
    // discovery isn't limited to one content type. Previous /articles?tag=
    // filtered only articles and the user reported dead-end tag clicks.
    tagsEl.innerHTML=tagArr.map(function(t){
      var tag = (typeof t === 'string' ? t.trim() : String(t));
      if(!tag) return '';
      return '<a class="art-tag-chip" href="/search?tag=' +
        encodeURIComponent(tag) + '">#' + escapeHtml(tag) + '</a>';
    }).join('');
    tagsEl.style.display='';
  } else { tagsEl.style.display='none'; }
  var galEl=document.getElementById('artDetailGallery');
  if(galEl){
    var galImgs=(det&&det.images&&det.images.length>0)?det.images:(a.gallery&&a.gallery.length>0?a.gallery:null);
    // 2026-07 — 히어로(artDetailImg)로 이미 표시된 첫 장은 갤러리에서 제외
    // (IG 수집 기사는 gallery[0] == thumbnail 이라 중복으로 보였다)
    if(galImgs){
      var _heroSrc=a.img||a.th||'';
      galImgs=galImgs.filter(function(u){return u && u!==_heroSrc;});
      if(!galImgs.length) galImgs=null;
    }
    // 2026-07 — 릴스/영상 게시물: 영구 보관된 영상을 갤러리 상단에 전체 폭
    // 플레이어로 렌더 (섬네일만 보이던 문제 해소).
    var vids=(a.videos&&a.videos.length>0)?a.videos:[];
    // 사용자 요청 — 재생 버튼 없이 자동 재생. autoplay+muted+playsinline+loop 조합 필수.
    var vidHtml=vids.map(function(url){return '<div style="grid-column:1/-1;overflow:hidden;border-radius:2px;background:#000"><video src="'+url+'" autoplay muted loop playsinline controls preload="metadata" style="width:100%;display:block;max-height:80vh"></video></div>';}).join('');
    if(galImgs||vids.length){
      galEl.innerHTML=vidHtml+(galImgs?galImgs.map(function(url){return '<div style="overflow:hidden;border-radius:2px;background:#111"><img src="'+url+'" alt="'+escapeHtml(a.t)+'" loading="lazy" style="width:100%;display:block" onerror="edImgError(this)"></div>';}).join(''):'');
      galEl.style.display='grid';
    } else { galEl.innerHTML='';galEl.style.display='none'; }
  }
  var linkEl=document.getElementById('artDetailLink');
  if(linkEl){ linkEl.style.display='none'; }
  // Social: comments
  var socialSlot=document.getElementById('artSocialSlot');
  if(socialSlot && typeof PAPSocial!=='undefined'){
    PAPSocial.renderArticleSocial(socialSlot, a.slug||a.t, a.t);
  }
}
/* PAP API fetch removed - using local gallery data */
function openArticleDetail(idx){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openArticleDetailInner(idx); });
    return;
  }
  _openArticleDetailInner(idx);
}
function _openArticleDetailInner(idx){
  // QA #239 v2 — close any other open overlay first so article detail
  // doesn't stack on top of editorial / film / list overlays.
  try { if(typeof _papCloseOtherOverlays === 'function') _papCloseOtherOverlays('artDetailOverlay'); } catch(_){}
  var a=artData[idx];if(!a) return;
  var overlay=document.getElementById('artDetailOverlay');
  if(!overlay) return;
  var det=null;
  if(typeof edDetails!=='undefined'){
    det=edDetails[a.t];
    if(!det){var tLow=a.t.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===tLow){det=edDetails[key];break;}}}
  }
  // QA #226 — fallback content fetch.
  // The list endpoint sometimes returns a row without `content` (older
  // cache entries, future projection changes, articles whose content
  // wasn't yet on the CDN). When the overlay would otherwise render as
  // "hero image + empty body", we fire a per-article GET, re-parse the
  // blocks the same way apiArticleToLocal does, and re-render once it
  // resolves. The first paint still happens immediately so the user
  // never stares at a blank overlay.
  var hasBlocks = Array.isArray(a.blocks) && a.blocks.length > 0;
  var hasDesc   = !!(a.desc && String(a.desc).trim());
  if(!hasBlocks && !hasDesc && a._api_id){
    var _token = '';
    try { _token = localStorage.getItem('pap-token') || ''; } catch(_){}
    var _headers = {};
    if(_token) _headers['Authorization'] = 'Bearer ' + _token;
    fetch('/api/articles/' + encodeURIComponent(a._api_id), {
      headers: _headers,
      credentials: 'include'
    })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      var fullA = j && (j.data || j.article);
      if(!fullA) return;
      var raw = fullA.content || '';
      var parsed = null;
      if(typeof raw === 'string' && raw){
        try {
          var maybe = JSON.parse(raw);
          if(Array.isArray(maybe)){
            parsed = maybe.map(function(b){
              if(!b || typeof b !== 'object') return { type:'text', content: String(b || '') };
              var out = Object.assign({}, b);
              out.type = b.type || 'text';
              out.content = typeof b.content === 'string' ? b.content : '';
              out.url = b.url || '';
              return out;
            });
          }
        } catch(_){}
      }
      if(parsed && parsed.length){
        a.blocks = parsed;
        a.desc = '';
      } else if(raw) {
        a.desc = String(raw);
      }
      _renderArticleDetail(a, det);
    })
    .catch(function(){});
  }

  _renderArticleDetail(a,det);
  overlay.classList.add('active');
  overlay.scrollTop=0;
  document.body.style.overflow='hidden';
  
  // Push state for back button.
  // QA #166 — clean URLs: /article/<slug> instead of #article/<slug>.
  // Articles already carried a slug (apiArticleToLocal preserved it);
  // now we put it in the path proper so Vercel's SSR rewrite catches
  // direct refreshes/shares on the same URL.
  try{
    var _aSlug = a.slug || _articleTitleToSlug(a.t || '');
    var _apath = '/article/' + _aSlug;
    var _aState = {article:true, idx:idx, slug:_aSlug, title:a.t||''};
    if(window.location.pathname === _apath){
      history.replaceState(_aState, '', _apath);
    }else{
      history.pushState(_aState, '', _apath);
    }
  }catch(e){}
}

// QA #166 — title → URL slug fallback for legacy articles missing a slug.
function _articleTitleToSlug(t){
  return String(t||'')
    .toLowerCase()
    .replace(/['"`]+/g, '')
    .replace(/[^\w\s가-힣-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
function closeArticleDetail(skipHistory){
  var overlay=document.getElementById('artDetailOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    // Check if articles list overlay is open underneath
    var artAll=document.getElementById('artAllOverlay');
    if(artAll&&artAll.classList.contains('active')){
      document.body.style.overflow='hidden';
    } else {
      document.body.style.overflow='';
    }
    if(!skipHistory){try{history.back();}catch(e){}}
  }
}

// ======== IG 임베드 / 공유 헬퍼 (참여 증폭 2.0, 2026-07) ========
// embed.js 는 최초 1회만 삽입. 이미 로드돼 있으면 새 blockquote 재처리만.
function _papLoadIgEmbed(){
  try{
    if(window.instgrm && window.instgrm.Embeds && window.instgrm.Embeds.process){
      window.instgrm.Embeds.process(); return;
    }
    if(document.getElementById('pap-ig-embed-js')) return;
    var s=document.createElement('script');
    s.id='pap-ig-embed-js'; s.async=true;
    s.src='https://www.instagram.com/embed.js';
    document.body.appendChild(s);
  }catch(_){}
}
// 네이티브 공유 시트 (모바일에서 카카오톡·인스타 DM 포함). 미지원 브라우저는
// 링크 복사로 폴백 — 복사한 링크를 카톡/DM에 붙여넣는 한국식 공유 흐름.
window._papShareArticle=function(){
  try{
    var url=window.location.href;
    var tEl=document.getElementById('artDetailTitle');
    var title=(tEl&&tEl.textContent)||document.title;
    if(navigator.share){ navigator.share({title:title,url:url}).catch(function(){}); return; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(function(){
        alert('링크가 복사되었습니다. 카카오톡이나 DM에 붙여넣어 공유해보세요.');
      }).catch(function(){});
    }
  }catch(_){}
};

// ======== ARTICLE DATABASE slot ========
// ======== ARTICLE DATABASE ========
var artData=[];

