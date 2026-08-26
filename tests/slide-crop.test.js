/**
 * 브리프 슬라이드 비율 통일 — 가로 사진을 세로 판형으로 채워 자른다 (2026-08-26 신설)
 *
 * 도메니코: "가로형 이미지는 확대를해서 다른 세로형 이미지들과 같게 잘라줘.
 *            다만 인물(셀럽)은 절대 잘리면안돼"
 *
 * 무엇이 잘못돼 있었나 — 커버(0번)만 판형에 맞춰 그리고 **나머지 슬라이드는
 * 원본 그대로** 보냈다. 한 캐러셀에 4:5 와 16:9 가 섞이면 인스타가 첫 장
 * 기준으로 맞추면서 가로 사진의 위아래가 잘리거나 검은 띠가 생긴다.
 *
 * 여기서 지키는 것:
 *   ① 사진이 판형과 **정확히 같은 픽셀 크기**로 나온다 (여백 없이 채운다)
 *   ② 이미 같은 비율이면 **다시 인코딩하지 않는다** (화질을 깎지 않는다)
 *   ③ 크롭 창이 인물 쪽으로 이동한다 (가운데 고정이면 가장자리 인물이 날아간다)
 *   ④ EXIF 회전을 반영한다 (세로 사진을 가로로 오판하면 엉뚱하게 자른다)
 *   ⑤ 실패해도 **원본을 돌려준다** — 사진이 사라지는 것보다 낫다
 *   ⑥ 많이 잘린 컷은 번호로 지목한다 ← attention 은 얼굴 인식이 아니다.
 *      "안 잘린다"고 장담하는 대신 사람이 봐야 할 컷을 알린다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const sc = require(path.join(ROOT, 'api', '_lib', 'slideCrop.js'));
const CRON = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-brief.js'), 'utf8');
const THUMB = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'celebThumb.js'), 'utf8');

/** 단색 배경 + 한쪽에 '인물 대역'(채도 높은 살색 덩어리) 을 둔 사진을 만든다. */
async function makePhoto(w, h, blob) {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 20, b: 22 } } });
  if (blob) {
    const patch = await sharp({
      create: { width: blob.w, height: blob.h, channels: 3, background: { r: 232, g: 180, b: 148 } },
    }).jpeg().toBuffer();
    img = sharp(await img.jpeg().toBuffer()).composite([{ input: patch, left: blob.x, top: blob.y }]);
  }
  return img.jpeg({ quality: 95 }).toBuffer();
}
async function dims(buf) { const m = await sharp(buf).metadata(); return m.width + 'x' + m.height; }
/** 살색 덩어리가 결과에 얼마나 남았나 — 밝은 픽셀 비율로 잰다. */
async function skinShare(buf) {
  const { data, info } = await sharp(buf).resize(60, 75, { fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  let hit = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    n++;
    if (data[i] > 150 && data[i + 1] > 110 && data[i + 2] > 80) hit++;
  }
  return n ? hit / n : 0;
}

(async () => {
  console.log('[1] 판형 픽셀 크기로 정확히 나온다');
  const wide = await makePhoto(1920, 1080, null);
  const rFeed = await sc.cropSlideToVariant(wide, 'feed');
  t('16:9 → feed 는 1080x1350', (await dims(rFeed.buffer)) === '1080x1350', await dims(rFeed.buffer));
  t('잘랐다고 표시된다', rFeed.changed === true);
  const rReels = await sc.cropSlideToVariant(wide, 'reels');
  t('16:9 → reels 는 1080x1920', (await dims(rReels.buffer)) === '1080x1920', await dims(rReels.buffer));
  const tall = await makePhoto(720, 1280, null);      // 9:16
  const rTall = await sc.cropSlideToVariant(tall, 'feed');
  t('9:16 → feed 는 1080x1350', (await dims(rTall.buffer)) === '1080x1350', await dims(rTall.buffer));
  const sq = await makePhoto(1000, 1000, null);
  t('1:1 → reels 는 1080x1920',
    (await dims((await sc.cropSlideToVariant(sq, 'reels')).buffer)) === '1080x1920');
  t('작은 원본도 확대해서 채운다 (여백을 두지 않는다)',
    (await dims((await sc.cropSlideToVariant(await makePhoto(400, 225, null), 'feed')).buffer)) === '1080x1350');

  console.log('\n[2] 이미 같은 비율이면 건드리지 않는다 (화질 보존)');
  const already = await makePhoto(1080, 1350, null);
  const rSame = await sc.cropSlideToVariant(already, 'feed');
  t('changed 가 false', rSame.changed === false, rSame.reason);
  t('버퍼가 원본 그대로다', rSame.buffer === already);
  t('이유가 남는다', /이미 같은 비율/.test(rSame.reason || ''), rSame.reason);
  const already916 = await makePhoto(720, 1280, null);
  t('9:16 원본을 reels 로 보내면 그대로', (await sc.cropSlideToVariant(already916, 'reels')).changed === false);
  t('허용 오차 안이면 그대로 (1081x1350)',
    (await sc.cropSlideToVariant(await makePhoto(1081, 1350, null), 'feed')).changed === false);

  console.log('\n[3] 크롭 창이 인물 쪽으로 간다 (가운데 고정이면 날아간다)');
  /* 1920x1080 가로 사진의 **맨 왼쪽**에만 인물 대역을 둔다.
     가운데 크롭이면 이 덩어리는 통째로 사라진다. */
  const leftPerson = await makePhoto(1920, 1080, { x: 20, y: 140, w: 380, h: 800 });
  const centreCrop = await sharp(leftPerson)
    .resize(1080, 1350, { fit: 'cover', position: 'centre' }).jpeg().toBuffer();
  const ours = (await sc.cropSlideToVariant(leftPerson, 'feed')).buffer;
  const sCentre = await skinShare(centreCrop);
  const sOurs = await skinShare(ours);
  t('가운데 크롭은 왼쪽 인물을 거의 잃는다 (대조군)', sCentre < 0.05, sCentre.toFixed(3));
  t('우리 크롭은 인물을 남긴다', sOurs > 0.15, 'ours=' + sOurs.toFixed(3) + ' centre=' + sCentre.toFixed(3));
  t('우리 크롭이 가운데 크롭보다 인물을 많이 남긴다', sOurs > sCentre * 3,
    'ours=' + sOurs.toFixed(3) + ' centre=' + sCentre.toFixed(3));
  const rightPerson = await makePhoto(1920, 1080, { x: 1520, y: 140, w: 380, h: 800 });
  t('오른쪽 끝 인물도 남긴다',
    (await skinShare((await sc.cropSlideToVariant(rightPerson, 'feed')).buffer)) > 0.15);

  console.log('\n[4] 많이 잘린 컷은 지목한다 (attention 은 얼굴 인식이 아니다)');
  t('16:9 → 9:16 은 31.6% 만 남는다', Math.abs(sc.keptFraction(16 / 9, 9 / 16) - 0.3164) < 0.001,
    sc.keptFraction(16 / 9, 9 / 16));
  t('그건 severe 로 표시된다', (await sc.cropSlideToVariant(wide, 'reels')).severe === true);
  t('4:5 → 9:16 은 70.3% — severe 아님',
    (await sc.cropSlideToVariant(await makePhoto(1080, 1350, null), 'reels')).severe === false);
  t('16:9 → 4:5 도 severe (44.4%)', rFeed.severe === true, rFeed.kept);
  t('경계값이 0.6', sc.SEVERE_KEEP === 0.6);
  t('원본 크기가 기록된다', rFeed.from === '1920x1080', rFeed.from);

  console.log('\n[5] EXIF 회전을 반영한다');
  /* orientation 6 = 시계 90도 회전해야 바로 보이는 사진. 픽셀은 1080x1350
     이지만 화면에서는 1350x1080(가로)이다. 이걸 놓치면 "이미 4:5"로 오판한다. */
  const exif = await sharp(await makePhoto(1080, 1350, null))
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rExif = await sc.cropSlideToVariant(exif, 'feed');
  t('회전을 보고 가로로 판정한다 (그대로 통과시키지 않는다)', rExif.changed === true, rExif.reason);
  t('결과가 판형 크기다', (await dims(rExif.buffer)) === '1080x1350', await dims(rExif.buffer));

  console.log('\n[6] 실패해도 사진이 사라지지 않는다');
  const junk = Buffer.from('이건 이미지가 아니다');
  const rJunk = await sc.cropSlideToVariant(junk, 'feed');
  t('깨진 버퍼면 원본을 그대로 돌려준다', rJunk.buffer === junk && rJunk.changed === false);
  t('이유가 남는다', !!rJunk.reason, rJunk.reason);
  const rEmpty = await sc.cropSlideToVariant(Buffer.alloc(0), 'feed');
  t('빈 버퍼도 던지지 않는다', rEmpty.changed === false);
  t('모르는 판형이면 feed 로 본다',
    (await dims((await sc.cropSlideToVariant(wide, '뭔가이상함')).buffer)) === '1080x1350');

  console.log('\n[7] 판형 값이 커버 렌더러와 같다 (두 벌로 갈리지 않게)');
  t('feed 가 1080x1350', sc.TARGETS.feed.W === 1080 && sc.TARGETS.feed.H === 1350);
  t('reels 가 1080x1920', sc.TARGETS.reels.W === 1080 && sc.TARGETS.reels.H === 1920);
  t('celebThumb 도 같은 숫자를 쓴다',
    /W: 1080, H: 1350/.test(THUMB) && /W: 1080, H: 1920/.test(THUMB));

  console.log('\n[8] 배선 — 브리프와 실제 게시가 같은 그림이어야 한다');
  t('브리프 조립에서 자른다', /slideCrop\.cropSlideToVariant\(f\.buffer, variant\)/.test(CRON));
  t('게시 업로드에서도 자른다', /cropSlideToVariant\(b, pub\.variant\)/.test(CRON));
  t('게시가 자른 결과를 올린다 (원본 b 를 올리지 않는다)',
    /uploadPublic\(cropped\.buffer,/.test(CRON) && !/uploadPublic\(b, base/.test(CRON));
  t('많이 잘린 컷 번호를 모은다', /severeSlides\.push\(media\.length \+ 1\)/.test(CRON));
  t('경고가 **캡션**에 실린다 (크론 노트만으로는 도메니코가 못 본다)',
    /severeSlides\.length[\s\S]{0,200}인물이 잘리지 않았는지/.test(CRON));
  t('크론 노트에도 남는다', /많이 잘린 컷/.test(CRON));
  t('영상은 자르지 않는다 (Vercel 에 ffmpeg 가 없다 — 사진만 대상)',
    /if \(f\.type !== 'video'\)[\s\S]{0,400}cropSlideToVariant/.test(CRON));

  console.log('\n' + (fail ? '✗' : '✓') + ' slide-crop: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트가 던졌다:', e); process.exit(1); });
