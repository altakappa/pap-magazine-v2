/**
 * 얼굴이 잘렸을 때만 뺀다 (2026-08-28 도메니코: "얼굴만 안 잘리면 괜찮아")
 *
 * 왜 바꿨나 ────────────────────────────────────────────────────────
 * 종전 규칙은 버려진 자리의 **살색 비율 1%** 였다. 색만 보므로 팔·다리·손·
 * 베이지 옷·나무·모래까지 사람으로 셌다. 8/28 페리 로즈 브리프에서 9장 중
 * 6장이 빠졌다 — 한 브리프의 3분의 2가 사라지는 건 규칙이 과한 것이다.
 *
 * 실측 (기기의 실제 화보 사진 28장, 4:5 크롭이 필요한 것만):
 *   종전 규칙  18장 제외 (64%)
 *   새 규칙     6장 제외 (21%)
 * 빠진 6장의 버려진 띠를 눈으로 확인했고, 대부분 실제로 얼굴이 잘려 있었다.
 *
 * ⚠️ 이건 얼굴 '인식'이 아니다. Vercel 크론에 모델을 올릴 수 없어서 쓰는
 * 휴리스틱이다. 정면 얼굴은 잘 잡고, 아주 작거나 옆얼굴은 놓칠 수 있다.
 * 태도도 뒤집혔다 — 종전에는 애매하면 뺐고, 이제는 애매하면 쓴다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const sc = require(path.join(ROOT, 'api/_lib/slideCrop.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'api/_lib/slideCrop.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

/* 합성 격자 — 실사진 없이 판정 규칙만 검사한다. */
const SKIN = [200, 150, 120], DARKBG = [30, 60, 90], LIGHTBG = [210, 215, 220], DARK = [40, 30, 28];
const W = 60, H = 80, MIN = 8;
function grid(fn) {
  const a = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = fn(x, y);
      a[(y * W + x) * 3] = c[0]; a[(y * W + x) * 3 + 1] = c[1]; a[(y * W + x) * 3 + 2] = c[2];
    }
  }
  return a;
}
/* 얼굴: 타원 + 눈 두 개 + 입 */
function face(bg, eyeL, eyeR) {
  return grid((x, y) => {
    const dx = (x - 30) / 16, dy = (y - 38) / 20;
    if (dx * dx + dy * dy > 1) return bg;
    if (Math.hypot(x - eyeL, y - 32) < 3) return DARK;
    if (Math.hypot(x - eyeR, y - 32) < 3) return DARK;
    if (Math.abs(y - 48) < 2 && Math.abs(x - 30) < 7) return DARK;
    return SKIN;
  });
}

console.log('\n① 얼굴은 잡는다');
t('정면 얼굴 (어두운 배경)', () => assert.strictEqual(sc.findFaceInMask(face(DARKBG, 23, 37), W, H, MIN).face, true));
t('정면 얼굴 (밝은 배경)', () => assert.strictEqual(sc.findFaceInMask(face(LIGHTBG, 23, 37), W, H, MIN).face, true));
t('눈 위치를 찾아 이유를 남긴다', () => {
  const r = sc.findFaceInMask(face(DARKBG, 23, 37), W, H, MIN);
  assert.ok(r.blob && r.blob.eyes, '눈 한 쌍을 못 찾았다');
  assert.ok(r.blob.eyes.dx > 0.15 && r.blob.eyes.dx < 0.7, '눈 간격이 얼굴 범위를 벗어난다');
});

console.log('\n② 얼굴이 아닌 것은 빼지 않는다 (이번 변경의 목적)');
t('팔 — 길쭉해서 얼굴이 아니다', () => {
  const arm = grid((x) => (x > 26 && x < 34) ? SKIN : DARKBG);
  assert.strictEqual(sc.findFaceInMask(arm, W, H, MIN).face, false);
});
t('베이지 벽 — 균일해서 얼굴이 아니다', () => {
  assert.strictEqual(sc.findFaceInMask(grid(() => SKIN), W, H, MIN).face, false);
});
t('손 — 그늘이 하나뿐이라 얼굴이 아니다', () => {
  const hand = grid((x, y) => {
    const dx = (x - 30) / 15, dy = (y - 40) / 19;
    if (dx * dx + dy * dy > 1) return DARKBG;
    return (y > 52 && Math.abs(x - 34) < 9) ? DARK : SKIN;
  });
  assert.strictEqual(sc.findFaceInMask(hand, W, H, MIN).face, false);
});
t('눈이 너무 붙어 있으면 얼굴로 보지 않는다', () => {
  assert.strictEqual(sc.findFaceInMask(face(DARKBG, 29, 32), W, H, MIN).face, false);
});
t('작은 살색 조각은 얼굴로 보지 않는다 (손끝·발끝)', () => {
  const tiny = grid((x, y) => (Math.hypot(x - 30, y - 40) < 3) ? SKIN : DARKBG);
  assert.strictEqual(sc.findFaceInMask(tiny, W, H, MIN).face, false);
});

console.log('\n③ 규칙이 코드에 남아 있다');
t('빼는 근거가 살색 비율이 아니라 얼굴이다', () => {
  assert.ok(/return \{ cut: !!face, skin: worst, blob: face \}/.test(SRC),
    'cut 이 살색 비율로 돌아가면 또 3분의 2가 빠진다');
  assert.ok(/얼굴로 보이는 덩어리가 있다/.test(SRC), '빼는 이유를 사람이 읽을 수 있어야 한다');
});
t('판정 기준값이 한곳에 모여 있다 (다시 손볼 자리)', () => {
  ['FACE_MIN_SIDE', 'FACE_ASPECT_MIN', 'FACE_ASPECT_MAX', 'FACE_FILL_MIN', 'FACE_DARK_MIN', 'FACE_DARK_MAX']
    .forEach((k) => assert.ok(typeof sc[k] === 'number', k + ' 가 export 되지 않았다'));
});
t('살색 비율은 참고 수치로 남는다 (나중에 기준을 다시 볼 재료)', () => {
  assert.ok(/skin: worst/.test(SRC));
  assert.ok(/CUT_SUBJECT_SKIN/.test(SRC), '상수를 지우면 과거 기록과 대조할 수 없다');
});
t('검사가 실패하면 빼지 않는다 (못 본 것을 근거로 버리지 않는다)', () => {
  assert.ok(/인물 검사 실패\(그대로 사용\)/.test(SRC));
});

console.log('\n얼굴 크롭 판정: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
if (fail) process.exit(1);
