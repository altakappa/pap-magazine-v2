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
function closeAllArticles(){
  var overlay=document.getElementById('artAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
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
    if(a.desc){
      if(a.desc.indexOf('<')!==-1&&a.desc.indexOf('>')!==-1){
        descEl.innerHTML=a.desc;
      } else {
        descEl.innerHTML=a.desc.split('\n').filter(function(p){return p.trim();}).map(function(p){return '<p style="margin:0 0 12px">'+escapeHtml(p)+'</p>';}).join('');
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
  var a=artData[idx];if(!a) return;
  var overlay=document.getElementById('artDetailOverlay');
  if(!overlay) return;
  var det=null;
  if(typeof edDetails!=='undefined'){
    det=edDetails[a.t];
    if(!det){var tLow=a.t.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===tLow){det=edDetails[key];break;}}}
  }
  // Check if article needs dynamic content fetch
  
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

