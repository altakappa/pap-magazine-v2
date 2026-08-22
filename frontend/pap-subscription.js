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
/* 2026-08-21 — 등급만 보고 상태를 안 봤다.
 * me.js 는 subscriptionStatus 를 같이 내려주는데 여기서 쓰지 않아서,
 * 해지·미납 회원이 계속 '광고 없는 콘텐츠'를 받고 있었다.
 * 상태 필드가 아예 없는 옛 세션은 참으로 본다 — 멀쩡한 유료회원에게
 * 갑자기 광고를 띄우는 쪽이 더 나쁘다. 다음 로그인에 정확해진다. */
function _papSubActive(user){
  var st = user && user.subscriptionStatus;
  if(st === undefined || st === null || st === '') return true;
  st = String(st).toLowerCase();
  return st === 'active' || st === 'trialing';
}

function isPremium(){
  try{
    if(isBetaActive()){
      return isLoggedIn();
    }
    var u=localStorage.getItem('pap-user');if(!u)return false;
    var user=JSON.parse(u);return !!(user&&user.subscription==='premium'&&_papSubActive(user));
  }catch(e){return false;}
}
function isStandardOrAbove(){
  try{
    if(isBetaActive()){
      return isLoggedIn();
    }
    var u=localStorage.getItem('pap-user');if(!u)return false;
    var user=JSON.parse(u);return !!(user&&(user.subscription==='standard'||user.subscription==='premium')&&_papSubActive(user));
  }catch(e){return false;}
}

/* 스탠다드가 볼 수 있는 가장 오래된 날짜 — **서버와 같은 규칙이어야 한다**.
 * 볼륨 = 분기. 현재 볼륨 시작에서 2볼륨(6개월) 뒤로.
 * 서버 진실원천: api/_lib/editorialAccess.js 의 standardCutoff().
 * 종전 목록 화면은 setMonth(-6) 짜리 '날짜 롤링 6개월' 이라 서버가 내주는
 * 178편 중 137편만 보여줬다 — 돈 낸 회원에게 41편을 숨기고 있었다.
 * tests/editorial-access.test.js 가 두 구현의 경계값 일치를 못박는다. */
function _papStandardCutoff(now){
  var d = now || new Date();
  var q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q - 6, 1);
}

/* 이 화보를 열면 잠금화면이 뜨는가 — 광고를 붙일지 말지 판단용 (2026-08-21).
 * 광고를 보여준 다음 잠금화면을 띄우는 건 최악의 동선이다. 돈도 안 되고
 * (그 사람은 어차피 못 본다) 기분만 상해서 가입도 안 한다.
 * 목록이 실어주는 required_tier 로 미리 안다. */
function _papWillLock(d){
  try{
    if(typeof isLoggedIn === 'function' && !isLoggedIn()) return true;   // 비회원은 전부 잠김
    var need = (d && d.requiredTier) || '';
    if(!need) return false;              // 모르면 잠그지 않는다 — 최종 판정은 서버가 한다
    if(need === 'free') return false;    // 최신 10편
    if(need === 'standard') return !isStandardOrAbove();
    return !isPremium();                 // premium 전용 (스탠다드에게도 잠긴다)
  }catch(e){ return false; }
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
  // 2026-07-29: pap-studios.com 은 접었다(라이브 404). 스튜디오는 /studio 로 일원화.
  { type:'image', src:'pap-studio-campaign-banner.jpg', link:'/studio', brand:'PAP STUDIO', duration:4 }
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
  premBadge.href = '/subscribe';
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
  btn.href = '/subscribe';
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
