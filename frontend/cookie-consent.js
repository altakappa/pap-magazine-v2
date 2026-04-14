/* PAP Magazine — Cookie Consent & GA4 Gate
   GDPR/CCPA compliant: GA4 loads ONLY after explicit user consent.
   Consent state stored in localStorage ('pap-cookie-consent').
   Values: 'accepted' | 'rejected' | null (not yet decided)

   Exposes:
     window.papCookieConsent.resolved  — true once user has decided
     window.papCookieConsent.onResolve(fn) — register callback for when consent is decided
     Event 'pap-cookie-resolved' dispatched on document when decided                     */

(function(){
  var GA_ID='G-TPPJGKJXYV';
  var STORAGE_KEY='pap-cookie-consent';

  /* ── public API ────────────────────────────────── */
  var _callbacks=[];
  window.papCookieConsent={
    resolved: false,
    value: null,
    onResolve: function(fn){ if(window.papCookieConsent.resolved) fn(window.papCookieConsent.value); else _callbacks.push(fn); }
  };

  function _fireResolved(val){
    window.papCookieConsent.resolved=true;
    window.papCookieConsent.value=val;
    for(var i=0;i<_callbacks.length;i++) try{_callbacks[i](val);}catch(e){}
    _callbacks=[];
    document.dispatchEvent(new Event('pap-cookie-resolved'));
  }

  /* ── helpers ─────────────────────────────────────── */
  function getConsent(){ try{return localStorage.getItem(STORAGE_KEY);}catch(e){return null;} }
  function setConsent(v){ try{localStorage.setItem(STORAGE_KEY,v);}catch(e){} }

  /* ── load GA4 ────────────────────────────────────── */
  function loadGA4(){
    if(document.getElementById('ga4-script')) return;
    var s=document.createElement('script');
    s.id='ga4-script';
    s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+GA_ID;
    document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];
    function gtag(){window.dataLayer.push(arguments);}
    window.gtag=gtag;
    gtag('js',new Date());
    gtag('config',GA_ID,{anonymize_ip:true});
  }

  /* ── inject styles (self-contained, works on any page) ─── */
  function injectStyles(){
    if(document.getElementById('pap-cc-styles')) return;
    var style=document.createElement('style');
    style.id='pap-cc-styles';
    style.textContent=[
      '#cookieConsent{position:fixed;bottom:0;left:0;right:0;z-index:10000;background:rgba(0,0,0,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:20px 24px;border-top:1px solid rgba(255,255,255,.1);font-family:"Montserrat",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:ccSlideUp .4s ease;box-sizing:border-box}',
      '#cookieConsent *{box-sizing:border-box}',
      '#cookieConsent.cc-hide{animation:ccSlideDown .4s ease forwards}',
      '#cookieConsent .cc-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:24px;flex-wrap:wrap}',
      '#cookieConsent .cc-text-wrap{flex:1;min-width:240px}',
      '#cookieConsent .cc-text{color:rgba(255,255,255,.85);font-size:13px;line-height:1.6;margin:0;padding:0}',
      '#cookieConsent .cc-text-ko{color:rgba(255,255,255,.5);font-size:11px;line-height:1.5;margin-top:4px}',
      '#cookieConsent .cc-actions{display:flex;gap:12px;flex-shrink:0}',
      '#cookieConsent .cc-btn{padding:10px 24px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;border:1.5px solid rgba(255,255,255,.3);cursor:pointer;font-family:"Montserrat",sans-serif;transition:all .25s;border-radius:0;line-height:1}',
      '#cookieConsent .cc-reject{background:transparent;color:rgba(255,255,255,.6)}',
      '#cookieConsent .cc-reject:hover{border-color:rgba(255,255,255,.6);color:#fff}',
      '#cookieConsent .cc-accept{background:#fff;color:#000;border-color:#fff}',
      '#cookieConsent .cc-accept:hover{background:transparent;color:#fff}',
      '@keyframes ccSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}',
      '@keyframes ccSlideDown{from{transform:translateY(0);opacity:1}to{transform:translateY(100%);opacity:0}}',
      '@media(max-width:768px){',
      '  #cookieConsent{padding:16px}',
      '  #cookieConsent .cc-inner{flex-direction:column;text-align:center;gap:14px}',
      '  #cookieConsent .cc-actions{width:100%;justify-content:center}',
      '  #cookieConsent .cc-btn{flex:1;padding:12px 16px;max-width:180px}',
      '  #cookieConsent .cc-text{font-size:12px}',
      '  #cookieConsent .cc-text-ko{font-size:10px}',
      '}'
    ].join('');
    (document.head||document.documentElement).appendChild(style);
  }

  /* ── banner HTML ─────────────────────────────────── */
  function showBanner(){
    if(document.getElementById('cookieConsent')) return;
    injectStyles();
    var wrap=document.createElement('div');
    wrap.id='cookieConsent';
    wrap.setAttribute('role','dialog');
    wrap.setAttribute('aria-label','Cookie consent');
    wrap.innerHTML=
      '<div class="cc-inner">'+
        '<div class="cc-text-wrap">'+
          '<p class="cc-text">We use cookies and analytics (Google Analytics) to improve your experience. You can accept or reject non-essential cookies.</p>'+
          '<p class="cc-text cc-text-ko">본 웹사이트는 사용자 경험 향상을 위해 쿠키 및 분석 도구를 사용합니다.</p>'+
        '</div>'+
        '<div class="cc-actions">'+
          '<button class="cc-btn cc-reject" id="ccReject">Reject / 거부</button>'+
          '<button class="cc-btn cc-accept" id="ccAccept">Accept / 수락</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(wrap);

    document.getElementById('ccAccept').addEventListener('click',function(){
      setConsent('accepted');
      loadGA4();
      closeBanner();
      _fireResolved('accepted');
    });
    document.getElementById('ccReject').addEventListener('click',function(){
      setConsent('rejected');
      closeBanner();
      _fireResolved('rejected');
    });
  }

  function closeBanner(){
    var el=document.getElementById('cookieConsent');
    if(el){ el.classList.add('cc-hide'); setTimeout(function(){el.remove();},400); }
  }

  /* ── init ─────────────────────────────────────────── */
  var consent=getConsent();
  if(consent==='accepted'){
    loadGA4();
    _fireResolved('accepted');
  } else if(consent==='rejected'){
    _fireResolved('rejected');
  } else {
    /* not decided yet — show banner, do NOT auto-dismiss */
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',showBanner);
    }else{
      showBanner();
    }
  }
})();
