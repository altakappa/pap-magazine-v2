/**
 * PAP Magazine — X 용 예고편 영상 (2026-10-03 신설)
 *
 * 도메니코(2026-10-03): "트위터에서 인스타그램으로 넘어가게 유도할 수 있는
 * 가장 큰 방법은?" → 실측: 지효 루부탱 트윗 2,972 뷰 · 349 좋아요 · 147 RT 인데
 * 답글의 인스타 링크를 누른 사람은 **8명**. 리트윗으로 퍼지는 건 영상이지
 * 답글이 아니고, X 에 풀 영상이 그대로 있으니 인스타로 갈 이유가 없었다.
 * → "전부 적용해줘".
 *
 * 그래서 X 에 올리는 영상은 세 가지가 달라진다. 한 번의 인코딩으로:
 *   ① 앞 N초만 (기본 7초, X_TEASER_SECONDS). 풀 영상은 인스타에만 있다.
 *   ② 전 구간 우하단 워터마크 `@pap_magazine` — 리트윗을 타고 같이 간다.
 *   ③ 끝 1.5초 엔드카드: 심볼 + `@pap_magazine` + "풀 영상은 인스타그램에서".
 *
 * 짧은 영상(N+3초 이하)은 자르지 않는다 — 7초짜리를 7초로 자르는 건 의미가
 * 없고, 그래도 워터마크·엔드카드는 굽는다.
 *
 * ── 왜 ffmpeg-static 인가 / 실패 방침 ─────────────────────
 * videoOverlay.js 와 같다. Vercel 런타임엔 ffmpeg 가 없고, 픽셀을 다시 만드는
 * 일은 순수 JS 로 못 한다. **실패하면 던지지 않고 null** — 호출부는 원본 영상으로
 * 트윗을 계속 내보낸다. 예고편이 안 되면 풀 영상이 나가는 게, 트윗이 안 나가는
 * 것보다 낫다. 대신 로그는 남긴다.
 *
 * ── 끄는 길 ────────────────────────────────────────────────
 * X_TEASER=off 면 이 모듈은 아무것도 하지 않는다. 번들 크기·인코딩 시간이
 * 걸린 기능이라 환경변수 하나로 즉시 되돌릴 수 있어야 한다(videoOverlay 와
 * 같은 원칙). 기본은 **켜짐** — 도메니코가 "전부 적용" 이라고 했다.
 *
 * ── 글자는 path 로 ───────────────────────────────────────
 * sharp 의 text 는 Vercel 에서 안 된다(celebThumb.js 머리말: VipsOperation
 * class "text" not found). opentype.js 로 글자를 path 로 바꿔 SVG 에 넣는다.
 * **글자 단위**로 잰다/그린다 — 여러 글자를 한 번에 넘기면 opentype.js 2.0 이
 * GSUB 에서 던진다(celebThumb 실측). 폰트는 api/_assets/celeb 의 Pretendard.
 * 그 폴더는 vercel.json 의 includeFiles 로 sync-instagram 함수에도 실려야 한다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', '_assets', 'celeb');
const HANDLE = '@pap_magazine';
const CARD_LINE = '풀 영상은 인스타그램에서';

const DEFAULTS = {
  seconds: 7,        // 예고편 길이. X_TEASER_SECONDS 로 바꾼다
  minTrim: 3,        // 원본이 seconds+minTrim 보다 짧으면 자르지 않는다
  card: 1.5,         // 엔드카드 길이(초)
  crf: 23,
  preset: 'veryfast',
  timeoutMs: 60000,  // sync-instagram 함수 상한(120초) 안에서 넉넉히
};

function isEnabled() {
  return String(process.env.X_TEASER || 'on').toLowerCase() !== 'off';
}

function teaserSeconds() {
  const n = Number(process.env.X_TEASER_SECONDS);
  return Number.isFinite(n) && n >= 3 && n <= 30 ? n : DEFAULTS.seconds;
}

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    return (typeof p === 'string' && p) ? p : null;
  } catch (_e) { return null; }
}

/* ── mp4 길이(초) — moov/mvhd 의 timescale·duration ─────────────────
   ffprobe 는 ffmpeg-static 에 없다. mp4Mute 의 박스 파서를 빌려 직접 읽는다.
   못 읽으면 null (호출부는 "모르면 자른다"가 아니라 "모르면 안 자른다" —
   길이를 모르는 채 7초로 자르면 5초짜리 영상이 깨진다). */
function mp4Duration(buf) {
  try {
    const { listBoxes, findChild } = require('./mp4Mute');
    const top = listBoxes(buf, 0, buf.length);
    if (!top) return null;
    const moov = top.find((b) => b.type === 'moov');
    if (!moov) return null;
    const mvhd = findChild(buf, moov, 'mvhd');
    if (!mvhd) return null;
    const version = buf[mvhd.payload];
    let off = mvhd.payload + 4;                      // version(1)+flags(3)
    let timescale, duration;
    if (version === 1) {
      off += 16;                                     // creation(8)+modification(8)
      timescale = buf.readUInt32BE(off);
      duration = Number(buf.readBigUInt64BE(off + 4));
    } else {
      off += 8;                                      // creation(4)+modification(4)
      timescale = buf.readUInt32BE(off);
      duration = buf.readUInt32BE(off + 4);
    }
    if (!(timescale > 0) || !(duration >= 0)) return null;
    return duration / timescale;
  } catch (_e) { return null; }
}

/* ── 자를지 / 어디서 카드를 켤지. 순수 함수 — 테스트가 이걸 본다 ───────
   @returns {{outSeconds:number|null, cardAt:number, trimmed:boolean}}
     outSeconds null 이면 -t 를 안 건다(전체 길이). cardAt 은 카드가 켜지는 t. */
function plan(durationSec, opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const d = Number(durationSec);
  const known = Number.isFinite(d) && d > 0;
  if (known && d <= o.seconds + o.minTrim) {
    // 짧은 영상: 자르지 않고 끝 card 초에만 카드
    return { outSeconds: null, cardAt: Math.max(0, +(d - o.card).toFixed(2)), trimmed: false };
  }
  if (!known) {
    // 길이를 모르면 자르지 않는다. 카드는 켤 자리를 모르니 워터마크만.
    return { outSeconds: null, cardAt: -1, trimmed: false };
  }
  return { outSeconds: o.seconds, cardAt: +(o.seconds - o.card).toFixed(2), trimmed: true };
}

/* ── 필터 식. 한 곳에서만 만든다 ────────────────────────────────
   0:v 원본 · 1:v 워터마크(전 구간) · 2:v 엔드카드(cardAt 부터 끝까지)
   ⚠️ PNG 입력에 fade 를 걸지 않는다. 정지 이미지는 프레임이 t=0 하나뿐이라
   fade=in:st=5.5 는 그 유일한 프레임을 투명하게 만들고, overlay 는 그 투명
   프레임을 끝까지 반복한다 → 카드가 영영 안 보인다(2026-10-03 합성 영상 실측).
   켜고 끄는 건 enable 식 하나로 충분하다. */
function buildFilter(p) {
  const parts = ['[1:v]format=rgba[wm]', '[0:v][wm]overlay=0:0[v1]'];
  if (p.cardAt >= 0) {
    parts.push('[2:v]format=rgba[ec]');
    parts.push("[v1][ec]overlay=0:0:enable='gte(t," + p.cardAt.toFixed(2) + ")'[v]");
  } else {
    parts.push('[v1]null[v]');
  }
  return parts.join(';');
}

/* ── 글자 → SVG path ───────────────────────────────────────────── */
let _font = null;
function font() {
  if (!_font) {
    const opentype = require('opentype.js');
    const buf = fs.readFileSync(path.join(ASSETS, 'Pretendard-SemiBold.otf'));
    _font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return _font;
}
function textWidth(f, text, size, track) {
  let w = 0;
  const chars = Array.from(String(text));
  for (const ch of chars) w += f.getAdvanceWidth(ch, size);
  return w + track * Math.max(0, chars.length - 1);
}
function textPath(f, text, x, baseline, size, track) {
  let cx = x;
  const out = [];
  for (const ch of String(text)) {
    out.push(f.getPath(ch, cx, baseline, size).toPathData(2));
    cx += f.getAdvanceWidth(ch, size) + track;
  }
  return out.join(' ');
}
function centeredPath(f, text, W, baseline, size, track) {
  const w = textWidth(f, text, size, track);
  return textPath(f, text, (W - w) / 2, baseline, size, track);
}

/**
 * 우하단 워터마크 PNG (투명 배경, 영상과 같은 크기).
 * 글자 크기는 가로폭 기준(세로 영상 1080 → 약 35px). 그림자 대신 반투명
 * 검정 테두리 — 밝은 배경에서도 읽힌다.
 */
async function renderWatermark(W, H) {
  const sharp = require('sharp');
  const f = font();
  const size = Math.round(W * 0.032);
  const margin = Math.round(W * 0.045);
  const w = textWidth(f, HANDLE, size, 0);
  const x = W - margin - w;
  const base = H - margin;
  const d = textPath(f, HANDLE, x, base, size, 0);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
    + '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="' + (size * 0.14).toFixed(1) + '" stroke-linejoin="round"/>'
    + '<path d="' + d + '" fill="rgba(255,255,255,0.88)"/>'
    + '</svg>';
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
}

/**
 * 엔드카드 PNG. 검정 78% 위에 심볼(있으면) · @pap_magazine · "풀 영상은 인스타그램에서".
 * 영상과 같은 크기라 overlay=0:0 으로 바로 얹는다.
 */
async function renderEndCard(W, H) {
  const sharp = require('sharp');
  const f = font();
  const big = Math.round(W * 0.075);
  const small = Math.round(W * 0.038);
  const cy = Math.round(H * 0.5);
  const d1 = centeredPath(f, HANDLE, W, cy, big, 0);
  const d2 = centeredPath(f, CARD_LINE, W, cy + Math.round(big * 1.15), small, 1);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
    + '<rect width="' + W + '" height="' + H + '" fill="rgba(0,0,0,0.78)"/>'
    + '<path d="' + d1 + '" fill="#fff"/>'
    + '<path d="' + d2 + '" fill="rgba(255,255,255,0.85)"/>'
    + '</svg>';
  const layers = [{ input: Buffer.from(svg), left: 0, top: 0 }];
  // 심볼은 있으면 얹고 없으면 건너뛴다 — 심볼 하나 때문에 카드가 안 나가면 안 된다.
  try {
    const sym = path.join(ASSETS, 'symbol70.png');
    if (fs.existsSync(sym)) {
      const side = Math.round(W * 0.08);
      const png = await sharp(sym).resize(side, side, { fit: 'inside' }).png().toBuffer();
      const meta = await sharp(png).metadata();
      layers.push({ input: png, left: Math.round((W - (meta.width || side)) / 2), top: cy - big - Math.round(side * 1.25) });
    }
  } catch (_e) { /* 심볼 없이 진행 */ }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers).png().toBuffer();
}

/**
 * @param {Buffer} videoBuffer 원본 mp4 (인스타 영상)
 * @param {object} [opts] DEFAULTS 참고
 * @returns {Promise<Buffer|null>} 예고편 mp4. 못 하면 null (원본으로 올리라는 뜻)
 */
async function makeTeaser(videoBuffer, opts) {
  if (!isEnabled()) return null;
  if (!videoBuffer || !videoBuffer.length) return null;
  const o = { ...DEFAULTS, ...(opts || {}), seconds: (opts && opts.seconds) || teaserSeconds() };
  const bin = ffmpegPath();
  if (!bin) { console.warn('[x-teaser] ffmpeg-static 없음 — 원본 그대로'); return null; }

  const { mp4Dimensions } = require('./mp4Mute');
  const dim = mp4Dimensions(videoBuffer);
  if (!dim || !(dim.width > 0 && dim.height > 0)) { console.warn('[x-teaser] 영상 크기를 못 읽음 — 원본 그대로'); return null; }
  // 홀수 크기는 yuv420p 에서 깨진다 — 오버레이는 영상 크기 그대로 두고 인코더가 처리하게 둔다.
  const W = dim.width, H = dim.height;
  const p = plan(mp4Duration(videoBuffer), o);

  const os = require('os');
  const { execFile } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pap-xteaser-'));
  const inPath = path.join(dir, 'in.mp4');
  const wmPath = path.join(dir, 'wm.png');
  const ecPath = path.join(dir, 'ec.png');
  const outPath = path.join(dir, 'out.mp4');
  try {
    fs.writeFileSync(inPath, videoBuffer);
    fs.writeFileSync(wmPath, await renderWatermark(W, H));
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inPath, '-i', wmPath];
    if (p.cardAt >= 0) {
      fs.writeFileSync(ecPath, await renderEndCard(W, H));
      args.push('-i', ecPath);
    }
    args.push('-filter_complex', buildFilter(p), '-map', '[v]', '-map', '0:a?');
    if (p.outSeconds) args.push('-t', String(p.outSeconds));
    args.push(
      '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',      // -t 로 자르므로 오디오도 다시 만든다 (copy 는 경계가 안 맞는다)
      '-movflags', '+faststart', outPath,
    );
    await new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: o.timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, _so, se) => {
        if (err) {
          const detail = String(se || err.message || '').split('\n').filter(Boolean).slice(-3).join(' | ');
          return reject(new Error('ffmpeg 실패: ' + detail.slice(0, 300)));
        }
        resolve();
      });
    });
    const out = fs.readFileSync(outPath);
    if (!out || out.length < 1024) throw new Error('ffmpeg 결과물이 비었다');
    console.log('[x-teaser] ' + (p.trimmed ? p.outSeconds + '초 예고편' : '전체(짧은 영상)') + ' · 워터마크' + (p.cardAt >= 0 ? ' · 엔드카드' : '') + ' · ' + Math.round(out.length / 1024) + 'KB');
    return out;
  } catch (e) {
    console.error('[x-teaser] 실패(원본으로 진행): ' + ((e && e.message) || e));
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 무시 */ }
  }
}

module.exports = { makeTeaser, plan, buildFilter, mp4Duration, renderWatermark, renderEndCard, isEnabled, teaserSeconds, DEFAULTS, HANDLE, CARD_LINE };
