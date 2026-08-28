/**
 * PAP Magazine — 영상에 PAP 디자인 굽기 (2026-08-23 신설)
 *
 * 도메니코(2026-08-23):
 *   "영상 자체에 디자인을 올려서 릴스로 올릴 수는 없을까?" → 처음엔 "앞 2-3초"
 *   → 실물을 보고 바꿈: **"섬네일은 3초 후에 사라지지 않고 계속 유지하자"**
 *   그리고 앞서: "영상은 릴스형으로 확대해서 잘라주고"
 *
 * 두 요청을 **한 번의 인코딩**으로 처리한다. 어차피 재인코딩이라 따로 할 이유가 없다.
 *   ① 판형 비율로 확대 후 중앙 크롭 (scale force_original_aspect_ratio=increase → crop)
 *   ② 오버레이를 **영상 전체 구간**에 얹는다 (seconds: 0)
 *
 * ⚠️ 2026-08-28 (도메니코: "캐러셀 기사라면 캐러셀에 맞는 영상의 비율이 필요하고
 *    릴스 기사라면 릴스에 맞는 영상의 비율이 필요함")
 *    종전에는 판형과 무관하게 **1080x1920 으로 고정**해서 구웠다. 그래서 4:5
 *    브리프에서 오버레이는 1080x1350 인데 배경은 1080x1920 이 되어, 디자인이
 *    위쪽에만 붙고 아래 570px 이 비었다(= "레이아웃이 엉망"). 영상 자체도 9:16 이라
 *    4:5 커버와 섞여 인스타에서 눌렸다(= "비율이 엉망").
 *    실측 사례 4건: 8/26 지젤·월병, 8/27 프라다 카페, 8/28 페리 로즈.
 *    이제 **판형이 크기를 정한다.** 크기의 유일한 출처는 slideCrop.TARGETS 다.
 *
 * seconds 를 0 이 아닌 값으로 주면 앞 N초만 얹고 끝에서 페이드아웃한다 —
 * 지금은 안 쓰지만 되돌릴 길을 남겨 둔다(도메니코가 한 번 바꿨으니 또 바꿀 수 있다).
 *
 * ── 왜 ffmpeg-static 인가 ────────────────────────────────────
 * Vercel 런타임에는 ffmpeg 가 없다(_lib/mp4Mute.js 머리말). 영상 위에 그림을
 * 굽는 건 순수 JS 로 우회할 방법이 없다 — 픽셀을 다시 만들어야 한다.
 * ffmpeg-static 은 리눅스 x64 정적 바이너리를 node_modules 로 가져다준다.
 *
 * ⚠️ 이 모듈은 **기본적으로 꺼져 있다.** 호출부가 CELEB_BURN_OVERLAY=on 일 때만
 *    부른다. 잘못되면 환경변수 하나로 즉시 되돌릴 수 있어야 한다 —
 *    번들 크기·콜드스타트·인코딩 시간이 걸린 기능이라 되돌릴 길을 먼저 만든다.
 *
 * ⚠️ 실패하면 **던지지 않고 null 을 돌려준다.** 굽기가 안 되면 원본 영상으로
 *    브리프를 계속 보내야지, 브리프 자체가 사라지면 안 된다.
 */

'use strict';

const DEFAULTS = {
  seconds: 0,        // 0 = 영상 전체 구간 (도메니코 2026-08-23: "계속 유지하자")
  fade: 0.6,         // seconds > 0 일 때만 쓰는 페이드아웃 시간
  width: 1080,
  height: 1920,      // 판형을 안 주면 종전대로 9:16 (되돌릴 길)
  crf: 23,
  preset: 'veryfast',
  timeoutMs: 240000, // 함수 상한 300초보다 짧게
};

/* 판형별 크기의 **유일한 출처**. 사진(slideCrop)·커버(celebThumb)·영상이
   같은 표를 봐야 한 브리프 안에서 비율이 갈리지 않는다. slideCrop 은 sharp 를
   끌고 오지 않는 순수 모듈이라 여기서 가져와도 무겁지 않다. */
function dimsForVariant(variant) {
  const { TARGETS } = require('./slideCrop');
  const t = TARGETS[variant] || TARGETS.reels;
  return { width: t.W, height: t.H };
}

/* opts 를 실제 인코딩 값으로 편다. variant 를 주면 크기는 그 판형이 정한다.
   width/height 를 직접 준 경우엔 그것을 존중한다(테스트·수동 호출용). */
function resolveOpts(opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const explicit = opts && (opts.width || opts.height);
  if (o.variant && !explicit) {
    const d = dimsForVariant(o.variant);
    o.width = d.width;
    o.height = d.height;
  }
  return o;
}

function isEnabled() {
  return String(process.env.CELEB_BURN_OVERLAY || '').toLowerCase() === 'on';
}

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    return (typeof p === 'string' && p) ? p : null;
  } catch (_e) {
    return null;
  }
}

/* seconds === 0 이면 전체 구간(페이드·enable 없음), 아니면 앞 N초 + 페이드아웃.
   두 경우의 식이 한 곳에서만 만들어지게 둔다. */
function buildFilter(o) {
  const scale = '[0:v]scale=' + o.width + ':' + o.height
    + ':force_original_aspect_ratio=increase,crop=' + o.width + ':' + o.height + '[bg]';
  if (!o.seconds) {
    return [scale, '[1:v]format=rgba[ov]', '[bg][ov]overlay=0:0[v]'].join(';');
  }
  const fadeStart = Math.max(0, o.seconds - o.fade);
  return [
    scale,
    '[1:v]format=rgba,fade=out:st=' + fadeStart.toFixed(2) + ':d=' + o.fade.toFixed(2) + ':alpha=1[ov]',
    "[bg][ov]overlay=0:0:enable='lte(t," + o.seconds + ")'[v]",
  ].join(';');
}

/**
 * @param {Buffer} videoBuffer  원본 mp4
 * @param {Buffer} overlayPng   투명 배경 오버레이 (celebThumb.renderOverlay)
 * @param {object} opts         DEFAULTS 참고. **variant('feed'|'reels') 를 줄 것** —
 *                              안 주면 9:16 으로 구워져 4:5 브리프가 깨진다.
 * @returns {Promise<Buffer|null>} 구운 mp4. 못 하면 null (원본으로 진행하라는 뜻)
 */
async function burnIntro(videoBuffer, overlayPng, opts) {
  const o = resolveOpts(opts);
  const bin = ffmpegPath();
  if (!bin) { console.warn('[video-overlay] ffmpeg-static 없음 — 원본 그대로'); return null; }
  if (!videoBuffer || !videoBuffer.length || !overlayPng || !overlayPng.length) return null;

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFile } = require('child_process');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pap-burn-'));
  const inPath = path.join(dir, 'in.mp4');
  const ovPath = path.join(dir, 'ov.png');
  const outPath = path.join(dir, 'out.mp4');

  try {
    fs.writeFileSync(inPath, videoBuffer);
    fs.writeFileSync(ovPath, overlayPng);

    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inPath, '-i', ovPath,
      '-filter_complex', buildFilter(o),
      '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf),
      '-pix_fmt', 'yuv420p',
      /* 오디오는 다시 만들지 않는다 — 인스타 음원이 붙은 릴스라 원본을 그대로 둔다.
         (음소거가 필요하면 그건 mp4Mute 의 일이지 여기서 할 일이 아니다) */
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outPath,
    ];

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
    return out;
  } catch (e) {
    console.error('[video-overlay] ' + ((e && e.message) || e));
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 임시 폴더 정리 실패는 무시 */ }
  }
}

/**
 * 오버레이 없이 **비율만** 판형에 맞춘다 (2026-08-28 도메니코 지시).
 *
 * 왜 따로 두나: 디자인 굽기(CELEB_BURN_OVERLAY)는 꺼져 있을 수 있고 실패할 수도
 * 있다. 그때 종전에는 원본 영상이 그대로 실려서 4:5 캐러셀에 9:16 영상이,
 * 릴스에 4:5 영상이 섞였다. 굽기 여부와 무관하게 **비율은 항상 맞아야 한다.**
 *
 * 이미 목표 비율이면 건드리지 않는다 — 재인코딩은 화질만 깎는다.
 * 판단은 호출부가 잰 크기(mp4Mute.mp4Dimensions)로 하고, 못 쟀으면 자른다
 * (모르면 맞추는 쪽이 안전하다 — 틀린 비율로 나가는 것보다 낫다).
 *
 * @param {Buffer} videoBuffer
 * @param {'feed'|'reels'} variant
 * @param {{dim?:{width:number,height:number,ratio:number}}} [opts]
 * @returns {Promise<Buffer|null>} 자른 mp4. 이미 맞거나 못 하면 null (원본 유지)
 */
async function cropToVariant(videoBuffer, variant, opts) {
  const o = resolveOpts({ ...(opts || {}), variant: variant });
  if (!videoBuffer || !videoBuffer.length) return null;

  const dim = opts && opts.dim;
  if (dim && Number(dim.ratio) > 0) {
    const target = o.width / o.height;
    if (Math.abs(Number(dim.ratio) - target) <= 0.02) return null;   // 이미 맞다
  }

  const bin = ffmpegPath();
  if (!bin) { console.warn('[video-overlay] ffmpeg-static 없음 — 비율 못 맞춤'); return null; }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFile } = require('child_process');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pap-vcrop-'));
  const inPath = path.join(dir, 'in.mp4');
  const outPath = path.join(dir, 'out.mp4');
  try {
    fs.writeFileSync(inPath, videoBuffer);
    const vf = 'scale=' + o.width + ':' + o.height
      + ':force_original_aspect_ratio=increase,crop=' + o.width + ':' + o.height;
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inPath,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',              // 인스타 음원 보존 (burnIntro 와 같은 방침)
      '-movflags', '+faststart',
      outPath,
    ];
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
    return out;
  } catch (e) {
    console.error('[video-overlay] 비율 맞추기 실패(원본으로 진행): ' + ((e && e.message) || e));
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 무시 */ }
  }
}

module.exports = { burnIntro, cropToVariant, isEnabled, buildFilter, ffmpegPath, DEFAULTS, dimsForVariant, resolveOpts };
