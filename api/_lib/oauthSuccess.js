/**
 * OAuth 성공 랜딩 — 토큰/유저를 HTML 본문에 심어 localStorage에 저장 후 이동.
 *
 * 2026-07-12. 커스텀 소셜 콜백(google-callback, kakao-callback)이 공용으로 사용.
 * URL 쿼리(?oauth=success)는 auth.html 초기 IIFE가 제거하고, URL 프래그먼트
 * (#token=)는 Safari ITP·Chrome link-decoration이 교차사이트 체인에서 조용히
 * 제거할 수 있다. callback.js(페이스북)가 검증한 것과 동일하게, HTML을 직접
 * 반환해 URL 기반 토큰 전송을 아예 우회한다.
 *
 * @param {object} res  Vercel response
 * @param {string} token  PAP JWT
 * @param {object} user  { id, email, name, role, subscription }
 * @param {string[]} [extraClearCookies]  추가로 만료시킬 쿠키(Set-Cookie 문자열)
 */
function sendOAuthSuccessHtml(res, token, user, extraClearCookies) {
  var clear = ['oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'];
  if (Array.isArray(extraClearCookies)) clear = clear.concat(extraClearCookies);
  res.setHeader('Set-Cookie', clear);

  // JSON.stringify로 문자열/객체를 <script>에 안전 인라인 + </script 조기 종료 방지
  var safeToken = JSON.stringify(String(token)).replace(/<\/(script)/gi, '<\\/$1');
  var safeUser = JSON.stringify({
    id: user.id, email: user.email, name: user.name,
    role: user.role, subscription: user.subscription,
  }).replace(/<\/(script)/gi, '<\\/$1');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>로그인 처리 중…</title>' +
    '<style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center}p{opacity:.7;font-size:14px}</style>' +
    '</head><body><p>로그인 처리 중…</p>' +
    '<script>(function(){' +
      'try{' +
        'var t=' + safeToken + ';' +
        'var u=' + safeUser + ';' +
        'localStorage.setItem("pap-token",t);' +
        'localStorage.setItem("pap-user",JSON.stringify({id:u.id,email:u.email,name:u.name,role:u.role,subscription:u.subscription}));' +
      '}catch(e){}' +
      // socialLogin()이 OAuth 라운드트립 전에 심은 pap-return-url 쿠키로 복귀 경로
      // 결정, 없으면 /mypage.html. 절대경로 사용(이 스크립트는 /api/auth/* 컨텍스트).
      'var dest="/mypage.html";' +
      'try{' +
        'var m=document.cookie.match(/(?:^|; )pap-return-url=([^;]+)/);' +
        'if(m){' +
          'document.cookie="pap-return-url=; Path=/; Max-Age=0; SameSite=Lax";' +
          'var d=decodeURIComponent(m[1]);' +
          'if(d&&d.indexOf("://")===-1&&d.indexOf("//")!==0){' +
            'dest=d.charAt(0)==="/"?d:"/"+d;' +
          '}' +
        '}' +
      '}catch(e){}' +
      'window.location.replace(dest);' +
    '})();<\/script>' +
    '</body></html>'
  );
}

module.exports = { sendOAuthSuccessHtml };
