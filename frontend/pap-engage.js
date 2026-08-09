/**
 * 기사 참여 블록 — 좋아요 · 댓글 · 카카오 공유 (2026-08-07 신설)
 *
 * 왜 파일로 뺐나 ────────────────────────────────────────────────────
 * 도메니코: "웹사이트에서 기사를 보면 MORE ARTICLES, 자주 묻는 질문이
 *            뜨지 않는데 이건 볼 수 없는 거야?"
 *
 * 확인해 보니 우리 사이트에는 기사 화면이 **두 벌** 있었다.
 *
 *   주소로 직접 진입 (검색·공유·새로고침)  → 서버가 그린 SSR 화면
 *   사이트 안에서 클릭                      → 프런트가 그리는 SPA 화면
 *
 * 그리고 둘이 갈라져 있었다. SSR 에만 FAQ·MORE ARTICLES 가 있었고,
 * 방금 만든 좋아요·댓글·카카오 공유도 SSR 에만 붙었다. 즉 **사이트 안에서
 * 읽는 사람에게는 존재하지 않는 기능**이었다.
 *
 * 그래서 같은 부품을 두 화면이 같이 쓰게 만든다. 이 저장소가 여러 번 배운
 * 교훈이다 — 규칙이 두 벌이면 한쪽만 고쳐진다.
 *
 * 쓰는 법:
 *     PapEngage.mount(container, { kind: 'article', id: '<uuid>', lang: 'ko' })
 *
 * 같은 컨테이너에 두 번 부르면 앞의 것을 지우고 다시 그린다 (SPA 는 화면을
 * 갈아끼우므로 이게 없으면 이벤트 핸들러가 겹쳐 쌓인다).
 */

(function (global) {
  'use strict';

  var TYPES = { article: 1, editorial: 1, film: 1, short: 1 };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var T = {
    ko: { like: '좋아요', likeAria: '이 글에 좋아요', comments: '댓글', jump: '댓글 보기',
          empty: '첫 댓글을 남겨보세요.', placeholder: '이 기사에 대한 생각을 남겨주세요',
          send: '등록', login: '로그인하고 댓글 남기기', del: '삭제', now: '방금',
          kakao: '카카오톡 공유',
          push: '새 화보 알림 받기', pushOn: '알림 받는 중', pushAria: '새 화보 웹 알림 켜기/끄기',
          rateQ: '이 화보가 마음에 드셨나요?', rateAria: '별점 {n}점 주기', rateAvg: '평균',
          ratePeople: '명 참여', rateMine: '내 평점', rateCancel: '취소',
          rateLogin: '로그인하고 별점 남기기', rateNone: '첫 별점을 남겨보세요' },
    en: { like: 'Like', likeAria: 'Like this story', comments: 'Comments', jump: 'Jump to comments',
          empty: 'Be the first to comment.', placeholder: 'Share your thoughts on this story',
          send: 'Post', login: 'Sign in to comment', del: 'Delete', now: 'just now',
          kakao: 'Share on KakaoTalk',
          push: 'Get new drops', pushOn: 'Alerts on', pushAria: 'Toggle new-editorial web alerts',
          rateQ: 'Did you enjoy this editorial?', rateAria: 'Rate {n} stars', rateAvg: 'Avg',
          ratePeople: ' ratings', rateMine: 'Your rating', rateCancel: 'Remove',
          rateLogin: 'Sign in to leave a rating', rateNone: 'Be the first to rate' },
  };

  /* 스타일도 부품이 직접 들고 다닌다 (2026-08-08).
     어제 이 CSS 는 SSR(seoRenderer) 인라인 <style> 에만 있었다. 그래서 같은
     블록이 SSR 에선 매거진 톤, SPA(index/articles.html)에선 **맨몸 버튼**으로
     떴다 — 부품은 합쳤는데 옷은 한 벌만 만든 셈. 규칙이 두 벌이면 한쪽만
     고쳐진다는 교훈은 CSS 에도 그대로 적용된다. (pap-header.js 와 같은
     self-contained 방식. .pe-kko 는 SSR 시절에도 스코프 밖이라 무스타일이었다
     — .ig-funnel .kko-btn 규칙만 있었기 때문. 여기서 처음 입힌다.) */
  var CSS = ''
    + '.pap-engage{max-width:720px;margin:56px auto 0;padding:0 24px}'
    + '.pap-engage .pe-bar{display:flex;align-items:center;gap:14px;padding:18px 0;border-top:1px solid rgba(255,255,255,.14);border-bottom:1px solid rgba(255,255,255,.14);flex-wrap:wrap}'
    + '.pap-engage .pe-like{display:inline-flex;align-items:center;gap:9px;background:transparent;border:1px solid rgba(255,255,255,.28);color:#eee;padding:11px 20px;font-size:12px;font-weight:600;letter-spacing:.06em;cursor:pointer;font-family:inherit;transition:.2s}'
    + '.pap-engage .pe-like:hover{border-color:rgba(255,255,255,.6)}'
    + '.pap-engage .pe-like[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}'
    + '.pap-engage .pe-count{font-variant-numeric:tabular-nums}'
    + '.pap-engage .pe-kko{background:#FEE500;color:#191600;border:0;padding:12px 20px;font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer;font-family:inherit;transition:opacity .2s}'
    + '.pap-engage .pe-kko:hover{opacity:.85}'
    + '.pap-engage .pe-push{display:inline-flex;align-items:center;gap:8px;background:transparent;border:1px solid rgba(255,255,255,.28);color:#eee;padding:11px 18px;font-size:12px;font-weight:600;letter-spacing:.06em;cursor:pointer;font-family:inherit;transition:.2s}'
    + '.pap-engage .pe-push:hover{border-color:rgba(255,255,255,.6)}'
    + '.pap-engage .pe-push[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}'
    + '.pap-engage .pe-rate{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.pap-engage .pe-rate-q{font-size:12.5px;color:#cfcfcf;letter-spacing:.02em}'
    + '.pap-engage .pe-star{background:none;border:0;padding:2px;font-size:20px;line-height:1;color:rgba(255,255,255,.28);cursor:pointer;font-family:inherit;transition:color .15s}'
    + '.pap-engage .pe-star.on{color:#fff}'
    + '.pap-engage .pe-star:hover{color:rgba(255,255,255,.75)}'
    + '.pap-engage .pe-rate-stat{font-size:12px;color:#9a9a9a;font-variant-numeric:tabular-nums}'
    + '.pap-engage .pe-rate-cancel{background:none;border:0;color:#777;font-size:11px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline}'
    + '.pap-engage .pe-rate-login{color:#bbb;font-size:12.5px;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.25)}'
    + '.pap-engage .pe-rate-login:hover{color:#fff}'
    + '.pap-engage .pe-jump{margin-left:auto;color:#9a9a9a;font-size:12px;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.2)}'
    + '.pap-engage h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9a9a9a;margin:36px 0 16px;font-weight:600}'
    + '.pap-engage .pe-form{display:none}'
    + '.pap-engage .pe-form textarea{width:100%;min-height:88px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.16);color:#eee;padding:13px;font:inherit;font-size:14px;line-height:1.6;resize:vertical}'
    + '.pap-engage .pe-form textarea:focus{outline:none;border-color:rgba(255,255,255,.45)}'
    + '.pap-engage .pe-send{margin-top:10px;background:#fff;color:#111;border:0;padding:11px 26px;font-size:12px;font-weight:700;letter-spacing:.08em;cursor:pointer;font-family:inherit}'
    + '.pap-engage .pe-send[disabled]{opacity:.4;cursor:default}'
    + '.pap-engage .pe-login{display:block;padding:18px;border:1px dashed rgba(255,255,255,.2);color:#bbb;font-size:13.5px;text-align:center;text-decoration:none}'
    + '.pap-engage .pe-login:hover{color:#fff;border-color:rgba(255,255,255,.4)}'
    + '.pap-engage .pe-list{list-style:none;padding:0;margin:22px 0 0}'
    + '.pap-engage .pe-list li{padding:16px 0;border-bottom:1px solid rgba(255,255,255,.08)}'
    + '.pap-engage .pe-who{font-size:12px;color:#8f8f8f;margin-bottom:6px;display:flex;gap:8px;align-items:center}'
    + '.pap-engage .pe-body{font-size:14.5px;line-height:1.7;color:#e8e8e8;white-space:pre-wrap;word-break:break-word}'
    + '.pap-engage .pe-del{background:none;border:0;color:#777;font-size:11px;cursor:pointer;padding:0;margin-left:auto;font-family:inherit}'
    + '.pap-engage .pe-empty{color:#7d7d7d;font-size:13.5px;padding:14px 0}'
    + '@media(max-width:640px){.pap-engage{padding:0 18px}}';
  function injectCss() {
    if (document.getElementById('pap-engage-css')) return;
    var st = document.createElement('style');
    st.id = 'pap-engage-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* 카카오 키는 SSR 이면 서버가 심어 두고, SPA 면 물어서 받는다.
     한 번 받으면 재사용한다 — 기사마다 부르면 요청이 조회수만큼 늘어난다. */
  var _cfg = null;
  function config() {
    if (_cfg) return _cfg;
    if (global.__PAP_KAKAO_JS_KEY) {
      _cfg = Promise.resolve({ kakaoJsKey: global.__PAP_KAKAO_JS_KEY });
      return _cfg;
    }
    _cfg = fetch('/api/content/config', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
    return _cfg;
  }

  /* textContent→innerHTML 방식은 **따옴표를 남긴다.** 이 함수의 결과가
     placeholder="…" · data-id="…" 처럼 속성 안에도 들어가므로 그러면 속성
     탈출이 가능하다. 저장소 전체 규칙이고 테스트가 지킨다
     (tests/submission-pullletter-audit.test.js — 이스케이퍼 전수 검사). */
  function esc(x) {
    return String(x == null ? '' : x)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function when(iso, t) {
    var d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (!isFinite(diff)) return '';
    if (diff < 60) return t.now;
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return d.toISOString().slice(0, 10);
  }

  function mount(root, opts) {
    if (!root) return;
    injectCss();
    var o = opts || {};
    var kind = String(o.kind || 'article');
    var id = String(o.id || '');
    if (!TYPES[kind] || !UUID.test(id)) { root.innerHTML = ''; return; }

    var t = T[o.lang] || T.en;
    var qs = '?target_type=' + encodeURIComponent(kind) + '&target_id=' + encodeURIComponent(id);

    /* 다시 그리기 — SPA 는 같은 자리에 다른 기사를 끼우므로 매번 새로 만든다.
       innerHTML 로 통째로 갈아치우면 예전 노드에 붙은 리스너도 같이 사라진다. */
    /* 평가 장치는 한 화면에 하나 (2026-08-09 도메니코 결정) —
       에디토리얼 = 별점: "영화 점수 주듯" 매기는 행위가 참여를 부른다는 판단.
       실측도 이 편이다 (별점 30일 11건 vs 하단 좋아요 이틀 1건).
       기사·필름 = 무로그인 좋아요 유지 (별점이 없어 중복이 아니다). */
    var useRating = (kind === 'editorial');
    var starsHtml = '';
    if (useRating) {
      for (var si = 1; si <= 5; si++) {
        starsHtml += '<button type="button" class="pe-star" data-score="' + si + '" aria-label="'
          + esc(t.rateAria.replace('{n}', si)) + '">★</button>';
      }
    }
    var evalHtml = useRating
      ? '<div class="pe-rate"><span class="pe-rate-q">' + esc(t.rateQ) + '</span>'
        + '<span class="pe-stars">' + starsHtml + '</span>'
        + '<span class="pe-rate-stat"></span></div>'
      : '<button type="button" class="pe-like" aria-pressed="false" aria-label="' + esc(t.likeAria) + '">'
        + '<span aria-hidden="true">♡</span><span>' + esc(t.like) + '</span> <span class="pe-count">0</span>'
        + '</button>';

    root.innerHTML =
      '<section class="pap-engage" data-target-type="' + esc(kind) + '" data-target-id="' + esc(id) + '">'
      + '<div class="pe-bar">'
      + evalHtml
      + '<button type="button" class="kko-btn pe-kko" hidden>' + esc(t.kakao) + '</button>'
      + '<button type="button" class="pe-push" hidden aria-pressed="false" aria-label="' + esc(t.pushAria) + '"><span aria-hidden="true">🔔</span><span class="pe-push-label">' + esc(t.push) + '</span></button>'
      + '<a class="pe-jump" href="#peComments">' + esc(t.jump) + '</a>'
      + '</div>'
      + '<h2 id="peComments">' + esc(t.comments) + '</h2>'
      + '<div class="pe-compose"></div>'
      + '<ul class="pe-list"></ul>'
      + '<div class="pe-empty" hidden>' + esc(t.empty) + '</div>'
      + '</section>';

    var $ = function (s) { return root.querySelector(s); };
    var likeBtn = $('.pe-like'), countEl = $('.pe-count'), listEl = $('.pe-list');
    var emptyEl = $('.pe-empty'), composeEl = $('.pe-compose'), kkoBtn = $('.pe-kko');
    var busy = false;

    // ── 좋아요 (기사·필름) ─────────────────────────────────
    if (likeBtn) {
      var paint = function (d) {
        countEl.textContent = d.count || 0;
        likeBtn.setAttribute('aria-pressed', d.mine ? 'true' : 'false');
      };
      fetch('/api/content/react' + qs, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) paint(d); }).catch(function () {});

      likeBtn.addEventListener('click', function () {
        if (busy) return; busy = true;
        /* 낙관적 반영 — 왕복을 기다리면 눌린 느낌이 안 난다. 실패하면 되돌린다. */
        var wasOn = likeBtn.getAttribute('aria-pressed') === 'true';
        var before = Number(countEl.textContent) || 0;
        paint({ count: Math.max(0, before + (wasOn ? -1 : 1)), mine: !wasOn });
        fetch('/api/content/react', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_type: kind, target_id: id }),
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { paint(d || { count: before, mine: wasOn }); })
          .catch(function () { paint({ count: before, mine: wasOn }); })
          .then(function () { busy = false; });
      });
    }

    // ── 별점 (에디토리얼) ──────────────────────────────────
    if (useRating) setupRating(root, o, t);

    // ── 댓글 ───────────────────────────────────────────────
    function paintList(items) {
      listEl.innerHTML = '';
      if (!items.length) { emptyEl.hidden = false; return; }
      emptyEl.hidden = true;
      items.forEach(function (c) {
        var li = document.createElement('li');
        li.innerHTML = '<div class="pe-who"><strong>' + esc(c.author) + '</strong><span>' + esc(when(c.created_at, t)) + '</span>'
          + (c.mine ? '<button type="button" class="pe-del" data-id="' + esc(c.id) + '">' + esc(t.del) + '</button>' : '')
          + '</div><div class="pe-body">' + esc(c.body) + '</div>';
        listEl.appendChild(li);
      });
    }
    function load() {
      fetch('/api/content/comments' + qs, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (d) { paintList(d.items || []); }).catch(function () {});
    }
    load();

    listEl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.pe-del');
      if (!b) return;
      fetch('/api/content/comments?id=' + encodeURIComponent(b.dataset.id), {
        method: 'DELETE', credentials: 'same-origin',
      }).then(load).catch(function () {});
    });

    /* 로그인 여부를 미리 묻지 않는다. 폼을 먼저 보여주고 401 이 오면 그때
       안내한다 — "쓰려고 했는데 로그인이 필요하다" 가 가입 전환이 제일 잘
       되는 순간이다. (httpOnly 쿠키라 프런트가 로그인 여부를 못 읽기도 한다) */
    composeEl.innerHTML = '<div class="pe-form" style="display:block">'
      + '<textarea maxlength="1000" placeholder="' + esc(t.placeholder) + '"></textarea>'
      + '<button type="button" class="pe-send">' + esc(t.send) + '</button></div>';
    var bodyEl = composeEl.querySelector('textarea');
    var sendEl = composeEl.querySelector('.pe-send');
    sendEl.addEventListener('click', function () {
      var v = (bodyEl.value || '').trim();
      if (!v) return;
      sendEl.disabled = true;
      fetch('/api/content/comments', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: kind, target_id: id, body: v }),
      }).then(function (r) {
        if (r.status === 401) {
          composeEl.innerHTML = '<a class="pe-login" href="/auth?next='
            + encodeURIComponent(location.pathname) + '">' + esc(t.login) + '</a>';
          return null;
        }
        return r.ok ? r.json() : null;
      }).then(function (d) { if (d) { bodyEl.value = ''; load(); } })
        .catch(function () {})
        .then(function () { sendEl.disabled = false; });
    });

    // ── 새 화보 알림 (웹 푸시, B-7 2026-08-09) ─────────────
    setupPush($('.pe-push'), t);

    // ── 카카오 공유 ────────────────────────────────────────
    config().then(function (c) {
      var key = c && c.kakaoJsKey;
      if (!key || !kkoBtn) return;          // 키 없으면 버튼을 안 보여준다
      loadKakao(key).then(function (ok) {
        if (!ok) return;
        kkoBtn.hidden = false;
        kkoBtn.addEventListener('click', function () {
          var url = location.origin + location.pathname
            + (location.search ? location.search + '&' : '?') + 'utm_source=kakao&utm_medium=share';
          try {
            global.Kakao.Share.sendDefault({
              objectType: 'feed',
              content: {
                title: (o.title || document.title || '').slice(0, 80),
                description: (o.desc || '').slice(0, 110),
                imageUrl: o.image || '',
                link: { mobileWebUrl: url, webUrl: url },
              },
              buttons: [{ title: (o.lang === 'ko' ? '기사 보기' : 'Read'), link: { mobileWebUrl: url, webUrl: url } }],
            });
          } catch (e) { /* 공유 실패가 페이지를 망가뜨리지 않는다 */ }
        });
      });
    });
  }

  /* ── 별점 (에디토리얼 평가 장치, 2026-08-09) ─────────────
     ratings 테이블·API 재사용 (키 = 제목 80자 — SSR 이 title 을 80자로
     자르므로 SPA 도 같이 잘라야 SSR/SPA 가 같은 키를 본다).
     쓰기는 로그인 필요(보안 감사 A-2) — 401 이면 로그인 링크로 바꾼다.
     "쓰려고 했는데 로그인이 필요하다"가 가입 전환이 제일 잘 되는 순간
     (댓글과 같은 원칙). 통계 조회는 로그인 불필요. */
  function setupRating(root, o, t) {
    var wrap = root.querySelector('.pe-rate');
    if (!wrap) return;
    var statEl = wrap.querySelector('.pe-rate-stat');
    var stars = wrap.querySelectorAll('.pe-star');
    var key = String(o.title || '').slice(0, 80);
    if (!key) { wrap.hidden = true; return; }
    var qs = '?editorial_title=' + encodeURIComponent(key);
    var busy = false;

    function paint(d) {
      var my = d.myScore || 0;
      var show = my || Math.round(d.avg || 0);
      for (var i = 0; i < stars.length; i++) {
        stars[i].className = 'pe-star' + (i < show ? ' on' : '');
      }
      var txt = !d.count ? t.rateNone
        : t.rateAvg + ' ' + (d.avg || 0) + ' · ' + d.count + t.ratePeople;
      if (my) txt = t.rateMine + ' ' + my + ' · ' + txt;
      statEl.innerHTML = esc(txt)
        + (my ? ' <button type="button" class="pe-rate-cancel">' + esc(t.rateCancel) + '</button>' : '');
      var cx = statEl.querySelector('.pe-rate-cancel');
      if (cx) cx.addEventListener('click', function () { send('DELETE', 0); });
    }
    function load() {
      fetch('/api/social/ratings' + qs, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) paint(d); }).catch(function () {});
    }
    function send(method, score) {
      if (busy) return; busy = true;
      fetch('/api/social/ratings', {
        method: method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'DELETE'
          ? { editorial_title: key }
          : { editorial_title: key, score: score }),
      }).then(function (r) {
        if (r.status === 401) {
          wrap.innerHTML = '<a class="pe-rate-login" href="/auth?next='
            + encodeURIComponent(location.pathname) + '">' + esc(t.rateLogin) + '</a>';
          return null;
        }
        if (r.ok) load();
        return null;
      }).catch(function () {})
        .then(function () { busy = false; });
    }
    for (var i = 0; i < stars.length; i++) (function (btn) {
      btn.addEventListener('click', function () {
        send('POST', Number(btn.getAttribute('data-score')) || 0);
      });
    })(stars[i]);
    load();
  }

  /* ── 웹 푸시 (B-7) ──────────────────────────────────────
     원칙: 지원 안 되는 브라우저·VAPID 공개키 미배포 상태에서는 버튼 자체가
     안 보인다 — 눌러도 안 되는 버튼은 신뢰를 깎는다. 공개키는 공개값이라
     설정 API 로 받아도 안전하다 (비밀키는 서버 env 에만 있고 여기 안 온다). */
  var _vapid = null;
  function vapidKey() {
    if (_vapid) return _vapid;
    _vapid = fetch('/api/content/config', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (c) { return (c && c.vapidPublicKey) || ''; })
      .catch(function () { return ''; });
    return _vapid;
  }

  /* applicationServerKey 는 URL-safe base64 를 Uint8Array 로 바꿔 줘야 한다 */
  function urlB64ToU8(s) {
    var pad = '===='.slice(0, (4 - (s.length % 4)) % 4);
    var b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = global.atob(b64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function paintPush(btn, t, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.querySelector('.pe-push-label').textContent = on ? t.pushOn : t.push;
  }

  function setupPush(btn, t) {
    if (!btn) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in global) || !global.Notification) return;
    vapidKey().then(function (key) {
      if (!key) return;
      navigator.serviceWorker.register('/pap-push-sw.js')
        .then(function () { return navigator.serviceWorker.ready; })
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) {
          btn.hidden = false;
          paintPush(btn, t, !!sub);
          var busy = false;
          btn.addEventListener('click', function () {
            if (busy) return; busy = true;
            var done = function () { busy = false; };
            navigator.serviceWorker.ready.then(function (reg) {
              return reg.pushManager.getSubscription().then(function (cur) {
                if (cur) {
                  /* 끄기: 브라우저 구독 해지 + 서버에 알림 (실패해도 로컬은 꺼진다) */
                  var ep = cur.endpoint;
                  return cur.unsubscribe().then(function () {
                    paintPush(btn, t, false);
                    return fetch('/api/push/subscribe', {
                      method: 'DELETE', credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ endpoint: ep }),
                    }).catch(function () {});
                  });
                }
                /* 켜기: 권한 → 구독 → 서버 저장. 거부하면 조용히 원상태 */
                return global.Notification.requestPermission().then(function (perm) {
                  if (perm !== 'granted') return;
                  return reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlB64ToU8(key),
                  }).then(function (sub2) {
                    return fetch('/api/push/subscribe', {
                      method: 'POST', credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(sub2.toJSON()),
                    }).then(function (r) {
                      if (r && r.ok) { paintPush(btn, t, true); return; }
                      /* 서버 저장 실패면 죽은 구독을 남기지 않는다 */
                      return sub2.unsubscribe().catch(function () {});
                    });
                  });
                });
              });
            }).catch(function () {}).then(done, done);
          });
        })
        .catch(function () {});   // SW 등록 실패 — 버튼 미노출
    });
  }

  var _sdk = null;
  function loadKakao(key) {
    if (_sdk) return _sdk;
    _sdk = new Promise(function (resolve) {
      function init() {
        try {
          if (!global.Kakao.isInitialized()) global.Kakao.init(key);
          resolve(true);
        } catch (e) { resolve(false); }
      }
      if (global.Kakao) return init();
      var s = document.createElement('script');
      s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
      s.integrity = 'sha384-TiCUE00h649CAMonG018J2ujOgDKW/kVWlChEuu4jK2vxfAAD0eZxzCKakxg55G4';
      s.crossOrigin = 'anonymous';
      s.onload = init;
      s.onerror = function () { resolve(false); };   // CSP 차단·네트워크 실패
      document.head.appendChild(s);
    });
    return _sdk;
  }

  global.PapEngage = { mount: mount, T: T };
})(window);
