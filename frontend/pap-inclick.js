/**
 * PAP Magazine — 인바운드 유입 계측 비콘 (프론트, 2026-08-12)
 *
 * 정적으로 나가는 랜딩 페이지(홈·목록·소개 등)는 서버 함수를 거치지 않아
 * utm 이 붙어 들어와도 기록될 자리가 없었다. 이 파일이 그 자리를 만든다.
 * 상세 페이지(에디토리얼·기사)는 SSR 에서 이미 기록하므로 **넣지 않는다** —
 * 넣으면 같은 방문이 두 번 세어진다.
 *
 * 원칙
 *  - utm_source 가 없으면 아무것도 하지 않는다 (검색·직접 유입은 대상 아님).
 *  - 세션당 같은 (출처, 경로) 조합 1회만 — 새로고침·뒤로가기 중복 방지.
 *  - 실패는 전부 삼킨다. 계측이 페이지를 망가뜨리면 안 된다.
 */
(function () {
  try {
    if (typeof window === 'undefined' || !window.location) return;

    var params = new URLSearchParams(window.location.search);
    var src = params.get('utm_source');
    if (!src) return;

    var path = window.location.pathname || '/';

    // 세션당 1회 (sessionStorage 가 막힌 환경이면 그냥 보낸다 — 없는 것보다 낫다)
    var key = 'pap_inclick:' + src + ':' + path;
    try {
      if (window.sessionStorage && window.sessionStorage.getItem(key)) return;
      if (window.sessionStorage) window.sessionStorage.setItem(key, '1');
    } catch (e) { /* private mode 등 — 통과 */ }

    // page 라벨은 경로에서 뽑는다. 별도 설정 파일을 만들지 않는다.
    var page = path === '/' ? 'home'
      : path.replace(/^\/+/, '').split('/')[0].slice(0, 40) || 'landing';

    var qs = 'utm_source=' + encodeURIComponent(src)
      + '&page=' + encodeURIComponent(page)
      + '&path=' + encodeURIComponent(path);
    var campaign = params.get('utm_campaign');
    if (campaign) qs += '&utm_campaign=' + encodeURIComponent(campaign);

    var url = '/api/inclick?' + qs;

    if (window.fetch) {
      window.fetch(url, { method: 'GET', credentials: 'omit', keepalive: true })
        .catch(function () { /* 조용히 실패 */ });
    } else if (window.navigator && window.navigator.sendBeacon) {
      window.navigator.sendBeacon(url);
    }
  } catch (e) { /* 계측은 절대 페이지를 막지 않는다 */ }
})();

/* ────────────────────────────────────────────────────────────────
 * 네이버 애널리틱스 (2026-08-13 추가)
 *
 * 왜 여기 붙였나 — NAVER_ANALYTICS_ID 는 seoRenderer(SSR)에만 심겨 있었다.
 * 그런데 SSR 은 **봇에게만** 나간다. 사람은 정적 HTML 을 받는다. 즉 계정번호를
 * 넣어도 사람은 한 명도 세어지지 않는 상태였다. 위 인클릭 비콘이 2026-08-12 에
 * 고친 것과 **글자 그대로 같은 구멍**이다.
 *
 * 이 파일은 사람이 받는 정적 랜딩에만 실리고 SSR 상세에는 실리지 않는다.
 * 그래서 여기 두면 SSR 쪽 기존 코드와 겹치지 않는다 — 이중 집계가 없다.
 *
 * 계정번호가 없으면(환경변수 미설정) 아무것도 하지 않는다. 네이버 스크립트도
 * 부르지 않는다 — 쓸데없는 외부 요청을 만들지 않기 위해서.
 * 실패는 전부 삼킨다. 계측이 페이지를 망가뜨리면 안 된다.
 * ──────────────────────────────────────────────────────────────── */
(function () {
  try {
    if (typeof window === 'undefined' || !window.fetch) return;

    window.fetch('/api/content/config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        var id = cfg && cfg.naverAnalyticsId;
        if (!id) return;                       // 계정번호 없으면 조용히 끝

        /* 호스트가 두 개다 — 2026-08-13 실측(브라우저에서 순서 바꿔 2회 확인):
             wcs.naver.net    → 로드 성공  ✅
             wcs.pstatic.net  → 로드 실패  ❌
           그런데 **네이버 콘솔이 발급해 주는 스니펫은 pstatic 을 쓴다.**
           지금 되는 쪽(naver.net)을 먼저 쓰고, 실패하면 콘솔이 안내하는
           쪽(pstatic)으로 넘어간다. 한쪽이 죽어도 계측이 조용히 멈추지 않는다.
           — 오늘만 "심어놨는데 아무도 안 세어지고 있었다"를 네 번 만났다. */
        var HOSTS = ['//wcs.naver.net/wcslog.js', '//wcs.pstatic.net/wcslog.js'];

        function fire() {
          try {
            if (!window.wcs) return false;
            if (!window.wcs_add) window.wcs_add = {};
            window.wcs_add.wa = id;
            if (window.wcs.inflow) window.wcs.inflow('pap-magazine.com');
            if (window.wcs_do) window.wcs_do();
            return true;
          } catch (e) { return false; }
        }

        (function load(i) {
          if (i >= HOSTS.length) return;            // 둘 다 실패 — 조용히 포기
          var tag = document.createElement('script');
          tag.src = HOSTS[i];
          tag.defer = true;
          tag.onload = function () { if (!fire()) load(i + 1); };
          tag.onerror = function () { load(i + 1); };
          document.head.appendChild(tag);
        })(0);
      })
      .catch(function () { /* 조용히 실패 */ });
  } catch (e) { /* 계측은 절대 페이지를 막지 않는다 */ }
})();
