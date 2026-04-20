/* PAP Magazine — Beta Test Notice Popup
   Shows on every page load to inform users that the site is in beta
   and paid subscription services are unavailable during this period.
   Multilingual: ko, en, it, fr, es, ja, zh, ru                       */

(function(){
  var I18N={
    ko:{title:'베타 테스트 안내',msg:'현재 PAP Magazine 웹사이트는 베타 테스트 중입니다. 이 기간 동안 유료 구독 서비스를 이용하실 수 없습니다. 양해 부탁드립니다.',btn:'확인'},
    en:{title:'Beta Test Notice',msg:'PAP Magazine website is currently in beta testing. Paid subscription services are unavailable during this period. Thank you for your understanding.',btn:'OK'},
    it:{title:'Avviso Beta Test',msg:'Il sito web di PAP Magazine è attualmente in fase di beta test. I servizi di abbonamento a pagamento non sono disponibili durante questo periodo. Grazie per la comprensione.',btn:'OK'},
    fr:{title:'Avis de Bêta Test',msg:'Le site web de PAP Magazine est actuellement en phase de bêta test. Les services d\'abonnement payants ne sont pas disponibles pendant cette période. Merci de votre compréhension.',btn:'OK'},
    es:{title:'Aviso de Beta Test',msg:'El sitio web de PAP Magazine se encuentra actualmente en fase de prueba beta. Los servicios de suscripción de pago no están disponibles durante este período. Gracias por su comprensión.',btn:'OK'},
    ja:{title:'ベータテストのお知らせ',msg:'現在、PAP Magazineウェブサイトはベータテスト中です。この期間中、有料サブスクリプションサービスはご利用いただけません。ご了承ください。',btn:'OK'},
    zh:{title:'Beta 测试公告',msg:'PAP Magazine 网站目前处于 Beta 测试阶段。在此期间，付费订阅服务暂不可用。感谢您的理解。',btn:'确认'},
    ru:{title:'Уведомление о бета-тесте',msg:'Веб-сайт PAP Magazine в настоящее время находится на стадии бета-тестирования. Платные подписки недоступны в этот период. Благодарим за понимание.',btn:'OK'}
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

  function injectStyles(){
    if(document.getElementById('pap-beta-styles')) return;
    var style=document.createElement('style');
    style.id='pap-beta-styles';
    style.textContent=[
      '#betaNotice{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:bnFadeIn .3s ease forwards;font-family:"Montserrat",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#betaNotice *{box-sizing:border-box}',
      '#betaNotice.bn-hide{animation:bnFadeOut .3s ease forwards}',
      '#betaNotice .bn-card{background:#fff;max-width:460px;width:90%;padding:36px 32px 28px;text-align:center;position:relative;border-radius:0}',
      '#betaNotice .bn-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#fff;background:#000;padding:5px 14px;margin-bottom:18px}',
      '#betaNotice .bn-title{font-size:18px;font-weight:700;letter-spacing:.05em;color:#000;margin:0 0 14px}',
      '#betaNotice .bn-msg{font-size:13px;line-height:1.7;color:#444;margin:0 0 24px}',
      '#betaNotice .bn-btn{display:inline-block;padding:12px 48px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:#000;color:#fff;border:1.5px solid #000;cursor:pointer;font-family:"Montserrat",sans-serif;transition:all .25s;border-radius:0;line-height:1}',
      '#betaNotice .bn-btn:hover{background:transparent;color:#000}',
      '@keyframes bnFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes bnFadeOut{from{opacity:1}to{opacity:0}}',
      '@media(max-width:480px){',
      '  #betaNotice .bn-card{padding:28px 20px 22px}',
      '  #betaNotice .bn-title{font-size:16px}',
      '  #betaNotice .bn-msg{font-size:12px}',
      '}'
    ].join('');
    (document.head||document.documentElement).appendChild(style);
  }

  function showNotice(){
    if(document.getElementById('betaNotice')) return;
    injectStyles();
    var lang=detectLang();
    var t=I18N[lang]||I18N.en;
    var overlay=document.createElement('div');
    overlay.id='betaNotice';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-label','Beta test notice');
    overlay.innerHTML=
      '<div class="bn-card" lang="'+lang+'">'+
        '<div class="bn-badge">BETA</div>'+
        '<h2 class="bn-title">'+esc(t.title)+'</h2>'+
        '<p class="bn-msg">'+esc(t.msg)+'</p>'+
        '<button class="bn-btn" id="bnClose">'+esc(t.btn)+'</button>'+
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('bnClose').addEventListener('click',function(){
      overlay.classList.add('bn-hide');
      setTimeout(function(){ overlay.remove(); },300);
    });

    /* close on overlay click (outside card) */
    overlay.addEventListener('click',function(e){
      if(e.target===overlay){
        overlay.classList.add('bn-hide');
        setTimeout(function(){ overlay.remove(); },300);
      }
    });
  }

  /* ── init ─────────────────────────────────────────── */
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',showNotice);
  }else{
    showNotice();
  }
})();
