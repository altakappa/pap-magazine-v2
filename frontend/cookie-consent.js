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

  /* ── banner HTML ─────────────────────────────────── */
  function showBanner(){
    if(document.getElementById('cookieConsent')) return;
    var wrap=document.createElement('div');
    wrap.id='cookieConsent';
    wrap.setAttribute('role','dialog');
    wrap.setAttribute('aria-label','Cookie consent');
    wrap.innerHTML=
      '<div class="cc-inner">'+
        '<p class="cc-text">We use cookies and analytics (Google Analytics) to improve your experience. '+
        'You can accept or reject non-essential cookies.</p>'+
        '<div class="cc-text cc-text-ko">본 웹사이트는 사용자 경험 향상을 위해 쿠키 및 분석 도구(Google Analytics)를 사용합니다.</div>'+
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
