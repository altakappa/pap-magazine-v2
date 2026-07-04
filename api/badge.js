/**
 * PAP Magazine — 임베드 배지 SVG ("AS FEATURED IN PAP MAGAZINE")
 * Route: /badge.svg  (rewritten in vercel.json → /api/badge)
 *
 * 목적(외부 인식 확산): PAP에 소개·게재된 브랜드가 자기 웹사이트/보도자료에
 * 붙이는 신뢰 배지. 브랜드가 배지를 달면 →
 *   (1) PAP 로 향하는 백링크(SEO 권위↑)
 *   (2) 그 브랜드의 방문자에게 "PAP = 인정받는 매거진" 인식 확산
 *   (3) 다른 브랜드가 보고 → "우리도 PAP에 실려 배지를 달고 싶다" FOMO
 * 브랜드는 명예롭게 홍보하고, PAP는 공짜로 노출·권위를 얻는 선순환.
 *
 * 사용법(임베드 코드는 /partners 하단 참조):
 *   <a href="https://www.pap-magazine.com/?ref=badge">
 *     <img src="https://www.pap-magazine.com/badge.svg" alt="Featured in PAP Magazine" width="240" height="64">
 *   </a>
 *
 * 쿼리:
 *   ?theme=dark (기본) | light
 *   ?label=... (상단 문구 커스터마이즈, 기본 "AS FEATURED IN")
 *
 * SVG 라 무한 확대에도 선명. 캐시: 1일 edge + 7일 SWR.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  const theme = (req.query.theme === 'light') ? 'light' : 'dark';
  let label = (req.query.label || 'AS FEATURED IN').toString().slice(0, 24).toUpperCase();
  label = esc(label);

  const dark = theme === 'dark';
  const bg = dark ? '#000000' : '#ffffff';
  const fg = dark ? '#ffffff' : '#000000';
  const sub = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
  const border = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.18)';

  const W = 240, H = 64;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} PAP MAGAZINE">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4" fill="${bg}" stroke="${border}"/>
  <text x="${W / 2}" y="25" text-anchor="middle" font-family="Montserrat,Helvetica,Arial,sans-serif" font-size="9" letter-spacing="2.6" fill="${sub}">${label}</text>
  <text x="${W / 2}" y="47" text-anchor="middle" font-family="Montserrat,Helvetica,Arial,sans-serif" font-weight="800" font-size="20" letter-spacing="1.5" fill="${fg}">PAP MAGAZINE</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).send(svg);
};
