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
