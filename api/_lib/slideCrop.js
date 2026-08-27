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
 * 2026-08-26 (2차) — 도메니코: "가로 이미지는 좌우가 잘리더라도 캐러셀에 맞는
 * 비율로 만들어줘야해. 다만 인물이 잘릴경우에는 그냥 안쓸게."
 *   → 경고만 하고 싣던 것을 **버리는** 것으로 바꾼다. 잘려나간 자리에 사람이
 *     있으면 그 슬라이드는 캐러셀에서 뺀다. 판정 방법은 findCutSubject 참고.
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

/* 잘려나간 자리에 사람이 있었나 (2026-08-26) ──────────────────────────
   도메니코: "인물이 잘릴경우에는 그냥 안쓸게."

   얼굴 인식은 못 한다(Vercel 에 모델이 없다). 대신 **버려진 픽셀을 직접 본다.**
   sharp 가 크롭 후 info.cropOffsetLeft/Top 을 준다 — 어디를 잘랐는지 알 수 있다.
   그 바깥 띠에서 살색 픽셀 비율을 재고, 일정 이상이면 "사람이 잘렸다"고 본다.

   왜 이 방식인가: attention 은 **한 덩어리**로만 창을 옮긴다. 좌우 양끝에 두
   사람이 서 있으면 한쪽은 반드시 버려지는데, 창 안쪽만 봐서는 그걸 절대 모른다.
   버린 쪽을 봐야 안다.

   한계는 명확히 적는다 — 살색 판정은 색 규칙이라 나무·모래·베이지 옷·조명에도
   걸린다. 즉 **멀쩡한 사진을 빼는 쪽으로 틀린다.** 반대(사람이 잘렸는데 통과)
   보다 이쪽이 낫다는 게 도메니코의 결정이다("그냥 안쓸게").
   빼는 이유는 항상 이름을 대서 알린다 — 조용히 사라지면 왜 3장뿐인지 모른다. */

/** 흔한 RGB 살색 규칙. 얼굴 인식이 아니라 색 필터다. */
function isSkinPixel(rr, gg, bb) {
  const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
  return rr > 95 && gg > 40 && bb > 20 && (mx - mn) > 15
    && Math.abs(rr - gg) > 15 && rr > gg && rr > bb;
}

/* 버려진 띠에서 살색이 이 비율을 넘으면 사람이 잘렸다고 본다.
   1% 는 1080x1350 기준 약 14,600 픽셀 — 얼굴 하나가 충분히 들어간다. */
const CUT_SUBJECT_SKIN = 0.01;
/* 띠가 이보다 얇으면 보지 않는다 (반올림 오차로 1~2px 이 남는 경우). */
const MIN_STRIP_PX = 8;

async function _skinShare(sharp, buf, left, top, width, height) {
  if (width < MIN_STRIP_PX || height < MIN_STRIP_PX) return 0;
  const { data, info } = await sharp(buf, { failOn: 'none' })
    .rotate()
    .extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) })
    .resize(48, 48, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let hit = 0, n = 0;
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    n++;
    if (isSkinPixel(data[i], data[i + 1], data[i + 2])) hit++;
  }
  return n ? hit / n : 0;
}

/**
 * 크롭에서 **버려진 자리**에 사람이 있었는지 본다.
 * @returns {Promise<{cut:boolean, skin:number}>} skin 은 버려진 띠의 최대 살색 비율
 */
async function findCutSubject(sharp, buffer, srcW, srcH, T, cropOffsetLeft, cropOffsetTop) {
  const scale = Math.max(T.W / srcW, T.H / srcH);
  /* sharp 의 cropOffsetLeft/Top 은 **음수**다 (2026-08-26 실측: 1920x1080 을
     4:5 로 자를 때 -660). 이미지에 적용한 이동량이라 잘라낸 시작점은 그 부호를
     뒤집은 값이다. 그대로 쓰면 유지 구간이 음수로 나오고, 실제로 남은 사람을
     "잘렸다"고 오판한다 — 처음 짤 때 이걸로 틀렸다.
     또 확대된 좌표계이므로 scale 로 나눠 원본 좌표로 되돌린다. */
  const keepL = Math.abs(cropOffsetLeft || 0) / scale;
  const keepT = Math.abs(cropOffsetTop || 0) / scale;
  const keepW = T.W / scale;
  const keepH = T.H / scale;

  const strips = [];
  if (keepW < srcW - MIN_STRIP_PX) {                     // 좌우가 잘렸다
    strips.push([0, 0, keepL, srcH]);                    // 왼쪽 버린 띠
    strips.push([keepL + keepW, 0, srcW - (keepL + keepW), srcH]);   // 오른쪽 버린 띠
  }
  if (keepH < srcH - MIN_STRIP_PX) {                     // 위아래가 잘렸다
    strips.push([0, 0, srcW, keepT]);
    strips.push([0, keepT + keepH, srcW, srcH - (keepT + keepH)]);
  }

  let worst = 0;
  for (const [l, t2, w2, h2] of strips) {
    if (w2 < MIN_STRIP_PX || h2 < MIN_STRIP_PX) continue;
    try {
      const share = await _skinShare(sharp, buffer, l, t2, w2, h2);
      if (share > worst) worst = share;
    } catch (e) { /* 띠 하나를 못 읽어도 나머지로 판단한다 */ }
  }
  return { cut: worst >= CUT_SUBJECT_SKIN, skin: worst };
}

/**
 * 사진 한 장을 판형 비율로 채워 자른다.
 *
 * 실패는 삼킨다 — 자르기가 안 된다고 브리프에서 사진이 사라지면 안 된다.
 * 그럴 때는 원본을 그대로 돌려주고 이유를 남긴다.
 *
 * @param {Buffer} buffer 원본 사진
 * @param {'feed'|'reels'} variant 커버가 정한 판형
 * @returns {Promise<{buffer:Buffer, changed:boolean, severe:boolean, drop:boolean,
 *                    skin:number|null, kept:number|null, from:string|null, reason:string|null}>}
 *          drop=true 면 **캐러셀에서 빼야 한다** — 잘려나간 자리에 사람이 있었다.
 */
async function cropSlideToVariant(buffer, variant) {
  const out = { buffer, changed: false, severe: false, drop: false, skin: null, kept: null, from: null, reason: null };
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
    const done = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(T.W, T.H, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    out.buffer = done.data;
    out.changed = true;

    /* 버려진 자리에 사람이 있었으면 이 슬라이드는 쓰지 않는다. */
    try {
      const cutInfo = await findCutSubject(sharp, buffer, w, h, T,
        done.info.cropOffsetLeft, done.info.cropOffsetTop);
      out.skin = cutInfo.skin;
      if (cutInfo.cut) {
        out.drop = true;
        out.reason = '잘려나간 자리에 인물로 보이는 영역이 있다 ('
          + Math.round(cutInfo.skin * 100) + '%)';
      }
    } catch (e) {
      /* 검사가 실패하면 **빼지 않는다.** 못 본 것을 근거로 사진을 버리지 않는다. */
      out.reason = '인물 검사 실패(그대로 사용): ' + String((e && e.message) || e).slice(0, 80);
    }
    return out;
  } catch (e) {
    out.reason = '자르기 실패: ' + String((e && e.message) || e).slice(0, 120);
    return out;   // 원본 그대로 — 사진이 사라지는 것보다 낫다
  }
}

module.exports = {
  cropSlideToVariant, keptFraction, targetRatio, findCutSubject, isSkinPixel,
  TARGETS, RATIO_TOLERANCE, SEVERE_KEEP, CUT_SUBJECT_SKIN,
};
