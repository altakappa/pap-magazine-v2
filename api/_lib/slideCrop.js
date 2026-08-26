/**
 * PAP Magazine — 브리프 슬라이드 비율 통일 (2026-08-26 신설)
 *
 * 도메니코 지시(2026-08-26):
 *   "가로형 이미지는 확대를해서 다른 세로형 이미지들과 같게 잘라줘.
 *    다만 인물(셀럽)은 절대 잘리면안돼"
 *
 * 왜 필요한가 ────────────────────────────────────────────────────────
 * 브리프의 커버(0번)만 celebThumb 이 판형에 맞춰 그리고, 나머지 슬라이드는
 * **원본 그대로** 실어 보냈다. 그래서 한 캐러셀 안에 4:5 와 16:9 가 섞인다.
 * 인스타그램 캐러셀은 첫 장의 비율로 전체를 맞추므로, 가로 사진은 위아래가
 * 잘리거나(크롭) 검은 띠가 생긴다. 어느 쪽이든 도메니코가 손으로 고쳐야 했다.
 *
 * 여기서 하는 일: 모든 사진을 **선택된 판형과 같은 비율로** 채워 자른다
 * (fit:'cover' — 여백을 두지 않고 확대해서 채운다).
 *
 * 인물 보호 — 할 수 있는 것과 못 하는 것을 구분해 적는다 ──────────────
 * sharp 의 `strategy.attention` 은 휘도 변화·채도·**피부톤**이 몰린 영역으로
 * 크롭 창을 옮긴다. 얼굴 인식이 아니라 휴리스틱이다. 대부분의 인물 사진에서
 * 가운데 크롭보다 낫지만 **보장은 아니다.**
 *
 * 그래서 두 가지를 함께 한다.
 *   ① attention 으로 자른다 (가운데 고정보다 인물을 훨씬 잘 남긴다)
 *   ② 버려지는 면적이 큰 컷은 **몇 번 슬라이드인지 이름을 대서 알린다.**
 *      16:9 를 9:16 으로 자르면 가로의 68% 가 사라진다. 단체 사진이면
 *      누군가는 반드시 잘린다. 그건 알고리즘으로 못 막는다 — 사람이 봐야 한다.
 * "인물이 안 잘린다"고 조용히 장담하지 않는다. 위험한 컷을 지목한다.
 *
 * 이미 목표 비율인 사진은 **건드리지 않는다** — 다시 인코딩하면 화질만 깎인다.
 */

'use strict';

/* celebThumb.VARIANTS 와 같은 값이다. 여기서 다시 정의하는 이유: celebThumb 은
   sharp·폰트·SVG 를 끌고 오는 무거운 모듈이라 이 순수 계산에 물리지 않는다.
   두 곳이 갈리지 않게 tests 가 대조한다. */
const TARGETS = {
  feed: { W: 1080, H: 1350 },     // 4:5   = 0.8
  reels: { W: 1080, H: 1920 },    // 9:16  = 0.5625
};

/* 목표 비율과 이만큼 안쪽이면 "이미 같다"고 본다. 720x900(0.8) 같은 값이
   부동소수점으로 정확히 안 떨어지는 경우를 흡수한다. */
const RATIO_TOLERANCE = 0.02;

/* 남는 면적이 이 밑이면 "많이 잘렸다"고 알린다.
   16:9(1.778) → 9:16(0.5625) 은 0.316 만 남는다. 4:5(0.8) → 9:16 은 0.703. */
const SEVERE_KEEP = 0.6;

/**
 * 목표 비율로 채워 자를 때 원본의 몇 할이 남는가 (0~1).
 * @param {number} srcRatio 원본 가로/세로
 * @param {number} dstRatio 목표 가로/세로
 */
function keptFraction(srcRatio, dstRatio) {
  const a = Number(srcRatio), b = Number(dstRatio);
  if (!(a > 0) || !(b > 0)) return 1;
  return Math.min(a, b) / Math.max(a, b);
}

/** 판형 이름 → 목표 가로/세로 비율. 모르는 이름은 feed. */
function targetRatio(variant) {
  const T = TARGETS[variant] || TARGETS.feed;
  return T.W / T.H;
}

/**
 * 사진 한 장을 판형 비율로 채워 자른다.
 *
 * 실패는 삼킨다 — 자르기가 안 된다고 브리프에서 사진이 사라지면 안 된다.
 * 그럴 때는 원본을 그대로 돌려주고 이유를 남긴다.
 *
 * @param {Buffer} buffer 원본 사진
 * @param {'feed'|'reels'} variant 커버가 정한 판형
 * @returns {Promise<{buffer:Buffer, changed:boolean, severe:boolean,
 *                    kept:number|null, from:string|null, reason:string|null}>}
 */
async function cropSlideToVariant(buffer, variant) {
  const out = { buffer, changed: false, severe: false, kept: null, from: null, reason: null };
  if (!buffer || !buffer.length) { out.reason = '빈 버퍼'; return out; }
  let sharp;
  try { sharp = require('sharp'); } catch (e) { out.reason = 'sharp 없음'; return out; }

  const T = TARGETS[variant] || TARGETS.feed;
  const dst = T.W / T.H;
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    /* EXIF 회전이 5~8 이면 화면에 보이는 가로세로가 뒤바뀐다. 이걸 안 보면
       세로 사진을 가로로 오판해 엉뚱하게 자른다. */
    const swap = Number(meta.orientation) >= 5;
    const w = swap ? meta.height : meta.width;
    const h = swap ? meta.width : meta.height;
    if (!(w > 0) || !(h > 0)) { out.reason = '크기를 못 읽음'; return out; }

    const src = w / h;
    out.from = w + 'x' + h;
    if (Math.abs(src - dst) <= RATIO_TOLERANCE) { out.reason = '이미 같은 비율'; return out; }

    out.kept = keptFraction(src, dst);
    out.severe = out.kept < SEVERE_KEEP;

    /* position: attention — 피부톤·채도·휘도가 몰린 쪽으로 크롭 창을 옮긴다.
       가운데 고정(centre)이면 화면 가장자리에 선 인물이 그대로 날아간다.
       .rotate() 를 먼저 걸어 EXIF 방향을 실제 픽셀에 반영한다. */
    out.buffer = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(T.W, T.H, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 92 })
      .toBuffer();
    out.changed = true;
    return out;
  } catch (e) {
    out.reason = '자르기 실패: ' + String((e && e.message) || e).slice(0, 120);
    return out;   // 원본 그대로 — 사진이 사라지는 것보다 낫다
  }
}

module.exports = {
  cropSlideToVariant, keptFraction, targetRatio,
  TARGETS, RATIO_TOLERANCE, SEVERE_KEEP,
};
