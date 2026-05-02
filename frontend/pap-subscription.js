// PAP Magazine — Subscription harness (extracted from pap-app.js per
// HARNESS_CHECKLIST.md mission 6).
//
// Owns: subscription tier checks, interstitial-ad subsystem (brand ad +
// premium upsell fallback), navigation gate, and image right-click protection
// (download permission gate).
//
// Public surface (consumed cross-script via globals):
//   isPremium(), isStandardOrAbove()       tier probes (also called from
//                                          inline copies in static HTMLs as a
//                                          fallback before this file loads)
//   showPremiumInterstitial(cb)            session-throttled ad / upsell
//   navigateWithInterstitial(url)          gate + navigate
//
// Dependencies (must be loaded before this file):
//   - pap-utils.js → lockScroll, unlockScroll
//   - pap-auth.js  → isLoggedIn (called by isPremium / isStandardOrAbove)
// Dependencies that resolve at CALL time (so load order doesn't matter):
//   - pap-app.js   → isBetaActive (still in pap-app.js — borderline shared
//                    flag; tier checks call it as a global at click time)
//
// 9-language interstitial + image-protect dictionaries now live in
// pap-i18n.js (mission 10 i18n consolidation final pass) as
// _interstitialSkipTexts, _interstitialPremTexts, _interstitialUpsellTexts,
// _imageProtectMsg. Reads them as bare globals.

// ======== TIER CHECKS ========
// During beta we treat any logged-in user (free / standard / premium) as
// having full access — non-logged-in visitors must sign up. After beta
// these checks resume tier-strict semantics from pap-user.subscription.
function isPremium(){
  try{
    if(isBetaActive()){
      return isLoggedIn();
    }
    var u=localStorage.getItem('pap-user');if(!u)return false;
    var user=JSON.parse(u);return user&&user.subscription==='premium';
  }catch(e){return false;}
}
function isStandardOrAbove(){
  try{
    if(isBetaActive()){
      return isLoggedIn();
    }
    var u=localStorage.getItem('pap-user');if(!u)return false;
    var user=JSON.parse(u);return user&&(user.subscription==='standard'||user.subscription==='premium');
  }catch(e){return false;}
}

// ======== INTERSTITIAL AD + PREMIUM UPSELL ========
var _interstitialCount = 0;   // 실제 광고 노출 횟수
var _navClickCount = 0;       // 에디토리얼 클릭 횟수
var _INTERSTITIAL_MAX = 5;    // 세션당 최대 광고 노출
var _INTERSTITIAL_EVERY = 3;  // N번째 클릭마다 광고 노출 (3,6,9,12...)

// ---- BRAND AD CONFIGURATION ----
// To add a brand ad, add an object to this array.
// type: 'image' or 'video'
// src: image URL or video URL (mp4/webm)
// poster: (video only) poster image while loading
// link: click-through URL (opens in new tab)
// brand: brand name for "AD · BRAND" label
// duration: seconds before skip is enabled (default 5 for video, 3 for image)
//
// Example:
// { type:'video', src:'https://cdn.example.com/gucci-fw26.mp4', poster:'https://cdn.example.com/gucci-poster.jpg', link:'https://www.gucci.com', brand:'GUCCI', duration:5 }
// { type:'image', src:'https://cdn.example.com/prada-campaign.jpg', link:'https://www.prada.com', brand:'PRADA', duration:3 }
//
// When this array is empty, the premium upsell is shown instead.
//
// NOTE: This array is now hydrated at runtime from /api/ads (managed via the
// admin dashboard → 인터스티셜 광고 관리). The hardcoded entry below is only a
// fallback so the experience never breaks if the API call fails.
var _brandAds = [
  { type:'image', src:'pap-studio-campaign-banner.jpg', link:'https://www.pap-studios.com', brand:'PAP STUDIO', duration:4 }
];

// Fetch the live ads from the backend on first load. Public endpoint, no auth.
(function _loadBrandAdsFromAPI(){
  try{
    var origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    fetch(origin + '/api/ads', { credentials: 'omit' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(j && Array.isArray(j.ads) && j.ads.length){
          _brandAds = j.ads;
        }
      })
      .catch(function(){ /* keep fallback */ });
  }catch(_){ /* keep fallback */ }
})();

function _getNextBrandAd(){
  if(!_brandAds || _brandAds.length === 0) return null;
  // Rotate through ads sequentially per session
  if(typeof _brandAdIdx === 'undefined') _brandAdIdx = 0;
  var ad = _brandAds[_brandAdIdx % _brandAds.length];
  _brandAdIdx++;
  return ad;
}

function showPremiumInterstitial(callback){
  // Skip for standard+ members (ad-free benefit)
  if(isStandardOrAbove()){ if(callback) callback(); return; }
  // Session limit
  if(_interstitialCount >= _INTERSTITIAL_MAX){ if(callback) callback(); return; }
  // Count navigation clicks
  _navClickCount++;
  // Show ad every N clicks (3rd, 6th, 9th...)
  if(_navClickCount % _INTERSTITIAL_EVERY !== 0){ if(callback) callback(); return; }
  _interstitialCount++;

  var brandAd = _getNextBrandAd();
  if(brandAd){
    _showBrandAdInterstitial(brandAd, callback);
  } else {
    _showPremiumUpsellInterstitial(callback);
  }
}

// ---- BRAND AD INTERSTITIAL (image or video) ----
function _showBrandAdInterstitial(ad, callback){
  try{
  var overlay = document.createElement('div');
  overlay.id = 'premiumInterstitial';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;flex-direction:column;opacity:0;transition:opacity .4s;';

  // AD label
  var label = document.createElement('div');
  label.textContent = 'AD' + (ad.brand ? ' · ' + ad.brand : '');
  label.style.cssText = 'position:absolute;top:16px;left:20px;font-size:9px;font-weight:700;letter-spacing:.2em;color:rgba(255,255,255,.35);font-family:Montserrat,sans-serif;z-index:2;';
  overlay.appendChild(label);

  // Media container
  var mediaWrap = document.createElement('div');
  mediaWrap.style.cssText = 'position:relative;max-width:90vw;max-height:75vh;display:flex;align-items:center;justify-content:center;cursor:pointer;';

  var duration = ad.duration || 3;

  if(ad.type === 'video'){
    var video = document.createElement('video');
    video.src = ad.src;
    if(ad.poster) video.poster = ad.poster;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.style.cssText = 'max-width:90vw;max-height:75vh;object-fit:contain;border-radius:2px;';
    mediaWrap.appendChild(video);
  } else {
    var img = document.createElement('img');
    img.src = ad.src;
    img.alt = ad.brand || 'Ad';
    img.style.cssText = 'max-width:90vw;max-height:75vh;object-fit:contain;border-radius:2px;';
    mediaWrap.appendChild(img);
  }

  // Click-through
  if(ad.link){
    mediaWrap.onclick = function(){ window.open(ad.link, '_blank'); };
  }

  overlay.appendChild(mediaWrap);

  // Skip button — labels in pap-i18n.js (_interstitialSkipTexts)
  var lang = localStorage.getItem('pap-lang') || 'ko';
  var skipLabel = _interstitialSkipTexts[lang] || _interstitialSkipTexts.en;

  var skip = document.createElement('button');
  skip.style.cssText = 'position:absolute;bottom:24px;right:24px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.55);font-size:11px;font-weight:600;letter-spacing:.1em;cursor:pointer;font-family:Montserrat,sans-serif;padding:8px 20px;border-radius:2px;transition:all .2s;z-index:2;';
  skip.onmouseover = function(){ this.style.background='rgba(255,255,255,.15)'; this.style.color='rgba(255,255,255,.9)'; };
  skip.onmouseout = function(){ this.style.background='rgba(255,255,255,.1)'; this.style.color='rgba(255,255,255,.55)'; };

  var _countdown = duration;
  var _timer = null;
  skip.textContent = skipLabel + ' (' + _countdown + ')';
  skip.disabled = true;

  function closeAd(){
    if(_timer) clearInterval(_timer);
    if(ad.type === 'video'){ var v=overlay.querySelector('video'); if(v) v.pause(); }
    overlay.style.opacity = '0';
    unlockScroll();
    setTimeout(function(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
    if(callback) callback();
  }

  skip.onclick = function(){ closeAd(); };
  overlay.appendChild(skip);

  // Premium upsell (below skip button area)
  var premWrap = document.createElement('div');
  premWrap.style.cssText = 'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);text-align:center;z-index:2;';

  var premBadge = document.createElement('a');
  premBadge.href = 'subscribe.html';
  // Premium upsell label — in pap-i18n.js (_interstitialPremTexts)
  premBadge.textContent = _interstitialPremTexts[lang] || _interstitialPremTexts.en;
  premBadge.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.05em;color:rgba(255,255,255,.45);text-decoration:none;font-family:Montserrat,sans-serif;transition:all .2s;border-bottom:1px solid rgba(255,255,255,.15);padding-bottom:2px;';
  premBadge.onmouseover = function(){ this.style.color='rgba(255,255,255,.85)'; this.style.borderBottomColor='rgba(255,255,255,.5)'; };
  premBadge.onmouseout = function(){ this.style.color='rgba(255,255,255,.45)'; this.style.borderBottomColor='rgba(255,255,255,.15)'; };
  premWrap.appendChild(premBadge);
  overlay.appendChild(premWrap);

  document.body.appendChild(overlay);
  lockScroll();
  requestAnimationFrame(function(){ overlay.style.opacity = '1'; });

  _timer = setInterval(function(){
    _countdown--;
    if(_countdown > 0){
      skip.textContent = skipLabel + ' (' + _countdown + ')';
    } else {
      clearInterval(_timer);
      skip.textContent = skipLabel;
      skip.disabled = false;
      skip.style.color = 'rgba(255,255,255,.7)';
    }
  }, 1000);
  }catch(e){ console.error('Ad error:',e); unlockScroll(); if(callback) callback(); }
}

// ---- PREMIUM UPSELL INTERSTITIAL (fallback when no brand ads) ----
function _showPremiumUpsellInterstitial(callback){
  try{
  var lang = localStorage.getItem('pap-lang') || 'ko';
  // Upsell labels in pap-i18n.js (_interstitialUpsellTexts).
  var t = _interstitialUpsellTexts[lang] || _interstitialUpsellTexts.en;

  var overlay = document.createElement('div');
  overlay.id = 'premiumInterstitial';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

  var box = document.createElement('div');
  box.style.cssText = 'text-align:center;max-width:420px;padding:48px 32px;';

  // Tag
  var tag = document.createElement('div');
  tag.textContent = t.tag;
  tag.style.cssText = 'font-size:10px;font-weight:800;letter-spacing:.3em;color:rgba(255,255,255,.4);margin-bottom:24px;';

  // Title
  var h = document.createElement('h2');
  h.textContent = t.title;
  h.style.cssText = 'font-size:22px;font-weight:800;letter-spacing:.06em;line-height:1.5;color:#fff;margin-bottom:16px;white-space:pre-line;font-family:Montserrat,sans-serif;';

  // Description
  var desc = document.createElement('p');
  desc.textContent = t.desc;
  desc.style.cssText = 'font-size:12px;color:rgba(255,255,255,.5);line-height:1.9;margin-bottom:32px;white-space:pre-line;font-family:Montserrat,sans-serif;';

  // CTA button
  var btn = document.createElement('a');
  btn.href = 'subscribe.html';
  btn.textContent = t.btn;
  btn.style.cssText = 'display:inline-block;padding:14px 40px;background:#fff;color:#000;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;text-decoration:none;font-family:Montserrat,sans-serif;transition:all .3s;border:1.5px solid #fff;';
  btn.onmouseover = function(){ this.style.background='transparent'; this.style.color='#fff'; };
  btn.onmouseout = function(){ this.style.background='#fff'; this.style.color='#000'; };

  // Skip button
  var skip = document.createElement('button');
  skip.textContent = t.skip;
  skip.style.cssText = 'display:block;margin:16px auto 0;background:none;border:none;color:rgba(255,255,255,.55);font-size:11px;font-weight:600;letter-spacing:.1em;cursor:pointer;font-family:Montserrat,sans-serif;transition:color .2s;padding:8px 16px;';
  skip.onmouseover = function(){ this.style.color='rgba(255,255,255,.9)'; };
  skip.onmouseout = function(){ this.style.color='rgba(255,255,255,.55)'; };

  var _countdown = 3;
  var _timer = null;
  skip.textContent = t.skip + ' (' + _countdown + ')';
  skip.disabled = true;
  skip.style.opacity = '0.4';

  function closeInterstitial(){
    if(_timer) clearInterval(_timer);
    overlay.style.opacity = '0';
    unlockScroll();
    setTimeout(function(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
    if(callback) callback();
  }

  skip.onclick = function(){ closeInterstitial(); };

  box.appendChild(tag);
  box.appendChild(h);
  box.appendChild(desc);
  box.appendChild(btn);
  box.appendChild(skip);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  lockScroll();

  // Fade in
  requestAnimationFrame(function(){ overlay.style.opacity = '1'; });

  // Countdown then enable skip
  _timer = setInterval(function(){
    _countdown--;
    if(_countdown > 0){
      skip.textContent = t.skip + ' (' + _countdown + ')';
    } else {
      clearInterval(_timer);
      skip.textContent = t.skip;
      skip.disabled = false;
      skip.style.opacity = '1';
    }
  }, 1000);
  }catch(e){ console.error('Upsell error:',e); unlockScroll(); if(callback) callback(); }
}

// Navigate to page with interstitial check
function navigateWithInterstitial(url){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ window.location.href=url; });
    return;
  }
  window.location.href=url;
}

// ======== IMAGE RIGHT-CLICK PROTECTION ========
// Only standard & premium subscribers can right-click (download) images
(function(){
  document.addEventListener('contextmenu',function(e){
    var el=e.target;
    if(el.tagName==='IMG' || el.closest('img')){
      if(!isStandardOrAbove()){
        e.preventDefault();
        var toast=document.createElement('div');
        toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:14px 28px;font-size:11px;font-weight:600;letter-spacing:.08em;z-index:99999;font-family:Montserrat,sans-serif;background:#111;color:#fff;border:1px solid #333;text-align:center;';
        var lang=localStorage.getItem('pap-lang')||'ko';
        // Image-protect toast message in pap-i18n.js (_imageProtectMsg).
        toast.textContent=_imageProtectMsg[lang]||_imageProtectMsg.en;
        document.body.appendChild(toast);
        setTimeout(function(){toast.style.opacity='0';toast.style.transition='opacity .3s';setTimeout(function(){toast.remove();},300);},2500);
      }
    }
  });
  document.addEventListener('dragstart',function(e){
    if((e.target.tagName==='IMG') && !isStandardOrAbove()){
      e.preventDefault();
    }
  });
})();
