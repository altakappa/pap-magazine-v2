/* PAP Magazine — Cookie Consent & GA4 Gate
   GDPR/CCPA compliant: GA4 loads ONLY after explicit user consent.
   Consent state stored in localStorage ('pap-cookie-consent').
   Values: 'accepted' | 'rejected' | null (not yet decided)

   This popup is INDEPENDENT from all other popups.
   It shows on first visit, stays until user clicks accept/reject.
   State persists via localStorage across all pages.                   */

(function(){
  var GA_ID='G-6Q8H9HEPX7';
  var STORAGE_KEY='pap-cookie-consent';

  /* ── i18n ─────────────────────────────────────────── */
  var I18N={
    ko:{msg:'본 웹사이트는 사용자 경험 향상을 위해 쿠키 및 분석 도구(Google Analytics)를 사용합니다. 비필수 쿠키를 수락하거나 거부하실 수 있습니다.',accept:'수락',reject:'거부'},
    en:{msg:'We use cookies and analytics (Google Analytics) to improve your experience. You can accept or reject non-essential cookies.',accept:'Accept',reject:'Reject'},
    it:{msg:'Utilizziamo cookie e strumenti di analisi (Google Analytics) per migliorare la tua esperienza. Puoi accettare o rifiutare i cookie non essenziali.',accept:'Accetta',reject:'Rifiuta'},
    fr:{msg:"Nous utilisons des cookies et des outils d'analyse (Google Analytics) pour améliorer votre expérience. Vous pouvez accepter ou refuser les cookies non essentiels.",accept:'Accepter',reject:'Refuser'},
    es:{msg:'Utilizamos cookies y herramientas de análisis (Google Analytics) para mejorar tu experiencia. Puedes aceptar o rechazar las cookies no esenciales.',accept:'Aceptar',reject:'Rechazar'},
    ja:{msg:'当ウェブサイトはユーザー体験向上のため、Cookieおよび分析ツール（Google Analytics）を使用しています。非必須Cookieを受け入れるか拒否できます。',accept:'受け入れる',reject:'拒否'},
    zh:{msg:'本网站使用 Cookie 和分析工具（Google Analytics）以提升您的体验。您可以接受或拒绝非必要 Cookie。',accept:'接受',reject:'拒绝'},
    ru:{msg:'Мы используем файлы cookie и аналитику (Google Analytics) для улучшения вашего опыта. Вы можете принять или отклонить необязательные файлы cookie.',accept:'Принять',reject:'Отклонить'}
  };

  /* Read language from pap-geo-lang.js (which runs before this script).
     Falls back to browser detection only if pap-lang is not yet set. */
  function detectLang(){
    var saved=null;
    try{ saved=localStorage.getItem('pap-lang'); }catch(e){}
    if(saved && I18N[saved]) return saved;
    /* fallback: browser/timezone detection */
    var tz=''; try{ tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''; }catch(e){}
    var nav=(navigator.language||navigator.userLanguage||'').toLowerCase();
    if(nav.indexOf('ko')===0||tz.indexOf('Seoul')>-1) return 'ko';
    if(nav.indexOf('ja')===0||tz.indexOf('Tokyo')>-1) return 'ja';
    if(nav.indexOf('zh')===0||tz.indexOf('Shanghai')>-1||tz.indexOf('Beijing')>-1||tz.indexOf('Hong_Kong')>-1||tz.indexOf('Taipei')>-1) return 'zh';
    if(nav.indexOf('it')===0||tz.indexOf('Rome')>-1) return 'it';
    if(nav.indexOf('fr')===0||tz.indexOf('Paris')>-1) return 'fr';
    if(nav.indexOf('es')===0||tz.indexOf('Madrid')>-1||tz.indexOf('Mexico')>-1) return 'es';
    if(nav.indexOf('ru')===0||tz.indexOf('Moscow')>-1) return 'ru';
    return 'en';
  }

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  /* Update banner text when geo-lang detects a new language (async IP lookup) */
  function updateBannerLang(){
    var el=document.getElementById('cookieConsent');
    if(!el) return;
    var lang=detectLang();
    var t=I18N[lang]||I18N.en;
    var inner=el.querySelector('.cc-inner');
    if(inner) inner.setAttribute('lang',lang);
    var txt=el.querySelector('.cc-text');
    if(txt) txt.textContent=t.msg;
    var reject=el.querySelector('.cc-reject');
    if(reject) reject.textContent=t.reject;
    var accept=el.querySelector('.cc-accept');
    if(accept) accept.textContent=t.accept;
  }

  document.addEventListener('pap-lang-changed', updateBannerLang);

  /* ── public API ────────────────────────────────── */
  var _callbacks=[];
  window.papCookieConsent={
    resolved: false,
    value: null,
    onResolve: function(fn){ if(window.papCookieConsent.resolved) fn(window.papCookieConsent.value); else _callbacks.push(fn); }
  };

  function _fireResolved(val){
    if(window.papCookieConsent.resolved) return;
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

  /* ── inject styles ─────────────────────────────────── */
  function injectStyles(){
    if(document.getElementById('pap-cc-styles')) return;
    var style=document.createElement('style');
    style.id='pap-cc-styles';
    style.textContent=[
      '#cookieConsent{position:fixed;bottom:0;left:0;right:0;z-index:10000;background:rgba(0,0,0,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:20px 24px;border-top:1px solid rgba(255,255,255,.1);font-family:"Montserrat",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:ccSlideUp .4s ease forwards;box-sizing:border-box}',
      '#cookieConsent *{box-sizing:border-box}',
      '#cookieConsent.cc-hide{animation:ccSlideDown .4s ease forwards}',
      '#cookieConsent .cc-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:24px;flex-wrap:wrap}',
      '#cookieConsent .cc-text-wrap{flex:1;min-width:240px}',
      '#cookieConsent .cc-text{color:rgba(255,255,255,.85);font-size:13px;line-height:1.6;margin:0;padding:0}',
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
      '}'
    ].join('');
    (document.head||document.documentElement).appendChild(style);
  }

  /* ── banner ─────────────────────────────────── */
  function showBanner(){
    if(document.getElementById('cookieConsent')) return;
    injectStyles();
    var wrap=document.createElement('div');
    wrap.id='cookieConsent';
    wrap.setAttribute('role','dialog');
    wrap.setAttribute('aria-label','Cookie consent');
    var lang=detectLang();
    var t=I18N[lang]||I18N.en;
    wrap.innerHTML=
      '<div class="cc-inner" lang="'+lang+'">'+
        '<div class="cc-text-wrap">'+
          '<p class="cc-text">'+esc(t.msg)+'</p>'+
        '</div>'+
        '<div class="cc-actions">'+
          '<button class="cc-btn cc-reject" id="ccReject">'+esc(t.reject)+'</button>'+
          '<button class="cc-btn cc-accept" id="ccAccept">'+esc(t.accept)+'</button>'+
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
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',showBanner);
    }else{
      showBanner();
    }
  }
})();
