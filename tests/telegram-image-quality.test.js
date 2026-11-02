/**
 * 텔레그램 갤러리 컷 화질 (2026-11-02)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "현재 텔레그램으로 오는 이미지가 화질이 떨어져서 약간 개선을 해야할것같아."
 *
 * [원인] 갤러리 컷은 인스타 규격(1080×1350)으로 합성한 결과물을 그대로 보내고 있었다.
 *   원본은 서명 URL 로 스토리지에 바로 올라와 수천 px 인데, 텔레그램에 닿을 땐 1080px 다.
 *   커버(첫 장)는 바이트 그대로 가므로 멀쩡했다 — 그래서 "약간" 으로 느껴졌다.
 *
 * [고침] 텔레그램 경로만 2배(2160×2700)로 올린다. ZIP(인스타 업로드용)은 1080 그대로다.
 *   배율은 W·H 에만 곱한다. 로고 크기·여백·사진 위치가 전부 W·H 비율이라 구도는 같다.
 *
 * [용량] PNG 를 2배로 키우면 장당 10MB 를 넘겨 16장이면 업로드가 함수 상한을 넘는다
 *   (실제로 300초 타임아웃이 찍혀 있었다). 그래서 덮는 경우엔 JPEG q95 4:4:4 로 내보낸다 —
 *   픽셀은 4배인데 용량은 종전 PNG 보다 작다. 텔레그램엔 document 로 가므로 재압축 없음.
 *   4:2:0(기본값)이 아니라 4:4:4 인 이유: 색 경계 뭉개짐이 패션 사진에서 가장 먼저 보인다.
 *
 * [안전] 편집자가 사진을 축소해 투명 가장자리가 생기는 경우엔 PNG 를 유지한다.
 *   JPEG 로 바꾸면 그 자리가 검게 칠해진다.
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const sharp = require('sharp');
const IC = require(path.join(ROOT, 'api/_lib/instaComposite'));
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

(async function () {
  /* ── 배율이 W·H 에만 걸린다 ── */
  const o1 = IC.resolveInstaOpts(null, 'https://x/a.jpg');
  const o2 = IC.resolveInstaOpts(null, 'https://x/a.jpg', 2);
  t('기준 캔버스가 2160×2700 이다 (2026-11-02 도메니코 "이미지 전부")', o1.W === 2160 && o1.H === 2700);
  t('추가 배율 2 면 4320×5400', o2.W === 4320 && o2.H === 5400);
  t('1:1 은 2160² (배율 2 면 4320²)', IC.resolveInstaOpts({ global: { aspect: '1:1' } }, 'u').H === 2160 && IC.resolveInstaOpts({ global: { aspect: '1:1' } }, 'u', 2).H === 4320);
  t('구도 값은 배율과 무관하다 (로고·여백·위치는 비율이라 그대로)',
    o1.logoPct === o2.logoPct && o1.padPct === o2.padPct &&
    o1.imgScale === o2.imgScale && o1.offsetX === o2.offsetX && o1.offsetY === o2.offsetY);
  t('배율은 1 미만으로 못 내린다 (기준 아래로는 안 간다)',
    IC.resolveInstaOpts(null, 'u', 0.25).W === 2160);
  t('배율 상한은 MAX_SCALE',
    IC.resolveInstaOpts(null, 'u', 99).W === 2160 * IC.MAX_SCALE);

  /* ── 좌표가 정확히 2배인가 (구도 보존의 실제 증거) ── */
  const L1 = IC.layout(1600, 1000, o1);
  const L2 = IC.layout(1600, 1000, o2);
  t('레이아웃이 정확히 2배로 확대된다',
    Math.abs(L2.dw - L1.dw * 2) <= 2 && Math.abs(L2.dh - L1.dh * 2) <= 2 &&
    Math.abs(L2.left - L1.left * 2) <= 2 && Math.abs(L2.top - L1.top * 2) <= 2);

  /* ── 실제로 합성해 본다 (sharp 를 진짜로 돌린다) ── */
  /* 사진 비슷한 원본을 만든다. 단색 사각형은 PNG 가 거의 0 으로 압축돼
     "PNG 가 더 작다" 는 엉뚱한 결론이 나온다 — 실제 화보 사진과 정반대다.
     난수를 흐리게 만들면 값이 고루 퍼진 부드러운 그림이 되어 사진에 가깝다. */
  const noise = Buffer.alloc(1600 * 1000 * 3);
  let seed = 12345;
  for (let i = 0; i < noise.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise[i] = seed % 256; }
  const src = await sharp(noise, { raw: { width: 1600, height: 1000, channels: 3 } })
    .blur(6).jpeg({ quality: 92 }).toBuffer();

  const f1 = await IC.instaCompositeFile(src, null, o1);
  const m1 = await sharp(f1.buffer).metadata();
  t('기본 결과가 2160×2700', m1.width === 2160 && m1.height === 2700);

  const f2 = await IC.instaCompositeFile(src, null, o2);
  const m2 = await sharp(f2.buffer).metadata();
  t('추가 배율 2 면 4320×5400', m2.width === 4320 && m2.height === 5400);

  t('사진이 캔버스를 덮으면 JPEG 로 나간다', f2.ext === 'jpg' && f2.mime === 'image/jpeg' && m2.format === 'jpeg');
  t('크로마 서브샘플링을 쓰지 않는다 (4:4:4)', (await sharp(f2.buffer).metadata()).chromaSubsampling === '4:4:4');

  /* 핵심: 4배 픽셀인데 용량이 종전 PNG 보다 작아야 한다. 아니면 업로드가 상한을 넘는다. */
  /* 종전 규격(1080×1350 PNG)과 비교한다 — 지금 기준은 2160 이므로 직접 만든다. */
  const o1080 = Object.assign({}, o1, { W: 1080, H: 1350 });
  const png1080 = await IC.instaCompositeBuffer(src, null, o1080);
  t('2160 JPEG 가 종전 1080 PNG 보다 가볍다',
    f1.buffer.length < png1080.length,
    '2160 jpg=' + f1.buffer.length + 'B / 1080 png=' + png1080.length + 'B');

  /* ── 투명 가장자리가 생기는 경우엔 PNG 유지 ── */
  const shrunk = IC.resolveInstaOpts({ perImage: { 'https://x/a.jpg': { imgScale: 60 } } }, 'https://x/a.jpg', 2);
  const L3 = IC.layout(1600, 1000, shrunk);
  t('축소하면 캔버스를 다 덮지 못한다', IC.coversCanvas(L3) === false);
  const f3 = await IC.instaCompositeFile(src, null, shrunk);
  const m3 = await sharp(f3.buffer).metadata();
  t('그 경우 PNG 를 유지한다 (JPEG 면 빈 자리가 검게 칠해진다)',
    f3.ext === 'png' && f3.mime === 'image/png' && m3.format === 'png' && m3.hasAlpha === true);

  /* ── 텔레그램 쪽 배선 ── */
  const fs = require('fs');
  const TG = fs.readFileSync(path.join(ROOT, 'api/_lib/telegram.js'), 'utf8');
  t('텔레그램이 배율을 넘겨준다', /resolveInstaOpts\(ed\.insta_logo_settings, url, TG_IMAGE_SCALE\)/.test(TG));
  t('추가 배율 기본값은 1 — 기준이 이미 2160 이다', /parseFloat\(process\.env\.TELEGRAM_IMAGE_SCALE \|\| '1'\)/.test(TG));
  t('확장자·MIME 을 합성 결과에서 받는다 (png 고정이 아니다)',
    /name: String\(i \+ 1\)\.padStart\(2, '0'\) \+ '\.' \+ f\.ext, mime: f\.mime/.test(TG));
  t('합성이 실패하면 원본을 그 원본의 확장자로 보낸다', /f = \{ buffer: raw, ext: ext0, mime: mimeFromExt\(ext0\) \}/.test(TG));
  t('커버는 여전히 바이트 그대로 (이미 표지 디자인 완성본)', /커버 — 바이트 그대로/.test(TG));

  t('테스트 스크립트 등록', /telegram-image-quality\.test\.js/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
