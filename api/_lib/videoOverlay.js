/**
 * PAP Magazine — 영상에 PAP 디자인 굽기 (2026-08-23 신설)
 *
 * 도메니코(2026-08-23):
 *   "영상 자체에 디자인을 올려서 릴스로 올릴 수는 없을까?" → "앞 2-3초"
 *   그리고 앞서: "영상은 릴스형으로 확대해서 잘라주고"
 *
 * 두 요청을 **한 번의 인코딩**으로 처리한다. 어차피 재인코딩이라 따로 할 이유가 없다.
 *   ① 9:16 로 확대 후 중앙 크롭 (scale force_original_aspect_ratio=increase → crop)
 *   ② 앞 N초 동안 투명 오버레이를 얹고 끝에서 부드럽게 사라지게
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
  seconds: 3,        // 오버레이가 보이는 시간 (도메니코: 앞 2-3초)
  fade: 0.6,         // 끝에서 사라지는 시간
  width: 1080,
  height: 1920,
  crf: 23,
  preset: 'veryfast',
  timeoutMs: 240000, // 함수 상한 300초보다 짧게
};

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

/* enable 식과 fade 시작점은 seconds 에서 파생된다 — 한 곳에서만 계산한다. */
function buildFilter(o) {
  const fadeStart = Math.max(0, o.seconds - o.fade);
  return [
    '[0:v]scale=' + o.width + ':' + o.height
      + ':force_original_aspect_ratio=increase,crop=' + o.width + ':' + o.height + '[bg]',
    '[1:v]format=rgba,fade=out:st=' + fadeStart.toFixed(2) + ':d=' + o.fade.toFixed(2) + ':alpha=1[ov]',
    "[bg][ov]overlay=0:0:enable='lte(t," + o.seconds + ")'[v]",
  ].join(';');
}

/**
 * @param {Buffer} videoBuffer  원본 mp4
 * @param {Buffer} overlayPng   투명 배경 오버레이 (celebThumb.renderOverlay)
 * @param {object} opts         DEFAULTS 참고
 * @returns {Promise<Buffer|null>} 구운 mp4. 못 하면 null (원본으로 진행하라는 뜻)
 */
async function burnIntro(videoBuffer, overlayPng, opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
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

module.exports = { burnIntro, isEnabled, buildFilter, ffmpegPath, DEFAULTS };
