/**
 * PAP Magazine — 정적 랜딩 페이지용 인바운드 계측 비콘 (2026-08-12)
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * `logSocialInclick` 은 SSR 상세 3곳(article · editorial · pepperit)에서만 돌았다.
 * 그런데 우리가 밖으로 내보내는 링크가 실제로 도착하는 곳은 대부분 **홈과 목록
 * 페이지**다 — 인스타 바이오 링크, 네이버 블로그 프로필, 뉴스레터 헤더 전부.
 * 그 페이지들은 사람에게 정적 HTML 로 나가므로(vercel.json: /→index.html,
 * /articles→articles.html …) 서버 함수가 **아예 실행되지 않는다.**
 * 즉 utm 을 아무리 정성껏 붙여도 기록될 자리가 없었다.
 *
 * 실측(2026-08-12, 최근 30일 social_inclicks):
 *     src='ig'       4건   ← 팔로워 38만 계정에서 30일에 4명
 *     src='naver'    0건   ← 네이버 블로그를 매주 발행하는데 0
 *     웹→IG 아웃클릭  4,058건
 * 아웃은 4천인데 인이 4다. 이 비대칭의 상당 부분이 트래픽이 아니라 **계측 공백**이었다.
 * 채널이 죽었는지 계측이 없는 건지 구분하지 못하면 어느 쪽도 못 고친다.
 *
 * 설계 ──────────────────────────────────────────────────────────────
 * - utm_source 가 있을 때만 프론트(pap-inclick.js)가 이 엔드포인트를 부른다.
 * - 실제 기록은 SSR 과 **같은 함수**(logSocialInclick)를 쓴다. 규칙을 두 벌로
 *   만들지 않는다 (GROWTH-LEDGER 교훈 2).
 * - 봇 제외·IP 해시·리퍼러 정제도 그 함수 안에서 이미 처리된다.
 * - 상세 페이지(SSR)에는 이 스크립트를 넣지 않는다 — 넣으면 이중 집계된다.
 * - 실패는 삼키고 항상 204. 계측이 사용자 화면에 영향을 주면 안 된다.
 */

const { logSocialInclick } = require('./_lib/socialInclick');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }

  try {
    const q = req.query || {};
    const page = String(q.page || 'landing').slice(0, 40);

    /* logSocialInclick 은 path 를 req.url 에서 뽑는다. 그대로 두면 모든 행의
       path 가 '/api/inclick' 이 되어 "어느 페이지로 들어왔는가"를 잃는다.
       프로토타입 상속으로 url 만 착륙 경로로 덮어쓴다 — headers·query·socket
       은 원본 req 를 그대로 본다(IP 추출이 socket 을 쓸 수 있어 복사하지 않는다). */
    const landing = '/' + String(q.path || '').replace(/^\/+/, '').split('?')[0].slice(0, 299);
    const shim = Object.create(req);
    shim.url = landing;

    /* 리퍼러도 바꿔치기 (2026-08-25) ──────────────────────────────────
       이 엔드포인트는 우리 페이지의 fetch 로 불린다. 그래서 Referer 헤더는
       착륙 페이지 자신이다 — 바깥 출처 정보가 아니다. 프론트가 실어 보낸
       document.referrer(q.ref)가 진짜 바깥 주소다. 그것으로 갈아 끼운다.

       q.ref 가 없으면 referer 를 **지운다**. 남겨 두면 우리 자신이 되어
       socialInclick 의 자기 리퍼러 차단에 걸려 이 유입이 사라진다. 지우면
       '리퍼러 없음'으로 정상 기록된다 — 캐시된 옛 pap-inclick.js 가 도는
       동안에도 숫자가 새지 않는다.

       headers 만 얕게 복사한다. x-forwarded-for·user-agent 는 그대로 살아야
       IP 해시와 기기 판정이 원본과 같다. socket 은 프로토타입으로 상속된다. */
    const hdr = Object.assign({}, req.headers || {});
    delete hdr.referer;
    delete hdr.referrer;
    const outerRef = String(q.ref || '').trim().slice(0, 500);
    if (outerRef) hdr.referer = outerRef;
    shim.headers = hdr;

    await logSocialInclick(shim, page);
  } catch (e) {
    console.warn('[inclick] threw', e && e.message);
  }

  return res.status(204).end();
};
