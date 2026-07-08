/**
 * PAP Magazine — 이미지 브랜딩(로고 합성) 라이브러리
 *
 * 에디토리얼 원본(로고 없는 깨끗한 이미지)에 흰색 "PAP" 워드마크를
 * 하단 중앙에 얹어, 인스타그램에 올라가는 버전과 동일한 룩으로 만든다.
 * (레퍼런스: 세로형 이미지 하단 중앙 흰 워드마크)
 *
 * 로고 원본: https://www.pap-magazine.com/pap-logo-white.png (827x827, 흰 워드마크/투명)
 * 처리: 로고의 투명 여백을 trim → 이미지 폭의 LOGO_W_RATIO 로 리사이즈 →
 *       하단에서 BOTTOM_MARGIN_RATIO 만큼 띄워 가운데 정렬로 합성.
 *
 * sharp 는 Vercel 런타임에 설치돼 있음(package.json). 값은 상단 상수로 빼서
 * 실제 결과를 보고 쉽게 미세조정할 수 있게 했다.
 */

const sharp = require('sharp');

const LOGO_URL_DEFAULT = 'https://www.pap-magazine.com/pap-logo-white.png';
const LOGO_W_RATIO = 0.14;         // 로고 폭 = 이미지 폭의 14%
const BOTTOM_MARGIN_RATIO = 0.045; // 로고 아래 여백 = 이미지 높이의 4.5%
const JPEG_QUALITY = 90;

// trim 된 로고를 프로세스 수명 동안 1회만 받아 캐시한다.
let _logoPromise = null;
function getTrimmedLogo(logoUrl) {
  if (!_logoPromise) {
    _logoPromise = (async () => {
      const url = logoUrl || process.env.TELEGRAM_LOGO_URL || LOGO_URL_DEFAULT;
      const r = await fetch(url);
      if (!r.ok) throw new Error('logo fetch failed: HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      // 주변 투명 여백 제거 → 워드마크의 타이트한 bounds 확보.
      // trim 실패(로고가 이미 꽉 찬 경우 등) 시 원본 그대로 사용.
      try {
        return await sharp(buf).trim().png().toBuffer();
      } catch (_) {
        return await sharp(buf).png().toBuffer();
      }
    })().catch((e) => { _logoPromise = null; throw e; });
  }
  return _logoPromise;
}

/**
 * 이미지 버퍼에 로고를 합성해 JPEG 버퍼로 반환.
 * @param {Buffer} inputBuffer 원본 이미지 바이트
 * @param {Buffer} logoBuffer  trim 된 로고 PNG 버퍼(getTrimmedLogo 결과)
 * @returns {Promise<Buffer>} 브랜딩된 JPEG 버퍼
 */
async function brandImageBuffer(inputBuffer, logoBuffer) {
  // EXIF 회전을 먼저 픽셀에 반영해 두어 좌표 계산이 어긋나지 않게 한다.
  const oriented = await sharp(inputBuffer, { failOn: 'none' }).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H) throw new Error('bad image dimensions');

  const logoMeta = await sharp(logoBuffer).metadata();
  const targetW = Math.max(40, Math.round(W * LOGO_W_RATIO));
  const scale = targetW / logoMeta.width;
  const targetH = Math.max(1, Math.round(logoMeta.height * scale));
  const logoResized = await sharp(logoBuffer).resize(targetW, targetH).png().toBuffer();

  let left = Math.round((W - targetW) / 2);
  let top = Math.round(H - targetH - H * BOTTOM_MARGIN_RATIO);
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (top + targetH > H) top = Math.max(0, H - targetH);

  return sharp(oriented)
    .composite([{ input: logoResized, left, top }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

module.exports = { brandImageBuffer, getTrimmedLogo, LOGO_URL_DEFAULT };
