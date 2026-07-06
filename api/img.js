/**
 * PAP Magazine — 원본 보존 이미지 프록시
 * Route: GET /api/img?u=<encoded URL>[&logo=1]
 *
 * 용도: TikTok PULL_FROM_URL 등 "소유권 인증된 도메인 + 원본 포맷(JPEG)"이
 * 동시에 필요한 소비자. Vercel 이미지 최적화(_vercel/image)는 Accept 협상으로
 * AVIF/WebP 를 반환해 TikTok 의 picture_size_check 에서 거부된다 — 이 프록시는
 * 허용 호스트의 원본 바이트를 정규화(1080px JPEG)해 중계한다.
 *
 * ?logo=1 — PAP 워드마크(pap-logo-white.png)를 하단 중앙에 합성.
 * 규격은 어드민 인스타 이미지 생성기(QA #261)와 동일: 로고 너비 15%,
 * 하단 여백 1%, 투명도 85%. 틱톡 슬라이드의 갤러리 컷 브랜딩용.
 */

const ALLOWED_HOSTS = new Set([
  'pap-korea-bucket.s3.ap-northeast-2.amazonaws.com',
  'igcazquhkwxtqsaqpznx.supabase.co',
  'www.pap-magazine.com',
]);

// 로고 PNG 는 모듈 스코프에 캐시 — 웜 인스턴스에서 요청당 재다운로드 방지.
let _logoBufPromise = null;
function loadLogo() {
  if (!_logoBufPromise) {
    _logoBufPromise = fetch('https://www.pap-magazine.com/pap-logo-white.png', {
      signal: AbortSignal.timeout(10000),
    }).then(async (r) => {
      if (!r.ok) throw new Error('logo fetch ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    }).catch((e) => { _logoBufPromise = null; throw e; });
  }
  return _logoBufPromise;
}

// buf(JPEG) 하단 중앙에 로고 합성. 실패 시 호출부에서 원본 유지.
async function stampLogo(sharp, buf) {
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H) return buf;
  const logoW = Math.max(1, Math.round(W * 0.15)); // 로고 너비 15%
  const pad = Math.round(H * 0.01);                // 하단 여백 1%
  const logoRaw = await loadLogo();
  let logo = await sharp(logoRaw).resize({ width: logoW }).ensureAlpha().png().toBuffer();
  // 투명도 85% — 1×1 픽셀(alpha 217/255)을 dest-in 블렌드로 타일링해
  // 알파 채널에 0.85 를 곱한다 (sharp 표준 기법).
  logo = await sharp(logo).composite([{
    input: Buffer.from([255, 255, 255, 217]),
    raw: { width: 1, height: 1, channels: 4 },
    tile: true,
    blend: 'dest-in',
  }]).png().toBuffer();
  const lMeta = await sharp(logo).metadata();
  return sharp(buf).composite([{
    input: logo,
    left: Math.round((W - logoW) / 2),
    top: Math.max(0, H - (lMeta.height || 0) - pad),
  }]).jpeg({ quality: 85 }).toBuffer();
}

module.exports = async function handler(req, res) {
  try {
    const u = req.query && req.query.u;
    if (!u) return res.status(400).json({ error: 'u 파라미터 필요' });
    let url;
    try { url = new URL(String(u)); } catch (_) { return res.status(400).json({ error: '잘못된 URL' }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      return res.status(403).json({ error: '허용되지 않은 호스트' });
    }
    // 자기 자신(/api/img) 재귀 래핑 방지
    if (url.hostname === 'www.pap-magazine.com' && url.pathname.startsWith('/api/')) {
      return res.status(400).json({ error: 'API 경로는 프록시 불가' });
    }
    const wantLogo = String((req.query && req.query.logo) || '') === '1';

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).json({ error: 'origin ' + r.status });
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(ct)) return res.status(415).json({ error: '이미지 아님: ' + ct });

    let buf = Buffer.from(await r.arrayBuffer());
    // TikTok picture_size_check: 원본 화보(2000px+)가 해상도 한도를 초과해
    // 거부된다 — 긴 변 1080px 이내 JPEG 로 정규화 (sharp).
    try {
      const sharp = require('sharp');
      buf = await sharp(buf)
        .resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      if (wantLogo) {
        try {
          buf = await stampLogo(sharp, buf);
        } catch (e) {
          // 로고 합성 실패는 치명적이지 않음 — 로고 없는 정규화본으로 진행.
          console.error('[img-proxy] 로고 합성 실패, 무로고 중계:', e.message);
        }
      }
      res.setHeader('Content-Type', 'image/jpeg');
    } catch (e) {
      console.error('[img-proxy] sharp 실패, 원본 중계:', e.message);
      res.setHeader('Content-Type', ct);
    }
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('[img-proxy] error:', err);
    return res.status(500).json({ error: 'proxy failed' });
  }
};
