/**
 * PAP Auth Link Redirect Enhancer
 * --------------------------------
 * Automatically adds a `?return=<current-url>` parameter to every link
 * pointing at auth.html, so users return to their current page (including
 * hash) after login. Also patches a global helper for JS-driven redirects.
 *
 * Include this on every page that might have a login link.
 * Safe to include multiple times.
 */
(function(){
  'use strict';

  function buildReturnParam(){
    try{
      return encodeURIComponent(location.pathname + location.search + location.hash);
    }catch(e){ return ''; }
  }

  function shouldSkipUrl(urlStr){
    // Skip absolute URLs to other origins
    if(!urlStr) return true;
    if(urlStr.indexOf('//') === 0) return true;
    if(/^https?:\/\//i.test(urlStr) && urlStr.indexOf(location.origin) !== 0) return true;
    return false;
  }

  function addReturnParam(href){
    if(shouldSkipUrl(href)) return href;
    // Already has return param? leave it
    if(/[?&]return=/.test(href)) return href;
    // Don't override admin redirect (server-side flow)
    if(/[?&]redirect=admin/.test(href)) return href;

    var ret = buildReturnParam();
    if(!ret) return href;

    var sep = href.indexOf('?') === -1 ? '?' : '&';
    return href + sep + 'return=' + ret;
  }

  function enhanceLinks(root){
    if(!root || !root.querySelectorAll) return;
    var links = root.querySelectorAll('a[href*="/auth"]');
    for(var i=0; i<links.length; i++){
      var a = links[i];
      var href = a.getAttribute('href');
      if(!href) continue;
      // Only process auth.html targets
      if(href.indexOf('/auth') === -1) continue;
      // Skip same-page anchors (e.g. "#", "javascript:")
      if(href.charAt(0) === '#' || /^javascript:/i.test(href)) continue;

      a.setAttribute('href', addReturnParam(href));
      a.setAttribute('data-pap-auth-enhanced', '1');
    }
  }

  // Run immediately + on DOMContentLoaded + on future DOM mutations
  function init(){
    enhanceLinks(document);

    // Handle dynamically-added login links (e.g., rendered by JS)
    if(typeof MutationObserver !== 'undefined'){
      var observer = new MutationObserver(function(mutations){
        for(var i=0; i<mutations.length; i++){
          var m = mutations[i];
          for(var j=0; j<m.addedNodes.length; j++){
            var node = m.addedNodes[j];
            if(node.nodeType === 1){
              if(node.matches && node.matches('a[href*="/auth"]')){
                var href = node.getAttribute('href');
                if(href && !node.hasAttribute('data-pap-auth-enhanced')){
                  node.setAttribute('href', addReturnParam(href));
                  node.setAttribute('data-pap-auth-enhanced', '1');
                }
              }
              if(node.querySelectorAll) enhanceLinks(node);
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Global helper for JS-driven redirects:
  //   location.href = window.papLoginUrl('/auth') — returns URL with return param
  window.papLoginUrl = function(base){
    base = base || '/auth?mode=login';
    return addReturnParam(base);
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ══════════════════════════════════════════════════════════════════
   * 뉴스레터 수신 동의 넛지 배너 (2026-07-21, 도메니코 지시)
   * ------------------------------------------------------------------
   * 배경: 회원 674명 중 마케팅 수신 동의가 20명(3%)뿐이었다. 원인은 UI가
   * 없어서가 아니라 — 가입 동의 체크박스도, 마이페이지 토글도 이미 있다 —
   * 4~6월 가입자 513명이 그 화면을 볼 기회가 없었기 때문. 동의율은
   * 4월 0% → 5월 0.8% → 6월 1.1% → 7월 9.3% 로, 7월 UI 개선 시점에 뛰었다.
   * 즉 필요한 건 새 UI가 아니라 "기존 회원에게 물어보는 순간"이다.
   *
   * 이 파일에 넣은 이유: pap-auth-link.js 는 이미 모든 사용자 페이지에
   * 로드된다. 새 스크립트 파일을 만들면 HTML 10개에 <script> 를 추가해야
   * 하지만, 여기 넣으면 캐시버스트만으로 전 페이지에 배포된다.
   *
   * 원칙 — 절대 재촉하지 않는다:
   *   · 한 번이라도 답한 사람(켰든 껐든)에게는 두 번 다시 뜨지 않는다.
   *     판정 기준은 marketing_consent_at 타임스탬프 유무.
   *   · "나중에" 를 누르면 30일간 침묵.
   *   · 비로그인·토큰 없음이면 아무 것도 하지 않고 네트워크 요청도 안 한다.
   * ════════════════════════════════════════════════════════════════ */
  var NUDGE_SNOOZE_KEY = 'pap-consent-nudge-until';
  var NUDGE_SNOOZE_DAYS = 30;

  var NUDGE_I18N = {
    ko:{ t:'PAP 뉴스레터를 받아보시겠어요?', d:'새 에디토리얼과 이슈 소식을 원하는 언어로 보내드립니다. 언제든 해지할 수 있어요.', y:'받아볼게요', n:'나중에', ok:'구독되었습니다 — 곧 첫 소식을 보내드릴게요.' },
    en:{ t:'Would you like the PAP newsletter?', d:'New editorials and issue news, in the language you choose. Unsubscribe anytime.', y:'Yes, sign me up', n:'Not now', ok:'You’re subscribed — the first issue is on its way.' },
    it:{ t:'Vuoi ricevere la newsletter PAP?', d:'Nuovi editoriali e novità sui numeri, nella lingua che preferisci. Puoi annullare quando vuoi.', y:'Sì, iscrivimi', n:'Non ora', ok:'Iscrizione completata — a presto.' },
    fr:{ t:'Souhaitez-vous la newsletter PAP ?', d:'Nouveaux éditoriaux et actualités, dans la langue de votre choix. Désinscription à tout moment.', y:'Oui, je m’inscris', n:'Plus tard', ok:'Inscription confirmée — à très vite.' },
    es:{ t:'¿Quieres la newsletter de PAP?', d:'Nuevos editoriales y novedades, en el idioma que elijas. Cancela cuando quieras.', y:'Sí, suscribirme', n:'Ahora no', ok:'Suscripción confirmada — pronto tendrás noticias.' },
    ja:{ t:'PAPのニュースレターを受け取りますか?', d:'新着エディトリアルと最新情報を、お好きな言語でお届けします。いつでも解除できます。', y:'受け取る', n:'あとで', ok:'登録しました — 最初のお便りをお待ちください。' },
    zh:{ t:'想订阅 PAP 通讯吗?', d:'以您选择的语言接收最新专题与刊物资讯。可随时取消。', y:'订阅', n:'以后再说', ok:'已订阅 — 敬请期待第一封。' },
    ru:{ t:'Хотите получать рассылку PAP?', d:'Новые редакции и новости выпусков на выбранном вами языке. Отписаться можно в любой момент.', y:'Да, подписаться', n:'Не сейчас', ok:'Вы подписаны — скоро придёт первое письмо.' },
    de:{ t:'Möchten Sie den PAP-Newsletter?', d:'Neue Editorials und Ausgaben-News in Ihrer Wunschsprache. Jederzeit abbestellbar.', y:'Ja, anmelden', n:'Später', ok:'Angemeldet — die erste Ausgabe kommt bald.' }
  };

  function nudgeText(){
    var lang;
    try { lang = localStorage.getItem('pap-lang') || 'en'; } catch(e){ lang = 'en'; }
    return NUDGE_I18N[lang] || NUDGE_I18N.en;
  }

  function nudgeSnoozed(){
    try {
      var until = parseInt(localStorage.getItem(NUDGE_SNOOZE_KEY) || '0', 10);
      return until && Date.now() < until;
    } catch(e){ return false; }
  }

  function snoozeNudge(){
    try {
      localStorage.setItem(NUDGE_SNOOZE_KEY, String(Date.now() + NUDGE_SNOOZE_DAYS * 864e5));
    } catch(e){ /* 사파리 프라이빗 모드 등 — 무시 */ }
  }

  function renderNudge(token){
    var T = nudgeText();
    var box = document.createElement('div');
    box.id = 'papConsentNudge';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9998;max-width:420px;margin-left:auto;' +
      'background:rgba(0,0,0,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:18px 20px;' +
      "font-family:Montserrat,-apple-system,'Apple SD Gothic Neo',sans-serif;color:#fff;" +
      'box-shadow:0 8px 32px rgba(0,0,0,.5);opacity:0;transform:translateY(12px);transition:opacity .35s,transform .35s';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:700;letter-spacing:.02em;margin-bottom:6px';
    title.textContent = T.t;

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;line-height:1.6;color:rgba(255,255,255,.6);margin-bottom:14px';
    desc.textContent = T.d;

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = T.y;
    yes.style.cssText = 'flex:1;background:#fff;color:#000;border:0;border-radius:4px;padding:9px 14px;' +
      'font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.04em;cursor:pointer';

    var no = document.createElement('button');
    no.type = 'button';
    no.textContent = T.n;
    no.style.cssText = 'background:transparent;color:rgba(255,255,255,.45);border:0;padding:9px 12px;' +
      'font-family:inherit;font-size:11px;letter-spacing:.02em;cursor:pointer';

    row.appendChild(yes); row.appendChild(no);
    box.appendChild(title); box.appendChild(desc); box.appendChild(row);
    document.body.appendChild(box);
    requestAnimationFrame(function(){ box.style.opacity = '1'; box.style.transform = 'translateY(0)'; });

    function dismiss(){
      box.style.opacity = '0';
      box.style.transform = 'translateY(12px)';
      setTimeout(function(){ if(box.parentNode) box.parentNode.removeChild(box); }, 350);
    }

    no.addEventListener('click', function(){ snoozeNudge(); dismiss(); });

    yes.addEventListener('click', function(){
      yes.disabled = true;
      yes.style.opacity = '.6';
      // source:'banner' — consent_history 에 출처가 남아 나중에 배너 효과를 잴 수 있다.
      fetch('/api/auth/consent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ marketing: true, source: 'banner' })
      }).then(function(r){
        if(!r.ok) throw new Error('HTTP ' + r.status);
        // 성공하면 다시 물어볼 일이 없다(서버에 타임스탬프가 남음). 스누즈도 걸어
        // 혹시 모를 재노출을 막는다.
        snoozeNudge();
        desc.textContent = T.ok;
        row.style.display = 'none';
        setTimeout(dismiss, 2600);
      }).catch(function(){
        // 실패 시 조용히 닫고 스누즈 — 사용자에게 에러를 던지지 않는다.
        snoozeNudge();
        dismiss();
      });
    });
  }

  function initConsentNudge(){
    var token;
    try { token = localStorage.getItem('pap-token'); } catch(e){ return; }
    if(!token) return;                       // 비로그인 — 요청조차 하지 않는다
    if(nudgeSnoozed()) return;               // "나중에" 누른 지 30일 안 지남
    if(document.getElementById('papConsentNudge')) return; // 중복 삽입 방지

    fetch('/api/auth/consent', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var c = j && j.consent;
        if(!c) return;
        // 이미 한 번이라도 답한 사람에겐 절대 띄우지 않는다.
        // marketing_consent_at 이 있으면 켠 적 있는 것이고, marketing_consent 가
        // true 면 당연히 대상 아님. 끈 사람은 consent_at 이 null 로 돌아가므로
        // email_consent_at 까지 함께 봐서 "동의 화면을 본 적 있는 회원"을 제외한다.
        if(c.marketing_consent) return;
        if(c.marketing_consent_at) return;
        if(c.email_consent || c.email_consent_at) return;
        renderNudge(token);
      })
      .catch(function(){ /* 조용히 포기 */ });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initConsentNudge);
  } else {
    initConsentNudge();
  }
})();
