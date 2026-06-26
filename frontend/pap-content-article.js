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
    var card=document.createElement('div');
    card.className='art-all-card';
    card.setAttribute('data-cats',(a.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(){openArticleDetail(i);};
    var dateStr=a.d?a.d.substring(0,10):'';
    card.innerHTML='<div class="art-all-thumb"><img src="'+(a.img||a.th)+'" alt="'+escapeHtml(a.t)+'" loading="lazy" onerror="edImgError(this)"></div><div class="art-all-info"><div class="art-all-cat">'+(a.cat||'ARTICLE').toUpperCase()+' · '+dateStr+'</div><div class="art-all-title">'+escapeHtml(a.t)+'</div>'+(a.sub?'<div class="art-all-sub">'+escapeHtml(a.sub)+'</div>':'')+'</div>';
    grid.appendChild(card);
  });
  count.textContent=artData.length+' ARTICLES';
  // replaceState if user arrived via direct #articles-all nav, else push.
  if(window.location.hash==='#articles-all'){
    history.replaceState({overlay:'articles'},'',window.location.pathname+'#articles-all');
  }else{
    history.pushState({overlay:'articles'},'',window.location.pathname+'#articles-all');
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
  if(!titleEl) return;
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
          + '<iframe src="' + escapeHtml(embed.src) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>'
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
        html += '<figure style="margin:0;flex:0 0 88%;scroll-snap-align:center">'
          + '<img src="' + escapeHtml(im.url) + '" alt="' + escapeHtml(im.caption || '') + '" loading="lazy" style="width:100%;max-height:70vh;object-fit:cover;display:block;border-radius:2px;cursor:zoom-in" onerror="edImgError && edImgError(this)">'
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

function _renderArticleDetail(a,det){
  document.getElementById('artDetailImg').src=a.img||a.th;
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
    // Each hashtag is now a clickable link → /articles.html?tag=<tag>.
    // The articles list page reads the query param and filters its grid
    // to only entries whose .tags include that value, with an active-tag
    // chip rendered at the top so the user knows the filter is on and
    // can clear it. Hover/active styling defined under .art-tag-chip.
    tagsEl.innerHTML=tagArr.map(function(t){
      var tag = (typeof t === 'string' ? t.trim() : String(t));
      if(!tag) return '';
      return '<a class="art-tag-chip" href="articles.html?tag=' +
        encodeURIComponent(tag) + '">#' + escapeHtml(tag) + '</a>';
    }).join('');
    tagsEl.style.display='';
  } else { tagsEl.style.display='none'; }
  var galEl=document.getElementById('artDetailGallery');
  if(galEl){
    var galImgs=(det&&det.images&&det.images.length>0)?det.images:(a.gallery&&a.gallery.length>0?a.gallery:null);
    if(galImgs){
      galEl.innerHTML=galImgs.map(function(url){return '<div style="overflow:hidden;border-radius:2px;background:#111"><img src="'+url+'" alt="'+escapeHtml(a.t)+'" loading="lazy" style="width:100%;display:block" onerror="edImgError(this)"></div>';}).join('');
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

// ======== ARTICLE DATABASE slot ========
// ======== ARTICLE DATABASE ========
var artData=[];

