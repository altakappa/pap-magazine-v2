'use strict';
/**
 * 비회원 뉴스레터 확인·수신거부 결과 페이지 (2026-09-25). 메일에서 바로 열리는 주소라 JS 없이 HTML 한 장.
 * 문구는 newsletterCopy.js (9개 언어). 검색 노출 안 함.
 */
const { nlCopy, normLang } = require('./newsletterCopy');
const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** kind: 'confirmed' | 'invalid' | 'unsub' */
function newsletterPage(kind, lang) {
  const l = normLang(lang);
  const C = nlCopy(l);
  const map = {
    confirmed: { t: C.confirmedTitle, b: C.confirmedBody, href: FRONTEND_URL + '/?utm_source=newsletter&utm_medium=email&utm_campaign=newsletter_confirm', cta: C.homeCta },
    invalid: { t: C.invalidTitle, b: C.invalidBody, href: FRONTEND_URL + '/newsletter', cta: C.resubCta },
    unsub: { t: C.unsubTitle, b: C.unsubBody, href: FRONTEND_URL + '/newsletter', cta: C.resubCta },
  };
  const m = map[kind] || map.invalid;
  return `<!DOCTYPE html>
<html lang="${l}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(m.t)} · PAP Magazine</title>
<style>
body{margin:0;background:#000;color:#fff;font-family:'Montserrat',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px 20px;box-sizing:border-box;word-break:keep-all}
.card{max-width:480px;width:100%;text-align:center;border:1px solid rgba(255,255,255,.08);padding:48px 32px}
.brand{font-size:22px;font-weight:900;letter-spacing:.6em;padding-left:.6em;margin-bottom:30px}
h1{font-size:18px;margin:0 0 14px;letter-spacing:.02em}
p{font-size:13px;line-height:1.8;color:rgba(255,255,255,.6);margin:0 0 26px}
a{display:inline-block;padding:14px 34px;font-size:11px;font-weight:700;letter-spacing:.2em;background:#fff;color:#000;text-decoration:none;text-transform:uppercase}
</style>
</head>
<body><div class="card"><div class="brand">PAP</div><h1>${esc(m.t)}</h1><p>${esc(m.b)}</p><a href="${esc(m.href)}">${esc(m.cta)}</a></div></body>
</html>`;
}
module.exports = { newsletterPage };
