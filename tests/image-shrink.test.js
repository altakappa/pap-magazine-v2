/**
 * 저장 전 이미지 축소 (2026-09-14 전송량 초과 후속).
 *
 * [왜] 9/14 알림에 `exceed_egress_quota`(DB)와 `exceed_cached_egress_quota`(Storage)가
 * 같이 떴다. DB 쪽은 embedding 열을 빼서 고쳤다(12d2fff). 이 파일은 Storage 쪽이다.
 * media 버킷 실측: 48,904개 35GB 평균 758KB. 1MB 넘는 6,818개가 용량의 54.9%.
 * 독자는 54KB 만 받지만 Vercel 이 그걸 만들려고 원본 758KB 를 매번 끌어간다.
 * `/_vercel/image` 하루 16,000회 × 758KB = 하루 약 12GB.
 *
 * [이 테스트가 지키는 것] 축소가 **절대 업로드를 막지 않는다**는 것.
 * 깨진 데이터·GIF·이미 작은 파일에서 원본이 그대로 나와야 한다.
 * 여기가 뚫리면 인스타 수입과 화보 이관이 통째로 멈춘다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { shrinkImageBuffer, isShrinkable, pathForContentType, shrinkNote, MAX_DIM } =
  require(path.join(__dirname, '..', 'api', '_lib', 'imageShrink'));

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

(async () => {
  console.log('\n=== 대상 판별 ===');
  t('jpeg 는 줄인다', isShrinkable('image/jpeg'));
  t('png 도 줄인다', isShrinkable('image/png'));
  t('webp 도 줄인다', isShrinkable('image/webp'));
  t('gif 는 건드리지 않는다 (애니메이션이 깨진다)', !isShrinkable('image/gif'));
  t('svg 는 건드리지 않는다 (벡터)', !isShrinkable('image/svg+xml'));
  t('mp4 는 이미지가 아니다', !isShrinkable('video/mp4'));

  console.log('\n=== 실패해도 원본이 나온다 (가장 중요) ===');
  {
    const junk = Buffer.alloc(400 * 1024, 7);
    const r = await shrinkImageBuffer(junk, 'image/jpeg');
    t('깨진 데이터 → 원본 그대로', r.buf === junk && !r.shrunk, r.reason);
    t('깨진 데이터 → 이유를 남긴다', /sharp 실패/.test(r.reason));
  }
  {
    const r = await shrinkImageBuffer(Buffer.alloc(400 * 1024), 'image/gif');
    t('GIF → 원본 그대로', !r.shrunk);
  }
  {
    const r = await shrinkImageBuffer(null, 'image/jpeg');
    t('빈 버퍼 → 터지지 않는다', !r.shrunk && r.from === 0);
  }
  {
    const r = await shrinkImageBuffer(Buffer.alloc(10 * 1024, 1), 'image/jpeg');
    t('이미 작은 파일 → 손대지 않는다', !r.shrunk && /이미 작다/.test(r.reason));
  }

  console.log('\n=== 실제로 줄어든다 ===');
  const sharp = require('sharp');
  {
    /* 노이즈로 채운 3000x4000 사진 — 실제 화보와 비슷하게 잘 안 눌리는 그림 */
    const raw = Buffer.from(Array.from({ length: 1200 * 1600 * 3 }, () => Math.floor(Math.random() * 255)));
    const big = await sharp(raw, { raw: { width: 1200, height: 1600, channels: 3 } })
      .resize(3000, 4000).jpeg({ quality: 95 }).toBuffer();
    const r = await shrinkImageBuffer(big, 'image/jpeg');
    t('큰 사진이 줄어든다', r.shrunk, shrinkNote(r));
    t('절반 아래로 줄어든다', r.to < r.from / 2, shrinkNote(r));
    const m = await sharp(r.buf).metadata();
    t('긴 변이 ' + MAX_DIM + 'px 이하', Math.max(m.width, m.height) <= MAX_DIM, m.width + 'x' + m.height);
    t('결과는 jpeg', m.format === 'jpeg');
  }
  {
    /* 투명이 있는 큰 PNG — 로고가 검게 변하면 안 된다 */
    const raw = Buffer.from(Array.from({ length: 1500 * 1500 * 4 }, (_, i) => (i % 4 === 3 ? 128 : Math.floor(Math.random() * 255))));
    const png = await sharp(raw, { raw: { width: 1500, height: 1500, channels: 4 } })
      .resize(2600, 2600).png().toBuffer();
    const r = await shrinkImageBuffer(png, 'image/png');
    const m = await sharp(r.buf).metadata();
    t('투명 PNG 는 PNG 로 남는다 (JPEG 로 바꾸면 투명이 검게 된다)', m.format === 'png', m.format);
    t('투명 채널이 살아 있다', m.hasAlpha === true);
  }

  console.log('\n=== 경로 확장자 ===');
  t('png → jpg 로 바뀌면 경로도 따라간다', pathForContentType('a/b/0.png', 'image/jpeg') === 'a/b/0.jpg');
  t('png 유지면 경로도 png', pathForContentType('a/b/0.png', 'image/png') === 'a/b/0.png');
  t('확장자가 없으면 붙여 준다', pathForContentType('a/b/0', 'image/jpeg') === 'a/b/0.jpg');

  console.log('\n=== 실제 업로드 경로에 연결돼 있다 ===');
  {
    const ig = R('api/_lib/instagramImport.js');
    t('instagramImport 가 imageShrink 를 쓴다', /require\('\.\/imageShrink'\)/.test(ig));
    t('instagramImport 는 축소본을 올린다', /upload\(path, buf, \{ contentType: useCt/.test(ig));
    t('instagramImport 확장자가 바뀐 형식을 따른다', /useCt === 'image\/png'/.test(ig));

    const mg = R('api/cron/migrate-external-images.js');
    t('migrate-external-images 가 imageShrink 를 쓴다', /require\('\.\.\/_lib\/imageShrink'\)/.test(mg));
    t('migrate 는 상한 미만도 줄인다', /const sh = await shrinkImageBuffer\(buf, ct\)/.test(mg));
    t('migrate 가 절감량을 크론 노트에 남긴다', /bytesSaved \/ 1048576/.test(mg));
  }

  console.log('\n=== 왜 했는지 파일에 적혀 있다 ===');
  {
    const lib = R('api/_lib/imageShrink.js');
    t('사고 날짜가 있다', lib.includes('2026-09-14'));
    t('실측 숫자가 있다', lib.includes('48,904') && lib.includes('4.8배'));
    t('실패해도 원본을 쓴다는 규칙이 적혀 있다', /원본을 그대로 돌려준다/.test(lib));
  }

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ image-shrink tests FAILED'); process.exit(1); }
  console.log('✅ image-shrink tests passed');
})().catch((e) => { console.error('❌ image-shrink tests CRASHED', e); process.exit(1); });
