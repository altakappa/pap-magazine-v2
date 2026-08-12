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
          rateLogin: '로그인하고 별점 남기기', rateNone: '첫 별점을 남겨보세요',
          rateNudge: '로그인하면 내 별점이 기기를 옮겨도 남아요', rateNudgeCta: '로그인' },
    en: { like: 'Like', likeAria: 'Like this story', comments: 'Comments', jump: 'Jump to comments',
          empty: 'Be the first to comment.', placeholder: 'Share your thoughts on this story',
          send: 'Post', login: 'Sign in to comment', del: 'Delete', now: 'just now',
          kakao: 'Share on KakaoTalk',
          push: 'Get new drops', pushOn: 'Alerts on', pushAria: 'Toggle new-editorial web alerts',
          rateQ: 'Did you enjoy this editorial?', rateAria: 'Rate {n} stars', rateAvg: 'Avg',
          ratePeople: ' ratings', rateMine: 'Your rating', rateCancel: 'Remove',
          rateLogin: 'Sign in to leave a rating', rateNone: 'Be the first to rate',
          rateNudge: 'Sign in to keep your ratings across devices', rateNudgeCta: 'Sign in' },
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
    + '.pap-engage .pe-like{display:inline-flex;align-items:center;gap:9px;background:transparent;border:1px solid rgba(255,255,255,.28);color:#eee;height:40px;box-sizing:border-box;padding:0 20px;font-size:12px;font-weight:600;letter-spacing:.06em;cursor:pointer;font-family:inherit;transition:.2s}'
    + '.pap-engage .pe-like:hover{border-color:rgba(255,255,255,.6)}'
    + '.pap-engage .pe-like[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}'
    + '.pap-engage .pe-count{font-variant-numeric:tabular-nums}'
    + '.pap-engage .pe-kko{background:#FEE500;color:#191600;border:0;display:inline-flex;align-items:center;height:40px;box-sizing:border-box;padding:0 20px;line-height:1;font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer;font-family:inherit;transition:opacity .2s}'
    + '.pap-engage .pe-kko:hover{opacity:.85}'
    + '.pap-engage .pe-push{display:inline-flex;align-items:center;gap:8px;background:transparent;border:1px solid rgba(255,255,255,.28);color:#eee;height:40px;box-sizing:border-box;padding:0 18px;line-height:1;font-size:12px;font-weight:600;letter-spacing:.06em;cursor:pointer;font-family:inherit;transition:.2s}'
    + '.pap-engage .pe-push:hover{border-color:rgba(255,255,255,.6)}'
    + '.pap-engage .pe-push[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}'
    + '.pap-engage.pe-rate-solo{margin:36px auto 0;text-align:center}'
    + '.pap-engage.pe-rate-solo .pe-rate{display:inline-flex;justify-content:center}'
    + '.pap-engage .pe-rate{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.pap-engage .pe-rate-q{font-size:12.5px;color:#cfcfcf;letter-spacing:.02em}'
    + '.pap-engage .pe-star{background:none;border:0;padding:2px;font-size:20px;line-height:1;color:rgba(255,255,255,.28);cursor:pointer;font-family:inherit;transition:color .15s}'
    /* 별색 = 브랜드 딥레드 (--pap-red, 2026-08-10 도메니코). hov 는 마우스가
       올라간 별까지 전부 칠하는 프리뷰 — "어디를 눌러야 5점인지" 모호함 제거. */
    + '.pap-engage .pe-star.on{color:var(--pap-red,#891717)}'
    + '.pap-engage .pe-star.hov{color:#b32424;transform:scale(1.12)}'
    + '.pap-engage .pe-star{transition:color .15s,transform .15s}'
    /* 유도 장치: 아직 내 별점이 없으면 빈 별이 왼→오 순서로 은은히 붉게
       물결친다. 마우스를 올리면 멈추고 프리뷰가 이어받는다. */
    + '.pap-engage .pe-rate.pe-nudge .pe-star:not(.on){animation:peStarWave 2.8s infinite}'
    + '.pap-engage .pe-rate.pe-nudge .pe-star:nth-child(2){animation-delay:.14s}'
    + '.pap-engage .pe-rate.pe-nudge .pe-star:nth-child(3){animation-delay:.28s}'
    + '.pap-engage .pe-rate.pe-nudge .pe-star:nth-child(4){animation-delay:.42s}'
    + '.pap-engage .pe-rate.pe-nudge .pe-star:nth-child(5){animation-delay:.56s}'
    + '.pap-engage .pe-rate.pe-nudge .pe-stars:hover .pe-star{animation:none}'
    + '@keyframes peStarWave{0%,30%,100%{color:rgba(255,255,255,.28)}12%{color:var(--pap-red,#891717)}}'
    + '@media(prefers-reduced-motion:reduce){.pap-engage .pe-rate.pe-nudge .pe-star:not(.on){animation:none}}'
    + '.pap-engage .pe-rate-stat{font-size:12px;color:#9a9a9a;font-variant-numeric:tabular-nums}'
    + '.pap-engage .pe-rate-cancel{background:none;border:0;color:#777;font-size:11px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline}'
    + '.pap-engage .pe-rate-login{color:#bbb;font-size:12.5px;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.25)}'
    + '.pap-engage .pe-rate-login:hover{color:#fff}'
    /* 별점 후 로그인 권유 (2026-08-12) — 벽이 아니라 한 줄 초대. 조용해야 한다. */
    + '.pap-engage .pe-rate-nudge{flex-basis:100%;margin-top:8px;color:#8a8a8a;font-size:11.5px;line-height:1.7}'
    + '.pap-engage .pe-rate-nudge a{color:#c33b3b;text-decoration:none;border-bottom:1px solid rgba(195,59,59,.45);margin-left:4px}'
    + '.pap-engage .pe-rate-nudge a:hover{color:#fff;border-color:rgba(255,255,255,.5)}'
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
       기사·필름 = 무로그인 좋아요 유지 (별점이 없어 중복이 아니다).
       별점 위치는 이 바가 아니라 **사진 바로 아래** — mountRating() 을
       SSR(papRatingMount)·SPA(edRatingCta) 가 따로 부른다 ("감상 직후가
       평가의 순간" — 옛 별점 CTA 의 자리 그대로). 이 바에서는 뺀다. */
    var useRating = (kind === 'editorial');
    var evalHtml = useRating
      ? ''
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

  /* 별점 단독 마운트 (2026-08-09 도메니코: "별점은 사진들 바로 아래에") —
     감상이 끝난 그 순간이 평가의 순간이라는 옛 별점 CTA 의 자리 그대로.
     SSR 은 papRatingMount, SPA 는 edRatingCta 에 이 함수를 부른다.
     두 화면이 같은 부품 — 규칙이 두 벌이면 한쪽만 고쳐진다. */
  function mountRating(root, opts) {
    if (!root) return;
    var o = opts || {};
    if (String(o.kind || '') !== 'editorial') { root.innerHTML = ''; return; }
    injectCss();
    var t = T[o.lang] || T.en;
    var starsHtml = '';
    for (var si = 1; si <= 5; si++) {
      starsHtml += '<button type="button" class="pe-star" data-score="' + si + '" aria-label="'
        + esc(t.rateAria.replace('{n}', si)) + '">★</button>';
    }
    root.innerHTML = '<div class="pap-engage pe-rate-solo"><div class="pe-rate">'
      + '<span class="pe-rate-q">' + esc(t.rateQ) + '</span>'
      + '<span class="pe-stars">' + starsHtml + '</span>'
      + '<span class="pe-rate-stat"></span></div></div>';
    setupRating(root, o, t);
  }

  /* ── 별점 (에디토리얼 평가 장치, 2026-08-09) ─────────────
     ratings 테이블·API 재사용 (키 = 제목 80자 — SSR 이 title 을 80자로
     자르므로 SPA 도 같이 잘라야 SSR/SPA 가 같은 키를 본다).
     쓰기는 **로그인 불필요**(2026-08-12 도메니코 결정). 실측: 에디토리얼
     조회 30일 11,003건 중 로그인 조회는 56건(0.5%)뿐이었다. 유일한 평가
     장치를 로그인 뒤에 두면 99.5%에게는 누를 게 없다 — 성장 헌법 7항의
     사다리 1단은 문턱이 0이어야 한다.
     사다리를 없앤 게 아니라 뒤로 미뤘다: 별점을 남긴 **직후에** 로그인
     권유를 한 줄 띄운다(벽이 아니라 권유). 서버가 anon:true 로 알려준다.
     401 분기는 안전망으로 남긴다 — 이제 정상 경로에서는 오지 않는다. */
  function setupRating(root, o, t) {
    var wrap = root.querySelector('.pe-rate');
    if (!wrap) return;
    var statEl = wrap.querySelector('.pe-rate-stat');
    var stars = wrap.querySelectorAll('.pe-star');
    var key = String(o.title || '').slice(0, 80);
    if (!key) { wrap.hidden = true; return; }
    var qs = '?editorial_title=' + encodeURIComponent(key);
    var busy = false;

    var last = null; /* 마지막 로드 상태 — 호버 프리뷰가 끝나면 되돌린다 */
    function paint(d) {
      last = d;
      var my = d.myScore || 0;
      var show = my || Math.round(d.avg || 0);
      for (var i = 0; i < stars.length; i++) {
        stars[i].className = 'pe-star' + (i < show ? ' on' : '');
      }
      /* 유도 웨이브는 내가 아직 별점을 안 남겼을 때만 */
      wrap.classList.toggle('pe-nudge', !my);
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
    /* 별점을 남긴 비로그인 독자에게만, 한 번만. 다음 계단으로 가는 초대다. */
    function showNudge() {
      if (wrap.querySelector('.pe-rate-nudge')) return;
      var n = document.createElement('div');
      n.className = 'pe-rate-nudge';
      n.innerHTML = esc(t.rateNudge) + ' <a href="/auth?next='
        + encodeURIComponent(location.pathname) + '">' + esc(t.rateNudgeCta) + '</a>';
      wrap.appendChild(n);
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
          /* 안전망 — 무로그인 개방 이후 정상 경로에서는 오지 않는다 */
          wrap.innerHTML = '<a class="pe-rate-login" href="/auth?next='
            + encodeURIComponent(location.pathname) + '">' + esc(t.rateLogin) + '</a>';
          return null;
        }
        if (!r.ok) return null;
        return r.json().catch(function () { return null; }).then(function (d) {
          load();
          /* 사다리 2단 — 남기고 나서 권유한다. 막지 않는다. */
          if (method === 'POST' && d && d.anon) showNudge();
          return null;
        });
      }).catch(function () {})
        .then(function () { busy = false; });
    }
    /* 호버 프리뷰: n번째 별에 마우스 → 1~n번을 전부 칠한다 (클릭 결과 예고) */
    function previewTo(n) {
      for (var i = 0; i < stars.length; i++) {
        stars[i].className = 'pe-star' + (i < n ? ' hov' : '');
      }
    }
    for (var i = 0; i < stars.length; i++) (function (btn) {
      btn.addEventListener('click', function () {
        send('POST', Number(btn.getAttribute('data-score')) || 0);
      });
      btn.addEventListener('mouseenter', function () {
        previewTo(Number(btn.getAttribute('data-score')) || 0);
      });
    })(stars[i]);
    var starsBox = wrap.querySelector('.pe-stars');
    if (starsBox) starsBox.addEventListener('mouseleave', function () {
      if (last) paint(last);
      else previewTo(0);
    });
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

  global.PapEngage = { mount: mount, mountRating: mountRating, T: T };
})(window);
