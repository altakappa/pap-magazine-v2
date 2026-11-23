/* PAP 상담봇 위젯 (2026-11-23)
 *
 * 도메니코: "홈 우측하단에 고객상담봇 같은 걸 눌러 들어가서 질문을 모두 대답해주는 건 어때?"
 *
 * 설계에서 신경 쓴 것
 *  · 첫 화면을 무겁게 하지 않는다. 버블만 먼저 그리고, 누를 때까지 아무것도 안 부른다.
 *  · 봇이라고 먼저 말한다. 사람인 척하면 들통났을 때 매거진이 손해다.
 *  · 막히면 사람에게 가는 길을 반드시 띄운다 — 답을 못 하는 것보다 길을 안 알려주는 게 나쁘다.
 *  · 9개 언어. 지금 홈은 9개 언어로 읽히고, 막히는 사람은 대개 한국어도 영어도 아니다.
 *
 * 마크업 리터럴은 영어로 두지 않는다 — 이 파일은 통째로 JS 라 사전에서만 글자가 나온다.
 * (frontend.md 의 "마크업에 한글 금지" 는 HTML 파일 규칙이다)
 */
(function () {
  'use strict';
  if (window.__papAssistant) return;
  window.__papAssistant = true;

  var T = {
    ko: { open:'문의하기', title:'PAP 에 물어보세요', bot:'AI 도우미입니다. 중요한 결정은 에디터가 합니다.',
      ph:'무엇이든 물어보세요', send:'보내기', thinking:'생각하는 중…',
      c1:'광고 단가가 궁금해요', c2:'에디토리얼은 어떻게 보내나요', c3:'게재료가 있나요', c4:'멤버십 혜택이 뭔가요',
      err:'지금은 답할 수 없습니다. 잠시 뒤 다시 시도해 주세요.', busy:'문의가 몰려 잠시 쉬고 있습니다.',
      human:'사람에게 바로 묻기', src:'관련 글' },
    en: { open:'Ask us', title:'Ask PAP', bot:'I am an AI assistant. An editor makes the real decisions.',
      ph:'Ask anything', send:'Send', thinking:'Thinking…',
      c1:'What do ads cost?', c2:'How do I submit an editorial?', c3:'Is there a fee?', c4:'What does membership include?',
      err:'I cannot answer right now. Please try again shortly.', busy:'We are getting a lot of questions — taking a short break.',
      human:'Ask a person instead', src:'Related' },
    de: { open:'Fragen', title:'Fragen Sie PAP', bot:'Ich bin ein KI-Assistent. Entscheidungen trifft die Redaktion.',
      ph:'Fragen Sie etwas', send:'Senden', thinking:'Denke nach…',
      c1:'Was kostet Werbung?', c2:'Wie reiche ich ein Editorial ein?', c3:'Gibt es eine Gebuehr?', c4:'Was bietet die Mitgliedschaft?',
      err:'Ich kann gerade nicht antworten. Bitte in Kuerze erneut versuchen.', busy:'Zu viele Anfragen — kurze Pause.',
      human:'Lieber eine Person fragen', src:'Dazu passend' },
    it: { open:'Chiedi', title:'Chiedi a PAP', bot:'Sono un assistente AI. Le decisioni le prende la redazione.',
      ph:'Chiedi qualsiasi cosa', send:'Invia', thinking:'Sto pensando…',
      c1:'Quanto costa la pubblicita?', c2:'Come invio un editoriale?', c3:'C e un costo?', c4:'Cosa include l abbonamento?',
      err:'Non riesco a rispondere ora. Riprova tra poco.', busy:'Troppe richieste — breve pausa.',
      human:'Parla con una persona', src:'Correlati' },
    fr: { open:'Nous ecrire', title:'Demandez a PAP', bot:'Je suis un assistant IA. La redaction decide.',
      ph:'Posez votre question', send:'Envoyer', thinking:'Je reflechis…',
      c1:'Combien coute la publicite ?', c2:'Comment envoyer un editorial ?', c3:'Y a-t-il des frais ?', c4:'Que comprend l abonnement ?',
      err:'Je ne peux pas repondre maintenant. Reessayez bientot.', busy:'Trop de demandes — courte pause.',
      human:'Parler a quelqu un', src:'A lire' },
    es: { open:'Preguntar', title:'Pregunta a PAP', bot:'Soy un asistente de IA. Las decisiones las toma la redaccion.',
      ph:'Pregunta lo que quieras', send:'Enviar', thinking:'Pensando…',
      c1:'Cuanto cuesta la publicidad?', c2:'Como envio un editorial?', c3:'Hay algun coste?', c4:'Que incluye la membresia?',
      err:'Ahora no puedo responder. Intentalo en un momento.', busy:'Muchas consultas — pausa breve.',
      human:'Hablar con una persona', src:'Relacionado' },
    ja: { open:'質問する', title:'PAPに聞く', bot:'AIアシスタントです。最終的な判断は編集部が行います。',
      ph:'なんでもお聞きください', send:'送信', thinking:'考えています…',
      c1:'広告費はいくらですか', c2:'エディトリアルの送り方は', c3:'掲載料はかかりますか', c4:'メンバーシップの特典は',
      err:'今はお答えできません。しばらくしてからお試しください。', busy:'お問い合わせが多く、少し休んでいます。',
      human:'人に直接聞く', src:'関連記事' },
    zh: { open:'咨询', title:'向 PAP 提问', bot:'我是 AI 助手。最终决定由编辑部做出。',
      ph:'有什么想问的', send:'发送', thinking:'思考中…',
      c1:'广告费用是多少', c2:'如何投稿编辑大片', c3:'需要费用吗', c4:'会员包含什么',
      err:'现在无法回答，请稍后再试。', busy:'咨询较多，暂时休息一下。',
      human:'直接联系真人', src:'相关内容' },
    ru: { open:'Спросить', title:'Спросите PAP', bot:'Я ИИ-ассистент. Решения принимает редакция.',
      ph:'Спрашивайте о чём угодно', send:'Отправить', thinking:'Думаю…',
      c1:'Сколько стоит реклама?', c2:'Как прислать съёмку?', c3:'Есть ли плата?', c4:'Что даёт подписка?',
      err:'Сейчас не могу ответить. Попробуйте чуть позже.', busy:'Много обращений — небольшая пауза.',
      human:'Написать человеку', src:'По теме' },
  };
  function lang(){ try { return localStorage.getItem('pap-lang') || 'en'; } catch(_) { return 'en'; } }
  function t(k){ var d = T[lang()] || T.en; return d[k] || T.en[k] || k; }

  function sessionKey(){
    try {
      var k = sessionStorage.getItem('pap-asst');
      if (!k) { k = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('pap-asst', k); }
      return k;
    } catch(_) { return 'anon'; }
  }

  /* textContent → innerHTML 로 만드는 이스케이퍼는 **따옴표를 남긴다**. 이 파일은
     placeholder="..." 처럼 속성 안에서도 쓰므로 그대로면 탈출이 가능하다.
     (저장소 전체가 2026-09 감사에서 같은 이유로 한 번 바뀌었다 —
     tests/submission-pullletter-audit.test.js 가 새 파일의 재발을 잡는다) */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var css = ''
    + '#pap-asst-b{position:fixed;right:18px;bottom:18px;z-index:2147482000;background:#891717;color:#fff;border:none;'
    + 'border-radius:999px;padding:13px 20px;font:700 11px/1 Montserrat,system-ui,sans-serif;letter-spacing:.14em;'
    + 'text-transform:uppercase;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35)}'
    + '#pap-asst-b:hover{background:#a51c1c}'
    + '#pap-asst-p{position:fixed;right:18px;bottom:18px;z-index:2147482001;width:360px;max-width:calc(100vw - 24px);'
    + 'height:540px;max-height:calc(100vh - 36px);background:#0d0d0d;color:#fff;border:1px solid rgba(255,255,255,.14);'
    + 'border-radius:6px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6);'
    + 'font-family:Montserrat,system-ui,sans-serif}'
    + '#pap-asst-h{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:space-between}'
    + '#pap-asst-h b{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}'
    + '#pap-asst-x{background:none;border:none;color:#999;font-size:20px;line-height:1;cursor:pointer}'
    + '#pap-asst-l{flex:1;overflow-y:auto;padding:14px 16px;font-size:13px;line-height:1.75}'
    + '.pap-asst-note{color:rgba(255,255,255,.4);font-size:11px;line-height:1.6;margin-bottom:14px}'
    + '.pap-asst-u{color:#fff;background:rgba(255,255,255,.08);padding:9px 12px;border-radius:4px;margin:0 0 10px auto;max-width:85%;width:fit-content}'
    + '.pap-asst-a{color:rgba(255,255,255,.82);margin:0 0 14px;white-space:pre-wrap}'
    + '.pap-asst-a a{color:#e08b8b}'
    + '.pap-asst-s{font-size:11.5px;color:rgba(255,255,255,.5);margin:-8px 0 14px}'
    + '.pap-asst-s a{color:#c98f8f;display:block;margin-top:3px}'
    + '#pap-asst-c{padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:6px}'
    + '#pap-asst-c button{background:none;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.72);'
    + 'font:400 11.5px/1.4 inherit;padding:7px 10px;border-radius:999px;cursor:pointer;text-align:left}'
    + '#pap-asst-c button:hover{border-color:#891717;color:#fff}'
    + '#pap-asst-f{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.12)}'
    + '#pap-asst-i{flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#fff;'
    + 'padding:9px 11px;border-radius:4px;font:400 13px inherit;min-width:0}'
    + '#pap-asst-send{background:#891717;border:none;color:#fff;font:700 10.5px/1 inherit;letter-spacing:.12em;'
    + 'text-transform:uppercase;padding:0 14px;border-radius:4px;cursor:pointer}'
    + '#pap-asst-send:disabled{opacity:.45;cursor:default}'
    + '@media(max-width:480px){#pap-asst-p{right:8px;left:8px;bottom:8px;width:auto;height:calc(100vh - 80px)}}';

  var hist = [];
  var busy = false;

  function el(id){ return document.getElementById(id); }

  function addUser(text){
    var d = document.createElement('div'); d.className = 'pap-asst-u'; d.textContent = text;
    el('pap-asst-l').appendChild(d); scroll();
  }
  function addBot(text, sources){
    var d = document.createElement('div'); d.className = 'pap-asst-a';
    /* 링크만 앵커로 바꾼다. 그 외 전부 이스케이프 — 모델 출력도 신뢰 대상이 아니다. */
    d.innerHTML = esc(text).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
    el('pap-asst-l').appendChild(d);
    if (sources && sources.length) {
      var s = document.createElement('div'); s.className = 'pap-asst-s';
      s.appendChild(document.createTextNode(t('src')));
      sources.slice(0, 4).forEach(function (f) {
        var a = document.createElement('a'); a.href = f.url; a.textContent = f.title; s.appendChild(a);
      });
      el('pap-asst-l').appendChild(s);
    }
    scroll();
  }
  function addHuman(){
    var d = document.createElement('div'); d.className = 'pap-asst-s';
    var a = document.createElement('a');
    a.href = 'mailto:contact@pap-magazine.com'; a.textContent = t('human');
    d.appendChild(a); el('pap-asst-l').appendChild(d); scroll();
  }
  function scroll(){ var l = el('pap-asst-l'); if (l) l.scrollTop = l.scrollHeight; }

  function send(text){
    if (busy) return;
    var msg = String(text || (el('pap-asst-i') ? el('pap-asst-i').value : '')).trim();
    if (!msg) return;
    busy = true;
    if (el('pap-asst-i')) el('pap-asst-i').value = '';
    if (el('pap-asst-send')) el('pap-asst-send').disabled = true;
    var chips = el('pap-asst-c'); if (chips) chips.remove();
    addUser(msg);
    var wait = document.createElement('div'); wait.className = 'pap-asst-a'; wait.textContent = t('thinking');
    el('pap-asst-l').appendChild(wait); scroll();

    fetch('/api/assistant/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: hist.slice(-10), lang: lang(),
        page: location.pathname, sessionKey: sessionKey() }),
    }).then(function (r) {
      return r.json().catch(function(){ return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (o) {
      wait.remove();
      if (!o.ok) {
        /* 왜 못 하는지 구분해서 말한다. "오류가 발생했습니다" 는 아무것도 알려주지 않는다. */
        addBot(o.j && o.j.code === 'daily_cap' ? t('busy') : t('err'));
        addHuman();
        return;
      }
      hist.push({ role: 'user', content: msg });
      hist.push({ role: 'assistant', content: o.j.answer });
      addBot(o.j.answer, o.j.sources);
    }).catch(function () {
      wait.remove(); addBot(t('err')); addHuman();
    }).then(function () {
      busy = false;
      if (el('pap-asst-send')) el('pap-asst-send').disabled = false;
      if (el('pap-asst-i')) el('pap-asst-i').focus();
    });
  }

  function open(){
    if (el('pap-asst-p')) return;
    var b = el('pap-asst-b'); if (b) b.style.display = 'none';
    var p = document.createElement('div');
    p.id = 'pap-asst-p'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', t('title'));
    p.innerHTML =
      '<div id="pap-asst-h"><b>' + esc(t('title')) + '</b><button id="pap-asst-x" aria-label="close">&times;</button></div>'
      + '<div id="pap-asst-l"><div class="pap-asst-note">' + esc(t('bot')) + '</div></div>'
      + '<div id="pap-asst-c"></div>'
      + '<div id="pap-asst-f"><input id="pap-asst-i" autocomplete="off" placeholder="' + esc(t('ph')) + '">'
      + '<button id="pap-asst-send">' + esc(t('send')) + '</button></div>';
    document.body.appendChild(p);
    ['c1', 'c2', 'c3', 'c4'].forEach(function (k) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t(k);
      btn.addEventListener('click', function () { send(t(k)); });
      el('pap-asst-c').appendChild(btn);
    });
    el('pap-asst-x').addEventListener('click', close);
    el('pap-asst-send').addEventListener('click', function () { send(); });
    el('pap-asst-i').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    el('pap-asst-i').focus();
  }
  function close(){
    var p = el('pap-asst-p'); if (p) p.remove();
    var b = el('pap-asst-b'); if (b) b.style.display = '';
  }

  function mount(){
    if (el('pap-asst-b')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var b = document.createElement('button');
    b.id = 'pap-asst-b'; b.type = 'button'; b.textContent = t('open'); b.setAttribute('aria-haspopup', 'dialog');
    b.addEventListener('click', open);
    document.body.appendChild(b);
    /* 언어를 바꾸면 버튼 글자도 따라간다 — 열려 있으면 건드리지 않는다(쓰던 대화가 날아간다). */
    window.addEventListener('pap-lang-change', function () {
      if (!el('pap-asst-p')) b.textContent = t('open');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
