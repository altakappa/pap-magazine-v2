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

/* 잘려나간 자리에 **얼굴**이 있었나 (2026-08-28 기준 변경) ──────────────
   도메니코 2026-08-26: "인물이 잘릴경우에는 그냥 안쓸게."
   도메니코 2026-08-28: **"얼굴만 안 잘리면 괜찮아"**

   기준이 바뀐 이유: 살색만 보면 팔·다리·손·베이지 옷·나무·모래까지 사람으로
   센다. 실제로 8/28 페리 로즈 브리프에서 **9장 중 6장이 빠졌다.** 한 브리프의
   3분의 2가 사라지는 건 규칙이 과한 것이다.

   그래서 판정이 "살색이 있나" 에서 "**얼굴처럼 생긴 덩어리가 있나**" 로 바뀐다.
   덩달아 기본 태도도 뒤집힌다: 종전에는 애매하면 뺐고, 이제는 애매하면 쓴다.

   ⚠️ 이건 여전히 얼굴 '인식'이 아니다. Vercel 크론에 모델을 올릴 수 없다
   (face-api 는 TF + 수 MB 모델 — 콜드스타트가 브리프보다 오래 걸린다).
   아래는 네 가지 신호를 함께 보는 휴리스틱이다. 정면 얼굴은 잘 잡고,
   아주 작거나 옆얼굴·가려진 얼굴은 놓칠 수 있다. 장담하지 않는다.

   얼굴 인식은 못 한다(Vercel 에 모델이 없다). 대신 **버려진 픽셀을 직접 본다.**
   sharp 가 크롭 후 info.cropOffsetLeft/Top 을 준다 — 어디를 잘랐는지 알 수 있다.
   그 바깥 띠에서 살색 픽셀 비율을 재고, 일정 이상이면 "사람이 잘렸다"고 본다.

   왜 버린 쪽을 보나: attention 은 **한 덩어리**로만 창을 옮긴다. 좌우 양끝에 두
   사람이 서 있으면 한쪽은 반드시 버려지는데, 창 안쪽만 봐서는 그걸 절대 모른다.

   얼굴 판정의 네 신호 (넷 다 맞아야 얼굴로 본다)
     ① 살색 픽셀이 **한 덩어리로 이어져** 있다 (흩어진 점은 배경·노이즈)
     ② 그 덩어리가 **충분히 크다** — 짧은 변의 6% 이상. 손끝·발끝은 걸러진다
     ③ **납작하지 않다** — 가로세로비 0.55~1.9. 팔·다리는 길쭉해서 걸러진다
     ④ 덩어리 안에 **어두운 부분이 있다** (눈·눈썹·입).
        맨팔이나 베이지 벽은 균일해서 여기서 걸러진다. 이게 가장 센 신호다.

   빼는 이유는 항상 이름을 대서 알린다 — 조용히 사라지면 왜 3장뿐인지 모른다. */

/** 흔한 RGB 살색 규칙. 얼굴 인식이 아니라 색 필터다. */
function isSkinPixel(rr, gg, bb) {
  const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
  return rr > 95 && gg > 40 && bb > 20 && (mx - mn) > 15
    && Math.abs(rr - gg) > 15 && rr > gg && rr > bb;
}

/* 버려진 띠의 살색 비율. 이제 **빼는 근거가 아니라 참고 수치**다 —
   노트에 같이 적어 두면 나중에 기준을 다시 손볼 때 판단 재료가 된다. */
const CUT_SUBJECT_SKIN = 0.01;
/* 띠가 이보다 얇으면 보지 않는다 (반올림 오차로 1~2px 이 남는 경우). */
const MIN_STRIP_PX = 8;

/* 얼굴 판정 기준 (2026-08-28) ─────────────────────────────────────────
   숫자를 한곳에 모아 둔다. 너무 많이 빠지거나 너무 안 빠지면 여기만 만진다. */
const FACE_GRID = 160;          // 분석 격자의 긴 변 (원본 좌표계 기준)
const FACE_MIN_SIDE = 0.06;     // 얼굴 최소 크기 = 원본 짧은 변의 6% (1080 → 65px)
const FACE_ASPECT_MIN = 0.55;   // 이보다 납작·길쭉하면 팔다리로 본다
const FACE_ASPECT_MAX = 1.9;
const FACE_FILL_MIN = 0.42;     // bbox 를 이만큼은 채워야 덩어리다 (길쭉한 팔 배제)
const FACE_DARK_MIN = 0.015;    // 덩어리 안 어두운 구멍 최소 (눈·눈썹·입)
const FACE_DARK_MAX = 0.75;     // 상한은 느슨하게 둔다 — 어두운 배경 앞의 얼굴은
                                // bbox 모서리가 통째로 어둡다. 진짜 판별은 ⑤ 눈 한 쌍이 한다.

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

/* 덩어리 안에서 눈 한 쌍을 찾는다 (2026-08-28).
   조건: 위쪽 60% 안에 있고 · 가로로 15~70% 떨어져 있고 · 세로 차이가 작고 ·
   크기가 서로 비슷한 어두운 점 두 개. 얼굴이 기울어도 어느 정도 견딘다. */
function _eyePair(skin, luma, gw, minX, minY, maxX, maxY, darkCut) {
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const upperY = minY + Math.round(bh * 0.62);
  const w = bw, h = upperY - minY + 1;
  if (w < 4 || h < 3) return null;
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gi = (minY + y) * gw + (minX + x);
      if (!skin[gi] && luma[gi] < darkCut) mask[y * w + x] = 1;
    }
  }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const blobs = [];
  for (let st = 0; st < n; st++) {
    if (!mask[st] || seen[st]) continue;
    let sp = 0; stack[sp++] = st; seen[st] = 1;
    let area = 0, sx = 0, sy = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w, y = (idx - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack[sp++] = idx - 1; }
      if (x + 1 < w && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack[sp++] = idx + 1; }
      if (y > 0 && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack[sp++] = idx - w; }
      if (y + 1 < h && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack[sp++] = idx + w; }
    }
    /* 눈은 아주 작지도, 얼굴을 덮을 만큼 크지도 않다. */
    if (area < 1 || area > bw * bh * 0.12) continue;
    if ((x1 - x0 + 1) > bw * 0.45) continue;        // 가로로 긴 그늘은 눈이 아니다
    blobs.push({ x: sx / area, y: sy / area, area: area });
  }
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx < bw * 0.15 || dx > bw * 0.70) continue;      // 너무 붙거나 너무 멀다
      if (dy > bh * 0.14) continue;                        // 나란하지 않다
      const big = Math.max(a.area, b.area), small = Math.min(a.area, b.area);
      if (small * 4 < big) continue;                       // 크기가 너무 다르다
      return { dx: +(dx / bw).toFixed(3), dy: +(dy / bh).toFixed(3) };
    }
  }
  return null;
}

/**
 * 살색 마스크에서 **이어진 덩어리**를 찾아 얼굴처럼 생긴 것이 있는지 본다.
 * 순수 계산이라 테스트에서 직접 호출한다(픽셀 배열만 넘기면 된다).
 *
 * @param {Uint8Array|Buffer} rgb   격자 픽셀 (RGB, 채널 3)
 * @param {number} gw               격자 가로
 * @param {number} gh               격자 세로
 * @param {number} minSidePx        얼굴 최소 한 변 (격자 좌표계)
 * @returns {{face:boolean, blob:{w:number,h:number,fill:number,dark:number}|null}}
 */
function findFaceInMask(rgb, gw, gh, minSidePx) {
  const n = gw * gh;
  const skin = new Uint8Array(n);
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    if (isSkinPixel(r, g, b)) skin[i] = 1;
  }

  /* 4방향 연결 성분. 재귀 대신 스택 — 격자가 커도 스택오버플로가 없다. */
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = null;
  for (let start = 0; start < n; start++) {
    if (!skin[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, minX = gw, maxX = -1, minY = gh, maxY = -1;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % gw, y = (idx - x) / gw;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && skin[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack[sp++] = idx - 1; }
      if (x + 1 < gw && skin[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack[sp++] = idx + 1; }
      if (y > 0 && skin[idx - gw] && !seen[idx - gw]) { seen[idx - gw] = 1; stack[sp++] = idx - gw; }
      if (y + 1 < gh && skin[idx + gw] && !seen[idx + gw]) { seen[idx + gw] = 1; stack[sp++] = idx + gw; }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < minSidePx || bh < minSidePx) continue;              // ② 너무 작다
    const aspect = bw / bh;
    if (aspect < FACE_ASPECT_MIN || aspect > FACE_ASPECT_MAX) continue;   // ③ 길쭉하다
    const fill = area / (bw * bh);
    if (fill < FACE_FILL_MIN) continue;                          // ③ 덩어리가 아니다

    /* ④ 덩어리 **안쪽의 구멍**이 어두운가 (눈·눈썹·입).
       살색 영역의 평균 밝기를 기준으로 삼는다 — 어두운 조명에서 얼굴 전체가
       어둡다고 눈이 없다고 보면 안 된다.
       세는 대상은 bbox 안의 **살색이 아닌** 픽셀이다. bbox 전체를 세면 배경이
       어두울 때 아무 살색 덩어리나 통과한다(첫 구현이 그랬다). */
    let sum = 0, cnt = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i2 = y * gw + x;
        if (!skin[i2]) continue;
        sum += luma[i2]; cnt++;
      }
    }
    const mean = cnt ? sum / cnt : 0;
    const darkCut = mean * 0.62;
    let dark = 0, boxN = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i2 = y * gw + x;
        boxN++;
        if (!skin[i2] && luma[i2] < darkCut) dark++;
      }
    }
    const darkShare = boxN ? dark / boxN : 0;
    /* 너무 없으면 맨팔·벽, 너무 많으면 얼굴이 아니라 어두운 배경에 걸친
       살색 조각이다. 얼굴은 그 사이에 있다. */
    if (darkShare < FACE_DARK_MIN || darkShare > FACE_DARK_MAX) continue;

    /* ⑤ 눈 한 쌍이 있나 — 가장 구체적인 신호다.
       어두운 구멍들을 덩어리로 묶고, 그중 **위쪽 절반에 나란히 놓인 두 개**를
       찾는다. 손·팔에도 그늘은 지지만 "비슷한 크기의 두 점이 가로로 나란히"
       놓이는 일은 드물다. 실측에서 손 한 장이 여기서 걸러졌다. */
    const eyes = _eyePair(skin, luma, gw, minX, minY, maxX, maxY, darkCut);
    const cand = { w: bw, h: bh, fill: fill, dark: darkShare, eyes: eyes };
    if (!eyes) continue;
    if (!best || bw * bh > best.w * best.h) best = cand;
  }
  return { face: !!best, blob: best };
}

/**
 * 버려진 띠 하나를 격자로 떠서 얼굴을 찾는다.
 * 격자 크기는 **원본 전체 기준**으로 잡는다 — 띠만 늘려 보면 손톱만 한 살색도
 * 얼굴처럼 커 보인다(그래서 종전 규칙이 그렇게 많이 뺐다).
 */
async function _faceInStrip(sharp, buf, left, top, width, height, srcW, srcH) {
  if (width < MIN_STRIP_PX || height < MIN_STRIP_PX) return { face: false, blob: null };
  const scale = FACE_GRID / Math.max(srcW, srcH);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const minSide = Math.max(3, Math.round(Math.min(srcW, srcH) * FACE_MIN_SIDE * scale));
  if (gw < minSide || gh < minSide) return { face: false, blob: null };   // 띠 자체가 얼굴보다 좁다
  const { data } = await sharp(buf, { failOn: 'none' })
    .rotate()
    .extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) })
    .resize(gw, gh, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return findFaceInMask(data, gw, gh, minSide);
}

/**
 * 크롭에서 **버려진 자리**에 얼굴이 있었는지 본다.
 * @returns {Promise<{cut:boolean, skin:number, blob:object|null}>}
 *          cut=true 면 얼굴로 보이는 덩어리가 잘렸다. skin 은 참고 수치.
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
  let face = null;
  for (const [l, t2, w2, h2] of strips) {
    if (w2 < MIN_STRIP_PX || h2 < MIN_STRIP_PX) continue;
    try {
      const share = await _skinShare(sharp, buffer, l, t2, w2, h2);
      if (share > worst) worst = share;
      if (!face) {
        const f = await _faceInStrip(sharp, buffer, l, t2, w2, h2, srcW, srcH);
        if (f.face) face = f.blob;
      }
    } catch (e) { /* 띠 하나를 못 읽어도 나머지로 판단한다 */ }
  }
  /* 2026-08-28 — 빼는 근거는 **얼굴** 하나다 (도메니코: "얼굴만 안 잘리면 괜찮아").
     살색 비율은 노트에 참고로만 남긴다. */
  return { cut: !!face, skin: worst, blob: face };
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
  const out = { buffer, changed: false, severe: false, drop: false, skin: null, face: null, kept: null, from: null, reason: null };
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
      out.face = cutInfo.blob || null;
      if (cutInfo.cut) {
        out.drop = true;
        out.reason = '잘려나간 자리에 얼굴로 보이는 덩어리가 있다 (살색 '
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
  cropSlideToVariant, keptFraction, targetRatio, findCutSubject, isSkinPixel, findFaceInMask,
  TARGETS, RATIO_TOLERANCE, SEVERE_KEEP, CUT_SUBJECT_SKIN,
  FACE_GRID, FACE_MIN_SIDE, FACE_ASPECT_MIN, FACE_ASPECT_MAX, FACE_FILL_MIN, FACE_DARK_MIN, FACE_DARK_MAX,
};
