/**
 * PAP Magazine — 셀럽 속보 썸네일 렌더러 (2026-08-23 신설)
 *
 * PSD 를 **픽셀 실측**해 재현한다. 판형 두 가지.
 * 도메니코 지시(2026-08-23): "이 양식으로 섬네일을 통일해주면 돼."
 *                            "이게 릴스용 섬네일이야"
 * 실측 원본: (일반1) 썸네일.psd · 스토리릴스 본문용.psd
 * 실측표 전문: 볼트 60_Agents/PAP-셀럽속보-톤앤디자인.md §4-7
 *
 *   글자 #FFFFFF · 좌측 x≈101 · 폰트/크기/행간/자간은 **두 판형이 동일하다**
 *   국문 Pretendard-SemiBold 64px / 행간 78 / 자간   0
 *   영문 Inter-LightItalic   42px / 행간 50 / 자간 −40
 *
 *              feed (사진 게시물)      reels (영상 게시물)
 *   캔버스     1080 × 1350 (4:5)      1080 × 1920 (9:16)
 *   국문 기준선 (99.7,  851.0)         (99.7, 1101.0)
 *   영문 기준선 (101.5, 988.6)         (101.5, 1238.6)
 *   그림자     op51 @ (0,485)          op51 @ (1,695)
 *   심볼       70×70 @ (505,1219)      70×70 @ (506,1469)
 *
 *   ※ 릴스 판형은 글자가 아래로 250px 내려간 것뿐이다. 규격이 갈린 게 아니라
 *     같은 규격을 세로 판형에 옮긴 것 — 그래서 상수만 다르고 로직은 하나다.
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

const W = 1080, H = 1350;                             // feed 기본값 (하위 호환 · 테스트가 읽는다)
const KO_PX = 64, KO_LEAD = 78, KO_TRACK = 0;
const EN_PX = 42, EN_LEAD = 50, EN_TRACK = -40;      // 자간 단위: PSD 1/1000 em
const KO_X = 99.7,  KO_BASE = 851.0;
const EN_X = 101.5, EN_BASE = 988.6;
const KO_MAX_W = 860;                                 // bbox (101,800)~(752,935) 기준 여유폭
const EN_MAX_W = 860;                                 // bbox (103,957)~(933,1048)
const SHADOW_XY = [0, 485];
const SYMBOL_XY = [505, 1219];
const MAX_LINES = 2;
const MIN_LINES = 2;

/* ── 인스타 피드 그리드 대응 (도메니코 2026-08-23) ────────────────────────
   프로필/릴스 그리드는 커버를 **4:5** 로 자른다. 우리 릴스 커버는 9:16 이라
   세로의 70% 만 남고 위아래가 날아간다. 실제로 지수 건에서 이마와 눈이 잘렸다.

   ① PHOTO — 사진에서 얼굴 위쪽이 잘리지 않게 사진만 아래로 민다.
      비운 윗부분은 사진 맨 윗줄을 늘려 메운다(배경이 대개 단색이라 티가 안 난다).
      확대(zoom)로 맞추려면 이 사진 기준 2배가 필요해 클로즈업이 돼버린다 — 그래서 이동.
   ② TEXT  — 카스쿨(몬스타엑스) 건과 나란히 놓고 보니 우리 글자가 위로 떠 보인다.
      도메니코가 같은 PSD 로 직접 만든 그 건이 기준이다. 차이 실측 ≈ 41px(글자)
      ~77px(심볼). 그 사이 값으로 잡는다.
      **상한이 있다**: 심볼 bbox 하단이 1539 이고 4:5 안전구간 끝이 1635 이라
      96px 을 넘겨 내리면 피드에서 심볼이 잘린다.                            */
const FEED_SAFE_RATIO = 0.8;              // 인스타 그리드 4:5
const TEXT_SHIFT = { feed: 0, reels: 60 };// feed(1080x1350)는 이미 4:5 라 안 잘린다
const TEXT_SHIFT_MAX = 96;                // 심볼이 안전구간에 남는 한계
const PHOTO_SHIFT_MAX = 420;              // 이보다 밀면 하단이 너무 잘린다
const PHOTO_FACE_MARGIN = 40;             // 안전구간 위 경계에서 얼굴까지 최소 여유

/* 피드에서 잘리지 않는 세로 구간 [top, bottom] */
function safeBand(W, H) {
  const h = Math.round(W / FEED_SAFE_RATIO);
  const top = Math.round((H - h) / 2);
  return [top, top + h];
}

/* focusTop(0~1, 얼굴 맨 위의 세로 위치)을 받아 사진을 몇 px 내릴지 계산한다.
   값이 없으면(구버전 브리프·모델 실패) 0 — 예전과 똑같이 동작한다. */
function photoShiftFor(W, H, focusTop) {
  // Number(null) 과 Number('') 은 0 이다 — 그대로 두면 "값 없음"이 "맨 위에 얼굴"로
  // 읽혀 사진이 상한까지 밀린다. 숫자만 받는다.
  if (typeof focusTop !== 'number') return 0;
  const f = focusTop;
  if (!isFinite(f) || f < 0 || f > 1) return 0;
  const [safeTop] = safeBand(W, H);
  const d = Math.round(safeTop + PHOTO_FACE_MARGIN - f * H);
  return Math.max(0, Math.min(PHOTO_SHIFT_MAX, d));
}

/* override 를 주면 그 값을 쓴다. PSD 대조 테스트는 0 을 넘겨
   "템플릿 재현 정확도"와 "인스타 그리드 대응 오프셋"을 분리해서 잰다. */
function textShiftFor(variant, override) {
  const v = typeof override === 'number' ? override
    : (TEXT_SHIFT[variant] != null ? TEXT_SHIFT[variant] : 0);
  return Math.max(0, Math.min(TEXT_SHIFT_MAX, v));
}

const VARIANTS = {
  feed: {
    W: 1080, H: 1350,
    koBase: 851.0, enBase: 988.6,
    shadow: 'shadow.png',       shadowXY: [0, 485],
    symbolXY: [505, 1219],
  },
  reels: {
    W: 1080, H: 1920,
    koBase: 1101.0, enBase: 1238.6,
    shadow: 'shadow_reels.png', shadowXY: [1, 695],
    symbolXY: [506, 1469],
  },
};

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
 * @param {{variant?: 'feed'|'reels'}} opts  판형. 기본 feed(4:5). 영상 게시물은 reels(9:16).
 * @returns {Promise<Buffer>} JPEG
 * @throws 제목이 2줄에 안 들어가면 던진다 — 폰트를 줄이지 않는다(§4-7).
 */
/* 글자·그림자·심볼만 담은 **투명 배경** 레이어 목록을 만든다.
   renderThumb(사진 위)과 renderOverlay(영상 위)가 같은 조판을 쓰게 하기 위한 것 —
   두 벌로 갈라지면 한쪽만 고쳐지는 날이 온다. */
function _layers(titleKo, titleEn, opts) {
  const V = VARIANTS[(opts && opts.variant) || 'feed'] || VARIANTS.feed;
  const { wrapHeadline } = require('./celebBrief');
  const F = fonts();

  const koTrackPx = KO_TRACK / 1000 * KO_PX;
  const enTrackPx = EN_TRACK / 1000 * EN_PX;
  /* MIN_LINES=2 — 국문·영문 모두 두 줄로 앉힌다(도메니코 2026-08-23).
     조판이 2줄 전제라 한 줄로 떨어지면 국문과 영문 사이가 한 줄 벌어진다. */
  const koLines = wrapHeadline(titleKo, KO_MAX_W, measureWith(F.ko, KO_PX, koTrackPx), MAX_LINES, MIN_LINES);
  const enLines = wrapHeadline(titleEn, EN_MAX_W, measureWith(F.en, EN_PX, enTrackPx), MAX_LINES, MIN_LINES);
  if (!koLines) throw new Error('국문 제목이 2줄을 넘습니다. 제목을 줄여주세요: ' + titleKo);
  if (!enLines) throw new Error('영문 제목이 2줄을 넘습니다. 제목을 줄여주세요: ' + titleEn);

  const dy = textShiftFor((opts && opts.variant) || 'feed', opts && opts.textShift);
  const paths = [];
  koLines.forEach((l, i) => paths.push(lineToPath(F.ko, l, KO_X, V.koBase + dy + i * KO_LEAD, KO_PX, koTrackPx)));
  enLines.forEach((l, i) => paths.push(lineToPath(F.en, l, EN_X, V.enBase + dy + i * EN_LEAD, EN_PX, enTrackPx)));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + V.W + '" height="' + V.H + '">'
    + '<path fill="#ffffff" d="' + paths.join(' ') + '"/></svg>';

  return {
    V,
    composite: [
      { input: path.join(ASSETS, V.shadow), left: V.shadowXY[0], top: V.shadowXY[1] + dy },
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: path.join(ASSETS, 'symbol70.png'), left: V.symbolXY[0], top: V.symbolXY[1] + dy },
    ],
  };
}

/**
 * 영상 위에 얹을 **투명 배경 오버레이 PNG**.
 * 도메니코 2026-08-23: "영상 자체에 디자인을 올려서 릴스로" · "앞 2-3초".
 * 사진이 없다는 것만 빼면 썸네일과 완전히 같은 조판이다(같은 _layers 를 쓴다).
 */
async function renderOverlay(titleKo, titleEn, opts) {
  const sharp = require('sharp');
  const { V, composite } = _layers(titleKo, titleEn, opts);
  return sharp({
    create: { width: V.W, height: V.H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composite).png().toBuffer();
}

/* 사진을 dy 만큼 아래로 민다. 비는 윗부분은 사진 맨 윗줄을 늘려 메운다.
   확대가 아니라 이동이라 화질과 구도가 그대로다. 배경이 단색인 화보에서
   이음매가 사실상 안 보인다(지수 건에서 확인). */
async function shiftPhotoDown(buf, W, H, dy) {
  const sharp = require('sharp');
  const strip = await sharp(buf).extract({ left: 0, top: 0, width: W, height: 2 })
    .resize(W, dy, { fit: 'fill' }).toBuffer();
  const moved = await sharp(buf).extract({ left: 0, top: 0, width: W, height: H - dy }).toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
    .composite([{ input: strip, left: 0, top: 0 }, { input: moved, left: 0, top: dy }])
    .jpeg({ quality: 95 }).toBuffer();
}

async function renderThumb(photoBuffer, titleKo, titleEn, opts) {
  const sharp = require('sharp');                                  // 지연 로드
  /* 조판은 _layers 한 곳에서만 만든다 — 여기서 다시 짜면 오버레이와 갈라진다.
     2026-08-23: 실제로 갈라져 있었고, MIN_LINES 를 두 곳에 넣어야 했다. 합쳤다. */
  const { V, composite } = _layers(titleKo, titleEn, opts);

  // 1) 사진 — 가운데 크롭 풀블리드
  let base = await sharp(photoBuffer, { failOn: 'none' })
    .rotate()
    .resize(V.W, V.H, { fit: 'cover', position: 'centre' })
    .toBuffer();

  /* 2) 피드 그리드(4:5)에서 얼굴이 잘리지 않게 사진만 아래로 민다.
        opts.focusTop 이 없으면 0 이라 예전과 동일하게 동작한다. */
  const shift = photoShiftFor(V.W, V.H, opts && opts.focusTop);
  if (shift > 0) base = await shiftPhotoDown(base, V.W, V.H, shift);

  // 3) 그림자 → 글자 → 심볼 (전부 _layers 가 준 것)
  return sharp(base).composite(composite).jpeg({ quality: 92 }).toBuffer();
}

module.exports = {
  renderThumb,
  renderOverlay,
  VARIANTS,
  measureWith,
  _fonts: fonts,
  W, H, KO_PX, KO_LEAD, KO_TRACK, EN_PX, EN_LEAD, EN_TRACK,
  KO_X, KO_BASE, EN_X, EN_BASE, SHADOW_XY, SYMBOL_XY, MAX_LINES, MIN_LINES,
  FEED_SAFE_RATIO, TEXT_SHIFT, TEXT_SHIFT_MAX, PHOTO_SHIFT_MAX,
  safeBand, photoShiftFor, textShiftFor, shiftPhotoDown,
};
