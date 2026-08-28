/**
 * 브리프 영상 비율 — 판형이 크기를 정한다 (2026-08-28 도메니코 지시)
 *
 * "캐러셀 기사라면 캐러셀에 맞는 영상의 비율이 필요하고
 *  릴스 기사라면 릴스에 맞는 영상의 비율이 필요함"
 *
 * 무엇이 고장나 있었나 ──────────────────────────────────────────────
 * 사진은 slideCrop 이 판형 비율로 잘랐는데, **영상은 아무도 안 맞췄다.**
 * 게다가 디자인 굽기(videoOverlay.burnIntro)가 판형과 무관하게 1080x1920 으로
 * 고정 인코딩해서, 4:5 브리프에서는
 *   · 오버레이는 1080x1350 인데 배경이 1080x1920  → 디자인이 위쪽에만 붙는다
 *   · 영상은 9:16 인데 커버·사진은 4:5           → 인스타가 눌러 버린다
 * 실측 4건(8/26 지젤·월병, 8/27 프라다 카페, 8/28 페리 로즈)이 그렇게 나갔다.
 *
 * 특히 8/27 프라다 카페 건은 원본이 720x900(정확히 4:5)이었는데도 9:16 으로
 * 나갔고, 크론 노트는 "(비율 일치)" 라고 적었다 — 경고가 **원본만** 보고
 * 출력을 안 봤기 때문이다. 그래서 아래 ③ 을 함께 고정한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const vo = require(path.join(ROOT, 'api/_lib/videoOverlay.js'));
const { TARGETS } = require(path.join(ROOT, 'api/_lib/slideCrop.js'));
const CRON = read('api/cron/celeb-brief.js');

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

console.log('\n① 판형이 크기를 정한다');
t('feed 는 1080x1350, reels 는 1080x1920', () => {
  assert.deepStrictEqual(vo.dimsForVariant('feed'), { width: 1080, height: 1350 });
  assert.deepStrictEqual(vo.dimsForVariant('reels'), { width: 1080, height: 1920 });
});
t('크기의 출처가 slideCrop.TARGETS 하나다 (사진과 영상이 갈리지 않게)', () => {
  ['feed', 'reels'].forEach((v) => {
    assert.strictEqual(vo.dimsForVariant(v).width, TARGETS[v].W, v + ' 가로가 사진과 다르다');
    assert.strictEqual(vo.dimsForVariant(v).height, TARGETS[v].H, v + ' 세로가 사진과 다르다');
  });
  assert.ok(/require\('\.\/slideCrop'\)/.test(read('api/_lib/videoOverlay.js')),
    '숫자를 따로 적으면 한쪽만 고칠 때 어긋난다');
});
t('ffmpeg 필터가 판형 크기로 만들어진다', () => {
  const feed = vo.buildFilter(vo.resolveOpts({ variant: 'feed' }));
  const reels = vo.buildFilter(vo.resolveOpts({ variant: 'reels' }));
  assert.ok(/scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350/.test(feed), feed);
  assert.ok(/scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/.test(reels), reels);
});
t('판형을 안 주면 종전 동작(9:16) 을 유지한다 (되돌릴 길)', () => {
  const o = vo.resolveOpts({});
  assert.strictEqual(o.width, 1080);
  assert.strictEqual(o.height, 1920);
});
t('width/height 를 직접 주면 그것을 존중한다', () => {
  const o = vo.resolveOpts({ variant: 'feed', width: 720, height: 720 });
  assert.strictEqual(o.width, 720);
  assert.strictEqual(o.height, 720);
});

console.log('\n② 호출부가 판형을 실제로 넘긴다 (이번 사고의 핵심)');
t('굽기에 variant 를 넘긴다', () => {
  assert.ok(/burnIntro\(f\.buffer, ov, \{ variant \}\)/.test(CRON),
    'variant 를 안 넘기면 4:5 브리프가 9:16 으로 구워진다 — 실제로 그랬다');
});
t('오버레이와 배경이 같은 판형이다', () => {
  assert.ok(/renderOverlay\([^)]*\{ variant \}\)/.test(CRON), '오버레이가 판형을 안 받는다');
  assert.ok(/burnIntro\([^)]*\{ variant \}\)/.test(CRON), '배경이 판형을 안 받는다');
});
t('굽기가 꺼져 있거나 실패해도 비율은 맞춘다', () => {
  assert.ok(/cropToVariant\(f\.buffer, variant/.test(CRON),
    '굽기는 선택이지만 비율은 선택이 아니다');
  assert.ok(/if \(!sized\)/.test(CRON), '이미 맞춘 영상을 두 번 인코딩하면 화질만 깎인다');
});
t('cropToVariant 가 있고 이미 맞는 비율은 건드리지 않는다', async () => {
  assert.strictEqual(typeof vo.cropToVariant, 'function');
  const src = read('api/_lib/videoOverlay.js');
  assert.ok(/Math\.abs\(Number\(dim\.ratio\) - target\) <= 0\.02\) return null/.test(src),
    '이미 목표 비율인데 재인코딩하면 화질만 깎인다');
});
t('원본 크기를 재서 그대로 넘긴다 (같은 값을 두 번 재지 않는다)', () => {
  assert.ok(/fetched\.push\(\{ type: it\.type, buffer: buf, dim: vdim \}\)/.test(CRON));
  assert.ok(/cropToVariant\(f\.buffer, variant, \{ dim: f\.dim \}\)/.test(CRON));
});

console.log('\n③ 경고는 출력을 본다 (원본만 보면 거짓말이 된다)');
t('비율을 못 맞춘 영상을 숫자로 알린다', () => {
  assert.ok(/비율 못 맞춘 영상/.test(CRON), '조용히 넘어가면 다음에도 모른다');
  assert.ok(/videoOffRatio\+\+/.test(CRON));
});
t('비율을 고친 건수도 알린다', () => {
  assert.ok(/ratioFixed\+\+/.test(CRON) && /비율 맞춤/.test(CRON),
    '고쳤는지 안 고쳤는지 노트만 보고 알 수 있어야 한다');
});
t('원본 크기만 보고 "일치" 라고 적던 코드가 사라졌다', () => {
  assert.ok(!/const offRatio = videoSizes\.filter/.test(CRON),
    '원본 기준 판정이 남아 있으면 8/27 프라다 건처럼 또 거짓 보고한다');
});

console.log('\n④ 실패해도 브리프는 나간다');
t('비율 맞추기 실패가 브리프를 죽이지 않는다', () => {
  assert.ok(/영상 비율 맞추기 실패\(원본으로 진행\)/.test(CRON));
  const src = read('api/_lib/videoOverlay.js');
  const fn = src.slice(src.indexOf('async function cropToVariant'), src.indexOf('module.exports'));
  assert.ok(/return null;/.test(fn) && /catch \(e\)/.test(fn), '던지면 브리프 자체가 사라진다');
  assert.ok(/ffmpeg-static 없음/.test(fn), 'ffmpeg 가 없는 환경에서도 죽지 않아야 한다');
});
t('오디오를 다시 만들지 않는다 (인스타 음원 보존)', () => {
  const src = read('api/_lib/videoOverlay.js');
  const fn = src.slice(src.indexOf('async function cropToVariant'), src.indexOf('module.exports'));
  assert.ok(/'-c:a', 'copy'/.test(fn), 'burnIntro 와 같은 방침이어야 한다');
});

console.log('\n영상 비율: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
if (fail) process.exit(1);
