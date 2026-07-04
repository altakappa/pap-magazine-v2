/* PAP Magazine — Beta Test Notice Popup
   Registers a single popup with window.papPopups (see pap-popup-registry.js).
   The registry owns dismissal storage, entry-path consistency (BFCache
   restore via pageshow), and queueing. This file only owns content and
   appearance.
   Multilingual: ko, en, it, fr, es, ja, zh, ru, de.

   QA #241 changes:
   • Migrated init / dismissal / deep-link guard onto papPopups.register —
     a fresh load and a back/forward-cache restore now behave identically
     because the registry re-runs the queue on pageshow with persisted=true.
   • Dismissal storage policy preserved (localStorage, 7-day TTL).
     Storage key changed: the new shared key is
     `pap-popup-dismissed-beta-notice` (managed by the registry). The
     legacy `pap-beta-notice-dismissed-at` value is migrated on first
     load so existing dismissals are honored. */

(function(){
  var I18N={
    ko:{title:'베타 테스트 안내',msg:'현재 PAP Magazine 웹사이트는 베타 테스트 기간 중입니다. 이 기간 동안 웹사이트의 모든 기능과 구독 서비스를 자유롭게 이용하실 수 있으며, 사용 과정에서 발견되는 의견이나 개선 제안은 언제든지 환영합니다.',highlight:'무료 회원가입을 하시면 Standard·Premium 유료 서비스를 포함한 모든 콘텐츠를 베타 기간 동안 무료로 이용하실 수 있습니다.',highlightLoggedIn:'로그인된 회원님은 베타 기간 중 모든 유료 서비스를 무료로 이용하실 수 있습니다.',feedbackPre:'개선 제안은 ',feedbackPost:' 으로 보내주세요.',btnSignup:'무료 회원가입',btn:'확인'},
    en:{title:'Beta Test Notice',msg:'PAP Magazine is currently in beta testing. All site features and subscription services are available to try during this period. Feedback and suggestions are always welcome.',highlight:'Sign up for a free account to unlock all content, including Standard & Premium paid services, at no cost throughout the beta period.',highlightLoggedIn:'As a signed-in member, you have full access to every paid service at no cost during the beta period.',feedbackPre:'Please send suggestions and feedback to ',feedbackPost:'.',btnSignup:'Free Sign Up',btn:'OK'},
    it:{title:'Avviso Beta Test',msg:'Il sito web di PAP Magazine è attualmente in fase di beta test. Tutte le funzioni e i servizi in abbonamento sono disponibili durante questo periodo: i tuoi feedback e suggerimenti sono benvenuti.',highlight:'Registrati gratuitamente per accedere a tutti i contenuti, inclusi i servizi Standard e Premium, senza costi durante il periodo beta.',highlightLoggedIn:'Come membro registrato hai accesso completo a tutti i servizi a pagamento senza costi durante il periodo beta.',feedbackPre:'Inviaci suggerimenti e feedback a ',feedbackPost:'.',btnSignup:'Registrati Gratis',btn:'OK'},
    fr:{title:'Avis de Bêta Test',msg:'Le site web de PAP Magazine est actuellement en phase de bêta test. Toutes les fonctionnalités et les services d\'abonnement sont accessibles pendant cette période. Vos retours et suggestions sont les bienvenus.',highlight:'Inscrivez-vous gratuitement pour accéder à tout le contenu, y compris les services Standard et Premium, sans frais pendant la période bêta.',highlightLoggedIn:'En tant que membre connecté, vous avez accès à tous les services payants sans frais pendant la période bêta.',feedbackPre:'Envoyez vos suggestions et retours à ',feedbackPost:'.',btnSignup:'Inscription Gratuite',btn:'OK'},
    es:{title:'Aviso de Beta Test',msg:'El sitio web de PAP Magazine se encuentra actualmente en fase de prueba beta. Todas las funciones y servicios de suscripción están disponibles durante este período. Tus comentarios y sugerencias son bienvenidos.',highlight:'Regístrate gratis para acceder a todos los contenidos, incluidos los servicios Standard y Premium, sin coste durante el período beta.',highlightLoggedIn:'Como miembro registrado, tienes acceso completo a todos los servicios de pago sin coste durante el período beta.',feedbackPre:'Envía tus sugerencias y comentarios a ',feedbackPost:'.',btnSignup:'Registro Gratuito',btn:'OK'},
    ja:{title:'ベータテストのお知らせ',msg:'現在、PAP Magazineウェブサイトはベータテスト期間中です。この期間中、すべての機能とサブスクリプションサービスを自由にご利用いただけます。ご意見・ご提案をお待ちしております。',highlight:'無料会員登録をすれば、Standard・Premiumの有料サービスを含むすべてのコンテンツをベータ期間中は無料でご利用いただけます。',highlightLoggedIn:'ログイン中の会員様は、ベータ期間中すべての有料サービスを無料でご利用いただけます。',feedbackPre:'ご意見・改善提案は ',feedbackPost:' までお送りください。',btnSignup:'無料登録',btn:'OK'},
    zh:{title:'Beta 测试公告',msg:'PAP Magazine 网站目前处于 Beta 测试阶段。在此期间，所有功能及订阅服务均可免费使用，欢迎您提出反馈与建议。',highlight:'免费注册即可在 Beta 期间免费使用包括 Standard 与 Premium 付费服务在内的所有内容。',highlightLoggedIn:'作为登录会员，您在 Beta 期间可免费使用所有付费服务。',feedbackPre:'请将改进建议发送至 ',feedbackPost:'。',btnSignup:'免费注册',btn:'确认'},
    ru:{title:'Уведомление о бета-тесте',msg:'Веб-сайт PAP Magazine находится в стадии бета-тестирования. В этот период доступны все функции и подписные сервисы. Отзывы и предложения приветствуются.',highlight:'Зарегистрируйтесь бесплатно, чтобы получить доступ ко всему контенту, включая платные услуги Standard и Premium, в течение бета-периода.',highlightLoggedIn:'Как авторизованный участник, вы имеете полный доступ ко всем платным услугам бесплатно в период бета-теста.',feedbackPre:'Пожалуйста, отправляйте предложения и отзывы на ',feedbackPost:'.',btnSignup:'Бесплатная Регистрация',btn:'OK'},
    de:{title:'Beta-Test Hinweis',msg:'Die PAP Magazine Website befindet sich derzeit in der Beta-Testphase. Alle Funktionen und Abonnement-Services stehen während dieser Zeit zur Verfügung. Feedback und Vorschläge sind willkommen.',highlight:'Registrieren Sie sich kostenlos, um während der Beta-Phase auf alle Inhalte, einschließlich Standard- und Premium-Dienste, kostenfrei zuzugreifen.',highlightLoggedIn:'Als angemeldetes Mitglied haben Sie während der Beta-Phase kostenfreien Zugang zu allen kostenpflichtigen Diensten.',feedbackPre:'Bitte senden Sie Vorschläge und Feedback an ',feedbackPost:'.',btnSignup:'Kostenlos Registrieren',btn:'OK'}
  };

  function detectLang(){
    var saved=null;
    try{ saved=localStorage.getItem('pap-lang'); }catch(e){}
    if(saved && I18N[saved]) return saved;
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

  function isLoggedInForBeta(){
    try{ return !!localStorage.getItem('pap-token'); }catch(e){return false;}
  }

  function updateNoticeLang(){
    var el=document.getElementById('betaNotice');
    if(!el) return;
    var lang=detectLang();
    var t=I18N[lang]||I18N.en;
    var loggedIn=isLoggedInForBeta();
    var card=el.querySelector('.bn-card');
    if(card) card.setAttribute('lang',lang);
    var title=el.querySelector('.bn-title');
    if(title) title.textContent=t.title;
    var msg=el.querySelector('.bn-msg');
    if(msg) msg.textContent=t.msg;
    var hl=el.querySelector('.bn-highlight');
    if(hl) hl.textContent=(loggedIn?(t.highlightLoggedIn||t.highlight):t.highlight)||'';
    var fb=el.querySelector('.bn-feedback');
    if(fb) fb.innerHTML=esc(t.feedbackPre||'')+'<a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>'+esc(t.feedbackPost||'');
    var btnSignup=el.querySelector('.bn-btn-signup');
    if(btnSignup) btnSignup.textContent=t.btnSignup||'';
    var btn=el.querySelector('.bn-btn');
    if(btn) btn.textContent=t.btn;
  }
  document.addEventListener('pap-lang-changed', updateNoticeLang);

  function injectStyles(){
    if(document.getElementById('pap-beta-styles')) return;
    var style=document.createElement('style');
    style.id='pap-beta-styles';
    style.textContent=[
      '#betaNotice{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;font-family:"Montserrat",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#betaNotice.bn-ready{animation:bnFadeIn .3s ease forwards}',
      '#betaNotice *{box-sizing:border-box}',
      '#betaNotice.bn-hide{animation:bnFadeOut .3s ease forwards}',
      '#betaNotice .bn-card{background:#000;color:#fff;max-width:460px;width:90%;padding:36px 32px 28px;text-align:center;position:relative;border-radius:0;border:1px solid rgba(255,255,255,.1)}',
      '#betaNotice .bn-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#000;background:#fff;padding:5px 14px;margin-bottom:18px}',
      '#betaNotice .bn-title{font-size:18px;font-weight:700;letter-spacing:.05em;color:#fff;margin:0 0 14px}',
      '#betaNotice .bn-msg{font-size:13px;line-height:1.7;color:rgba(255,255,255,.75);margin:0 0 14px}',
      '#betaNotice .bn-highlight{font-size:13px;line-height:1.7;color:#fff;font-weight:500;background:rgba(255,255,255,.06);border-left:3px solid #fff;padding:12px 14px;margin:0 0 24px;text-align:left}',
      '#betaNotice .bn-actions{display:flex;flex-direction:column;gap:10px;align-items:center}',
      '#betaNotice .bn-btn-signup{display:inline-block;padding:12px 32px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:#fff;color:#000;border:1.5px solid #fff;cursor:pointer;font-family:"Montserrat",sans-serif;transition:all .25s;border-radius:0;line-height:1;text-decoration:none;min-width:220px}',
      '#betaNotice .bn-btn-signup:hover{background:transparent;color:#fff}',
      '#betaNotice .bn-btn{display:inline-block;padding:10px 32px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;background:transparent;color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.25);cursor:pointer;font-family:"Montserrat",sans-serif;transition:all .25s;border-radius:0;line-height:1;min-width:220px}',
      '#betaNotice .bn-btn:hover{background:#fff;color:#000;border-color:#fff}',
      '#betaNotice .bn-feedback{font-size:11px;line-height:1.6;color:rgba(255,255,255,.5);margin:18px 0 0;letter-spacing:.01em;word-break:keep-all}',
      '#betaNotice .bn-feedback a{color:rgba(255,255,255,.85);text-decoration:underline;text-underline-offset:2px;transition:color .2s;white-space:nowrap;display:inline-block}',
      '#betaNotice .bn-feedback a:hover{color:#fff}',
      '@keyframes bnFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes bnFadeOut{from{opacity:1}to{opacity:0}}',
      '@media(max-width:480px){',
      '  #betaNotice .bn-card{padding:28px 20px 22px}',
      '  #betaNotice .bn-title{font-size:16px}',
      '  #betaNotice .bn-msg{font-size:12px}',
      '  #betaNotice .bn-highlight{font-size:12px;padding:10px 12px}',
      '  #betaNotice .bn-feedback{font-size:10px}',
      '}'
    ].join('');
    (document.head||document.documentElement).appendChild(style);
  }

  /* Render the popup. `api.dismiss()` records the dismissal flag and tells
     the registry the slot is free; `api.skip()` does the latter without
     recording (used here only as a defensive escape, not in normal flow). */
  function renderBetaNotice(api){
    /* Defensive: if a previous render leaked a DOM node, replace it.
       Should never happen because the registry guards ACTIVE, but keep
       cheap idempotence in case the user double-clicks something weird. */
    var existing = document.getElementById('betaNotice');
    if(existing) existing.remove();

    injectStyles();
    var lang=detectLang();
    var t=I18N[lang]||I18N.en;
    var loggedIn=isLoggedInForBeta();
    var overlay=document.createElement('div');
    overlay.id='betaNotice';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-label','Beta test notice');
    var signupHTML = loggedIn ? '' :
      '<a class="bn-btn-signup" href="/auth">'+esc(t.btnSignup||'Sign Up')+'</a>';
    var highlightText = loggedIn ? (t.highlightLoggedIn||t.highlight||'') : (t.highlight||'');
    var highlightHTML = highlightText ?
      '<div class="bn-highlight">'+esc(highlightText)+'</div>' : '';
    var feedbackHTML = (t.feedbackPre || t.feedbackPost) ?
      '<div class="bn-feedback">'+esc(t.feedbackPre||'')+'<a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>'+esc(t.feedbackPost||'')+'</div>' : '';
    overlay.innerHTML=
      '<div class="bn-card" lang="'+lang+'">'+
        '<div class="bn-badge">BETA</div>'+
        '<h2 class="bn-title">'+esc(t.title)+'</h2>'+
        '<p class="bn-msg">'+esc(t.msg)+'</p>'+
        highlightHTML+
        '<div class="bn-actions">'+
          signupHTML+
          '<button class="bn-btn" id="bnClose">'+esc(t.btn)+'</button>'+
        '</div>'+
        feedbackHTML+
      '</div>';
    document.body.appendChild(overlay);

    var revealed=false;
    function revealNotice(){
      if(revealed) return;
      revealed=true;
      updateNoticeLang();
      overlay.classList.add('bn-ready');
    }
    document.addEventListener('pap-lang-changed', function onLang(){
      document.removeEventListener('pap-lang-changed', onLang);
      revealNotice();
    });
    /* Fallback reveal if geo-detection takes too long */
    setTimeout(revealNotice, 600);

    function _close(){
      api.dismiss(); // registry records dismissal flag and frees the slot
      overlay.classList.add('bn-hide');
      setTimeout(function(){ overlay.remove(); }, 300);
    }
    document.getElementById('bnClose').addEventListener('click', _close);
    /* close on backdrop click (outside card) */
    overlay.addEventListener('click', function(e){
      if(e.target === overlay) _close();
    });
    /* Also count the signup-CTA click as an implicit dismissal — the
       user acknowledged the notice by acting on it. */
    var signupBtn = overlay.querySelector('.bn-btn-signup');
    if(signupBtn){
      signupBtn.addEventListener('click', function(){ api.dismiss(); });
    }
  }

  /* Honour the PAP_BETA_END kill switch defined in pap-app.js. */
  function shouldShowBeta(){
    if(typeof PAP_BETA_END==='undefined'||PAP_BETA_END===null) return true;
    var now=new Date(); var end=new Date(PAP_BETA_END+'T23:59:59');
    return now<=end;
  }

  /* QA #241 migration: legacy beta-notice stored dismissal under its
     own key. If we find that key still present and the new shared key
     is missing, copy it across so existing dismissals carry over and
     users aren't bothered with the popup again. Run-once safety. */
  function migrateLegacyDismissal(){
    try{
      var legacyKey = 'pap-beta-notice-dismissed-at';
      var newKey   = 'pap-popup-dismissed-beta-notice';
      var legacy = localStorage.getItem(legacyKey);
      if(legacy && !localStorage.getItem(newKey)){
        localStorage.setItem(newKey, legacy);
      }
      // Don't remove the legacy key — harmless, and acts as a safety
      // net if a rollback restores the old beta-notice.js.
    }catch(e){}
  }

  function registerWhenReady(){
    if(!window.papPopups){
      // pap-popup-registry.js is loaded with the same `defer` attribute as
      // this file, so by the time we run, papPopups must exist. Defensive
      // setTimeout retry in case load order ever changes.
      return setTimeout(registerWhenReady, 50);
    }
    migrateLegacyDismissal();
    window.papPopups.register({
      id: 'beta-notice',
      priority: 100,
      storageType: 'localStorage',
      dismissalTTL: 7 * 24 * 60 * 60 * 1000, // 7 days — kept per user
      shouldShow: shouldShowBeta,
      render: renderBetaNotice
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', registerWhenReady);
  } else {
    registerWhenReady();
  }

  /* Backwards-compatible debug hook. Prefer window.papPopups.reset('beta-notice'). */
  window._papResetBetaNotice = function(){
    if(window.papPopups) window.papPopups.reset('beta-notice');
    try{ localStorage.removeItem('pap-beta-notice-dismissed-at'); }catch(e){}
  };
})();
