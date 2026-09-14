/**
 * 인스타 합성본 서버 렌더 — 관리자 "전체 ZIP 다운로드"(pap-admin.js _papInstaCompositeOne) 와 같은 그림을
 * sharp 로 만든다. (2026-09-14 도메니코: "전체 ZIP 다운로드 누르면 받아지는 이미지가 그대로, 커버 포함해서
 * 로고 이미지까지 전체 다 텔레그램으로 전송되면 좋겠어.")
 *
 * ZIP 의 규칙(클라이언트 캔버스)을 글자 그대로 옮겼다:
 *   · 캔버스 1080 × (4:5 → 1350 | 1:1 → 1080), 바탕은 투명.
 *   · 이미지는 cover-fit(가로·세로 중 큰 배율) × imgScale/100, 가운데 정렬 후 offsetX/Y(캔버스 % ) 만큼 이동.
 *   · 로고는 **trim 하지 않은** /pap-logo-white.png 원본 비율 그대로, 폭 = 캔버스 폭 × logoPct/100,
 *     가로 중앙, 아래 여백 = 캔버스 높이 × padPct/100, 투명도 logoAlpha/100. logoEnabled=false 면 안 얹는다.
 *   · 출력 PNG (ZIP 도 PNG).
 * 설정 출처: editorials.insta_logo_settings { global:{aspect,logoPct,padPct}, perImage:{url:{…}} }.
 * 값이 없으면 관리자 기본값(4:5 · 15% · 1% · 85% · 켜짐)과 같다.
 *
 * telegram.js 의 종전 brandImage.js(원본 크기 그대로 + trim 로고 14%) 는 ZIP 과 달랐다 — 그래서 텔레그램에 온
 * 이미지와 ZIP 이미지가 서로 달랐던 것.
 */
'use strict';

let _sharpMod = null;
function sharp(...args) {
  if (!_sharpMod) _sharpMod = require('sharp');
  return _sharpMod(...args);
}

const LOGO_URL_DEFAULT = 'https://www.pap-magazine.com/pap-logo-white.png';
const DEFAULTS = { aspect: '4:5', logoPct: 15, padPct: 1, imgScale: 100, offsetX: 0, offsetY: 0, logoAlpha: 85, logoEnabled: true };
const CANVAS_W = 1080;

function num(v, fallback) { return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback; }

/** insta_logo_settings + 이미지 URL → 그 이미지의 합성 옵션 (pap-admin.js _papInstaOptsForImage 와 동일 규칙). */
function resolveInstaOpts(settings, url) {
  const g = (settings && typeof settings === 'object' && settings.global && typeof settings.global === 'object') ? settings.global : {};
  const per = (settings && typeof settings === 'object' && settings.perImage && typeof settings.perImage === 'object') ? settings.perImage : {};
  const ov = (url && per[url] && typeof per[url] === 'object') ? per[url] : {};
  const aspect = (g.aspect === '1:1') ? '1:1' : '4:5';
  return {
    W: CANVAS_W,
    H: aspect === '1:1' ? CANVAS_W : 1350,
    logoPct:   num(ov.logoPct,   num(g.logoPct, DEFAULTS.logoPct)),
    padPct:    num(ov.padPct,    num(g.padPct,  DEFAULTS.padPct)),
    imgScale:  num(ov.imgScale,  DEFAULTS.imgScale),
    offsetX:   num(ov.offsetX,   DEFAULTS.offsetX),
    offsetY:   num(ov.offsetY,   DEFAULTS.offsetY),
    logoAlpha: num(ov.logoAlpha, DEFAULTS.logoAlpha),
    logoEnabled: ov.logoEnabled === false ? false : true,
  };
}

// trim 하지 않은 로고 원본 — 클라이언트 캔버스가 쓰는 것과 같은 비트맵. 프로세스 수명 동안 1회 캐시.
let _rawLogoPromise = null;
function getRawLogo(logoUrl) {
  if (!_rawLogoPromise) {
    _rawLogoPromise = (async () => {
      const url = logoUrl || process.env.TELEGRAM_LOGO_URL || LOGO_URL_DEFAULT;
      const r = await fetch(url);
      if (!r.ok) throw new Error('logo fetch failed: HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    })().catch((e) => { _rawLogoPromise = null; throw e; });
  }
  return _rawLogoPromise;
}

/** 클라이언트 캔버스와 같은 좌표 계산 — 순수 함수(테스트용). */
function layout(iw, ih, o) {
  const W = o.W, H = o.H;
  const imgScale = o.imgScale > 0 ? o.imgScale : 100;
  const scale = Math.max(W / iw, H / ih) * (imgScale / 100);
  const dw = Math.max(1, Math.round(iw * scale)), dh = Math.max(1, Math.round(ih * scale));
  const dx = Math.round((W - dw) / 2 + (o.offsetX / 100) * W);
  const dy = Math.round((H - dh) / 2 + (o.offsetY / 100) * H);
  // 캔버스 밖으로 나간 부분은 잘라낸다(sharp composite 는 캔버스보다 큰 레이어를 거부한다).
  const sx = Math.max(0, -dx), sy = Math.max(0, -dy);
  const left = Math.max(0, dx), top = Math.max(0, dy);
  const vw = Math.min(dw - sx, W - left), vh = Math.min(dh - sy, H - top);
  return { W, H, dw, dh, dx, dy, sx, sy, left, top, vw, vh };
}

/**
 * @param {Buffer} raw       원본 이미지 바이트
 * @param {Buffer} logoRaw   trim 안 한 로고 PNG (getRawLogo)
 * @param {object} o         resolveInstaOpts 결과
 * @returns {Promise<Buffer>} PNG
 */
async function instaCompositeBuffer(raw, logoRaw, o) {
  const oriented = await sharp(raw, { failOn: 'none' }).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  if (!meta.width || !meta.height) throw new Error('bad image dimensions');
  const L = layout(meta.width, meta.height, o);
  const layers = [];
  if (L.vw > 0 && L.vh > 0) {
    const resized = await sharp(oriented).resize(L.dw, L.dh, { fit: 'fill' }).png().toBuffer();
    const visible = await sharp(resized).extract({ left: L.sx, top: L.sy, width: L.vw, height: L.vh }).png().toBuffer();
    layers.push({ input: visible, left: L.left, top: L.top });
  }
  if (o.logoEnabled !== false && logoRaw && o.logoPct > 0) {
    const lm = await sharp(logoRaw).metadata();
    const logoW = Math.max(1, Math.round(L.W * (o.logoPct / 100)));
    const logoH = Math.max(1, Math.round(logoW * (lm.height / lm.width)));
    const alpha = Math.max(0, Math.min(100, num(o.logoAlpha, 100))) / 100;
    let logoPng;
    if (alpha < 1) {
      const rawLogo = await sharp(logoRaw).resize(logoW, logoH, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
      for (let i = 3; i < rawLogo.length; i += 4) rawLogo[i] = Math.round(rawLogo[i] * alpha);
      logoPng = await sharp(rawLogo, { raw: { width: logoW, height: logoH, channels: 4 } }).png().toBuffer();
    } else {
      logoPng = await sharp(logoRaw).resize(logoW, logoH, { fit: 'fill' }).png().toBuffer();
    }
    const left = Math.round((L.W - logoW) / 2);
    const top = Math.round(L.H - logoH - L.H * (o.padPct / 100));
    layers.push({
      input: logoPng,
      left: Math.max(0, Math.min(L.W - logoW, left)),
      top: Math.max(0, Math.min(L.H - logoH, top)),
    });
  }
  let base = sharp({ create: { width: L.W, height: L.H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (layers.length) base = base.composite(layers);
  return base.png().toBuffer();
}

module.exports = { resolveInstaOpts, instaCompositeBuffer, layout, getRawLogo, DEFAULTS, LOGO_URL_DEFAULT };
