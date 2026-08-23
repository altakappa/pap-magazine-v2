/**
 * PAP Magazine — 셀럽 속보 썸네일 렌더러 (2026-08-23 신설)
 *
 * (일반1) 썸네일 PSD 를 **픽셀 실측**해 재현한다.
 * 도메니코 지시(2026-08-23): "이 양식으로 섬네일을 통일해주면 돼."
 * 실측 원본: 📌 PAP/📓 레이아웃/(일반1) 썸네일.psd  (헤더 version=2 = PSB)
 * 실측표 전문: 볼트 60_Agents/PAP-셀럽속보-톤앤디자인.md §4-7
 *
 *   캔버스 1080×1350 · 글자 #FFFFFF · 좌측 x≈101
 *   그림자 레이어 op 51 + 그라디언트 마스크, y 485~1350
 *   국문  Pretendard-SemiBold 64px / 행간 78 / 자간   0  · 첫 베이스라인 (99.7, 851.0)
 *   영문  Inter-LightItalic   42px / 행간 50 / 자간 −40  · 첫 베이스라인 (101.5, 988.6)
 *   심볼  70×70 @ (505,1219) — PSD 레이어 이름이 "심볼 (만지지 X)". 위치 고정.
 *
 * ── 왜 opentype.js 로 글자를 path 로 바꾸나 ────────────────────
 * sharp 프리빌트 바이너리에 글자 그리기가 없다. 2026-08-23 실측:
 *   · sharp({text:{...}})      → VipsOperation: class "text" not found
 *   · SVG <text>               → 렌더는 되는데 글자 픽셀 0개 (폰트 없음)
 * 서버리스에 fontconfig 를 심는 대신, 글자를 **벡터 path** 로 바꿔 SVG 에 넣는다.
 * 런타임 폰트 탐색이 아예 없어지므로 로컬과 Vercel 결과가 같다.
 *
 * ── 검증 ──────────────────────────────────────────────────────
 * tests/celeb-thumb.test.js 가 PSD 합성본(tests/fixtures/celeb/ilban1_reference.png)과
 * 렌더 결과의 평균절대오차를 잰다. 파이썬 시제품 기준 1.05/255.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', '_assets', 'celeb');

const W = 1080, H = 1350;
const KO_PX = 64, KO_LEAD = 78, KO_TRACK = 0;
const EN_PX = 42, EN_LEAD = 50, EN_TRACK = -40;      // 자간 단위: PSD 1/1000 em
const KO_X = 99.7,  KO_BASE = 851.0;
const EN_X = 101.5, EN_BASE = 988.6;
const KO_MAX_W = 860;                                 // bbox (101,800)~(752,935) 기준 여유폭
const EN_MAX_W = 860;                                 // bbox (103,957)~(933,1048)
const SHADOW_XY = [0, 485];
const SYMBOL_XY = [505, 1219];
const MAX_LINES = 2;

// 폰트는 모듈 스코프에 한 번만 파싱한다 (콜드스타트 1회).
let _fonts = null;
function fonts() {
  if (!_fonts) {
    const opentype = require('opentype.js');                       // 지연 로드
    const load = (f) => {
      const buf = fs.readFileSync(path.join(ASSETS, f));
      return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    };
    _fonts = { ko: load('Pretendard-SemiBold.otf'), en: load('Inter-LightItalic.otf') };
  }
  return _fonts;
}

/* 자간을 포함한 실제 폭.
   ⚠️ 반드시 **글자 단위**로 잰다. Inter(OTF·TTF 둘 다)는 여러 글자를 한 번에
   넘기면 opentype.js 2.0 이 GSUB lookupType 6 / substFormat 2 에서 던진다
   (2026-08-23 실측: 'substitutionType : 62 ... is not yet supported').
   글자 단위로는 그 경로를 타지 않는다. 그리기도 같은 이유로 글자 단위다 —
   재는 방식과 그리는 방식이 같아야 줄바꿈 계산이 실제 결과와 어긋나지 않는다.
   커닝은 포기한다: getKerningValue 가 0 을 돌려준다(GPOS 미노출). */
function measureWith(font, size, trackPx) {
  return (text) => {
    const s = String(text || '');
    if (!s) return 0;
    let w = 0;
    for (const ch of s) w += font.getAdvanceWidth(ch, size);
    return w + trackPx * Math.max(0, Array.from(s).length - 1);
  };
}

/* 한 줄을 SVG path d 문자열로. measureWith 와 같은 방식(글자 단위)이어야 한다. */
function lineToPath(font, text, x, baseline, size, trackPx) {
  let cx = x;
  const out = [];
  for (const ch of String(text)) {
    out.push(font.getPath(ch, cx, baseline, size).toPathData(2));
    cx += font.getAdvanceWidth(ch, size) + trackPx;
  }
  return out.join(' ');
}

/**
 * 썸네일 렌더.
 * @param {Buffer} photoBuffer  배경 사진(원본). 가운데 크롭해 풀블리드로 채운다.
 * @param {string} titleKo      국문 제목 (자동 2줄 줄바꿈)
 * @param {string} titleEn      영문 제목 (자동 2줄 줄바꿈)
 * @returns {Promise<Buffer>} JPEG
 * @throws 제목이 2줄에 안 들어가면 던진다 — 폰트를 줄이지 않는다(§4-7).
 */
async function renderThumb(photoBuffer, titleKo, titleEn) {
  const sharp = require('sharp');                                  // 지연 로드
  const { wrapHeadline } = require('./celebBrief');
  const F = fonts();

  const koTrackPx = KO_TRACK / 1000 * KO_PX;
  const enTrackPx = EN_TRACK / 1000 * EN_PX;
  const koLines = wrapHeadline(titleKo, KO_MAX_W, measureWith(F.ko, KO_PX, koTrackPx), MAX_LINES);
  const enLines = wrapHeadline(titleEn, EN_MAX_W, measureWith(F.en, EN_PX, enTrackPx), MAX_LINES);
  if (!koLines) throw new Error('국문 제목이 2줄을 넘습니다. 제목을 줄여주세요: ' + titleKo);
  if (!enLines) throw new Error('영문 제목이 2줄을 넘습니다. 제목을 줄여주세요: ' + titleEn);

  const paths = [];
  koLines.forEach((l, i) => paths.push(lineToPath(F.ko, l, KO_X, KO_BASE + i * KO_LEAD, KO_PX, koTrackPx)));
  enLines.forEach((l, i) => paths.push(lineToPath(F.en, l, EN_X, EN_BASE + i * EN_LEAD, EN_PX, enTrackPx)));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
    + '<path fill="#ffffff" d="' + paths.join(' ') + '"/></svg>';

  // 1) 사진 — 가운데 크롭 풀블리드
  const base = await sharp(photoBuffer, { failOn: 'none' })
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .toBuffer();

  // 2) 그림자 → 3) 글자 → 4) 심볼
  return sharp(base)
    .composite([
      { input: path.join(ASSETS, 'shadow.png'), left: SHADOW_XY[0], top: SHADOW_XY[1] },
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: path.join(ASSETS, 'symbol70.png'), left: SYMBOL_XY[0], top: SYMBOL_XY[1] },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = {
  renderThumb,
  measureWith,
  _fonts: fonts,
  W, H, KO_PX, KO_LEAD, KO_TRACK, EN_PX, EN_LEAD, EN_TRACK,
  KO_X, KO_BASE, EN_X, EN_BASE, SHADOW_XY, SYMBOL_XY, MAX_LINES,
};
