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
/* 2026-11-02 도메니코 "이미지 전부 2160x2700 으로" — 기준 캔버스를 2배로 올린다.
   종전 1080×1350 은 인스타 업로드 규격이었는데, 그 결과물이 텔레그램·ZIP 으로
   그대로 나가면서 원본(수천 px)보다 한참 작은 그림이 배포되고 있었다.
   인스타는 2160 을 올려도 자기가 알아서 줄인다 — 작게 주는 쪽이 손해다.
   구도 값(logoPct·padPct·offset)은 전부 W·H 비율이라 이 변경으로 그림이 달라지지 않는다. */
const CANVAS_W = 2160;
const CANVAS_H_45 = 2700;

function num(v, fallback) { return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback; }

/** insta_logo_settings + 이미지 URL → 그 이미지의 합성 옵션 (pap-admin.js _papInstaOptsForImage 와 동일 규칙). */
/* 2026-11-02 — 출력 배율. 1 이면 종전 그대로(1080×1350).
   왜 필요한가: 텔레그램으로 가는 갤러리 컷이 전부 1080px 로 줄어 있었다.
   원본은 서명 URL 로 바로 올라와 수천 px 인데, 인스타 규격(1080)으로 합성한
   결과물을 그대로 보내고 있었다 — 도메니코 "화질이 떨어진다".
   ZIP(인스타 업로드용)은 1080 이 맞으므로 기본값은 건드리지 않는다. */
const MAX_SCALE = 4;
function _scale(v) {
  const n = (typeof v === 'number' && Number.isFinite(v)) ? v : 1;
  return Math.max(1, Math.min(MAX_SCALE, n));
}

function resolveInstaOpts(settings, url, scale) {
  const g = (settings && typeof settings === 'object' && settings.global && typeof settings.global === 'object') ? settings.global : {};
  const per = (settings && typeof settings === 'object' && settings.perImage && typeof settings.perImage === 'object') ? settings.perImage : {};
  const ov = (url && per[url] && typeof per[url] === 'object') ? per[url] : {};
  const aspect = (g.aspect === '1:1') ? '1:1' : '4:5';
  /* 배율은 W·H 에만 곱한다. 로고 크기(logoPct)·여백(padPct)·사진 위치(offset)는
     전부 W·H 의 비율로 계산되므로, 구도는 배율과 무관하게 똑같이 나온다. */
  const k = _scale(scale);
  return {
    W: CANVAS_W * k,
    H: (aspect === '1:1' ? CANVAS_W : CANVAS_H_45) * k,
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
/* 합성 파이프라인을 한 번만 세운다 (2026-11-06).
   종전에는 사진 레이어를 PNG 로 인코딩했다가 다시 디코딩해 붙였다. 1080 때는
   견딜 만했지만 2160×2700 에서는 장당 10MB 짜리 PNG 를 만들고 푸는 일이 되어
   CPU·메모리가 네 배로 뛰었다 — 14장짜리 화보에서 워커가 상한을 넘겨 죽었고,
   캡션만 가고 이미지는 한 장도 못 갔다(도메니코 2026-11-06 제보).
   이제 resize→extract 를 한 파이프라인으로 묶고 **raw 픽셀**로 넘긴다.
   압축을 한 번도 하지 않으므로 중간 인코딩 비용이 통째로 사라진다. */
async function _composeBase(raw, logoRaw, o) {
  const oriented = await sharp(raw, { failOn: 'none' }).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  if (!meta.width || !meta.height) throw new Error('bad image dimensions');
  const L = layout(meta.width, meta.height, o);
  const layers = [];
  if (L.vw > 0 && L.vh > 0) {
    const { data, info } = await sharp(oriented)
      .resize(L.dw, L.dh, { fit: 'fill' })
      .extract({ left: L.sx, top: L.sy, width: L.vw, height: L.vh })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: data,
      raw: { width: info.width, height: info.height, channels: info.channels },
      left: L.left, top: L.top,
    });
  }
  if (o.logoEnabled !== false && logoRaw && o.logoPct > 0) {
    const lm = await sharp(logoRaw).metadata();
    const logoW = Math.max(1, Math.round(L.W * (o.logoPct / 100)));
    const logoH = Math.max(1, Math.round(logoW * (lm.height / lm.width)));
    const alpha = Math.max(0, Math.min(100, num(o.logoAlpha, 100))) / 100;
    /* 로고는 작아서 raw 로 다뤄도 부담이 없고, 알파를 직접 건드려야 한다. */
    const { data: lraw, info: linfo } = await sharp(logoRaw)
      .resize(logoW, logoH, { fit: 'fill' }).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    if (alpha < 1) for (let i = 3; i < lraw.length; i += 4) lraw[i] = Math.round(lraw[i] * alpha);
    const left = Math.round((L.W - logoW) / 2);
    const top = Math.round(L.H - logoH - L.H * (o.padPct / 100));
    layers.push({
      input: lraw,
      raw: { width: linfo.width, height: linfo.height, channels: linfo.channels },
      left: Math.max(0, Math.min(L.W - logoW, left)),
      top: Math.max(0, Math.min(L.H - logoH, top)),
    });
  }
  let base = sharp({ create: { width: L.W, height: L.H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (layers.length) base = base.composite(layers);
  return { base, L };
}

/**
 * @param {Buffer} raw       원본 이미지 바이트
 * @param {Buffer} logoRaw   trim 안 한 로고 PNG (getRawLogo)
 * @param {object} o         resolveInstaOpts 결과
 * @returns {Promise<Buffer>} PNG
 */
async function instaCompositeBuffer(raw, logoRaw, o) {
  const { base } = await _composeBase(raw, logoRaw, o);
  return base.png().toBuffer();
}

/* 사진이 캔버스를 빈틈없이 덮는가. 덮으면 알파가 쓸모없으므로 JPEG 로 내보내도
   그림이 달라지지 않는다. 덮지 않으면(편집자가 일부러 축소한 경우) 투명 가장자리가
   있으므로 PNG 를 유지한다 — JPEG 로 바꾸면 그 자리가 검게 칠해진다. */
function coversCanvas(L) {
  return L.left === 0 && L.top === 0 && L.vw >= L.W && L.vh >= L.H;
}

const JPEG_Q = (() => {
  const n = parseInt(process.env.INSTA_JPEG_QUALITY || '95', 10);
  return (Number.isFinite(n) && n >= 70 && n <= 100) ? n : 95;
})();

/**
 * 합성 결과를 '파일'로 — 확장자·MIME 까지 정해서 돌려준다.
 *
 * PNG 고정이던 것을 바꾼 이유(2026-11-02):
 *   1080×1350 PNG 는 장당 2~4MB 다. 해상도를 2배(2160×2700)로 올리면 PNG 는 10MB 를
 *   넘겨 16장이면 업로드가 함수 상한을 그대로 넘긴다(실제로 300초 타임아웃이 찍혀 있다).
 *   같은 2160×2700 을 JPEG q95 4:4:4 로 내보내면 2~3MB — 픽셀은 4배인데 용량은 오히려
 *   지금보다 작다. 텔레그램에는 document 로 보내므로 재압축도 없다.
 *   4:4:4 를 쓰는 이유: 기본값 4:2:0 은 색 경계를 뭉갠다. 패션 사진에서 가장 먼저 보인다.
 *
 * @returns {Promise<{buffer:Buffer, ext:string, mime:string}>}
 */
async function instaCompositeFile(raw, logoRaw, o) {
  const { base, L } = await _composeBase(raw, logoRaw, o);
  if (!coversCanvas(L)) return { buffer: await base.png().toBuffer(), ext: 'png', mime: 'image/png' };
  /* 덮는 경우엔 알파가 쓸모없다 → JPEG 로 바로 뽑는다. PNG 를 거쳐 가지 않는다. */
  const buffer = await base
    .flatten({ background: '#000000' })
    .jpeg({ quality: JPEG_Q, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
  return { buffer, ext: 'jpg', mime: 'image/jpeg' };
}

module.exports = { resolveInstaOpts, instaCompositeBuffer, instaCompositeFile, coversCanvas, layout, getRawLogo, DEFAULTS, LOGO_URL_DEFAULT, JPEG_Q, MAX_SCALE, CANVAS_W, CANVAS_H_45 };
