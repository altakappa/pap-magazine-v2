/**
 * 발행 텔레그램 전송 = 관리자 "전체 ZIP 다운로드" 내용물 (2026-09-14 도메니코)
 * "전체 ZIP 다운로드 누르면 받아지는 이미지가 그대로, 커버 포함해서 로고 이미지까지 전체 다 텔레그램으로."
 *
 *  · api/_lib/instaComposite.js 가 pap-admin.js _papInstaCompositeOne 의 좌표 규칙을 그대로 옮겼는지(순수 함수 layout)
 *  · telegram.js sendEditorialToTelegram 이 커버(바이트 그대로) + 갤러리 합성 PNG 를 **문서**로 보내는지
 *  · sharp 가 있으면 실제로 1080×1350 PNG 가 나오는지(픽셀 검사)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const IC = require('../api/_lib/instaComposite');
const tg = R('api/_lib/telegram.js');
const admin = R('frontend/pap-admin.js');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', String(d).slice(0, 300)); } }

console.log('\n=== 설정 해석 (insta_logo_settings → 옵션) ===');
const S = { global: { aspect: '4:5', padPct: 1, logoPct: 15 }, perImage: { 'https://x/a.jpg': { offsetY: 3, logoAlpha: 60, logoEnabled: false, imgScale: 120 } } };
const oa = IC.resolveInstaOpts(S, 'https://x/a.jpg');
const ob = IC.resolveInstaOpts(S, 'https://x/b.jpg');
const oz = IC.resolveInstaOpts(null, 'https://x/c.jpg');
t('perImage 가 global 을 덮는다 (offsetY 3 · alpha 60 · 로고 끔 · 120%)', oa.offsetY === 3 && oa.logoAlpha === 60 && oa.logoEnabled === false && oa.imgScale === 120 && oa.logoPct === 15);
t('perImage 없는 이미지는 global + 기본값', ob.offsetY === 0 && ob.logoAlpha === 85 && ob.logoEnabled === true && ob.imgScale === 100 && ob.padPct === 1);
t('설정 자체가 없으면 관리자 기본값 (4:5 · 15% · 1% · 85% · 켜짐)', oz.W === 1080 && oz.H === 1350 && oz.logoPct === 15 && oz.padPct === 1 && oz.logoAlpha === 85 && oz.logoEnabled === true);
t('1:1 이면 1080×1080', IC.resolveInstaOpts({ global: { aspect: '1:1' } }, 'u').H === 1080);

console.log('\n=== 좌표 규칙 = 클라이언트 캔버스 ===');
// pap-admin.js: scale = max(W/iw, H/ih) * imgScale/100; dx = (W-dw)/2 + offsetX/100*W; dy = (H-dh)/2 + offsetY/100*H
t('클라이언트 공식이 그대로 있다', /var scale = Math\.max\(W \/ iw, H \/ ih\) \* \(imgScale \/ 100\);/.test(admin) && /var dx = \(W - dw\) \/ 2 \+ \(offsetX \/ 100\) \* W;/.test(admin));
const L1 = IC.layout(1600, 2000, oz);
t('세로 4:5 원본 1600×2000 → 1080×1350 꽉 채움, 오프셋 0', L1.dw === 1080 && L1.dh === 1350 && L1.dx === 0 && L1.dy === 0 && L1.vw === 1080 && L1.vh === 1350);
const L2 = IC.layout(3000, 2000, oz);
t('가로 원본은 cover-fit 으로 좌우가 잘린다 (dx<0 → sx 만큼 extract)', L2.dh === 1350 && L2.dx < 0 && L2.sx === -L2.dx && L2.left === 0 && L2.vw === 1080);
const L3 = IC.layout(1600, 2000, Object.assign({}, oz, { offsetY: 3 }));
t('offsetY 3% → 아래로 40px(1350×0.03 반올림), 위가 비고 아래가 잘린다', L3.dy === 41 && L3.top === 41 && L3.vh === 1350 - 41);
const L4 = IC.layout(1600, 2000, Object.assign({}, oz, { imgScale: 120 }));
t('imgScale 120% → 1296×1620, 가운데 정렬로 사방 잘림', L4.dw === 1296 && L4.dh === 1620 && L4.dx === -108 && L4.dy === -135 && L4.vw === 1080 && L4.vh === 1350);

console.log('\n=== 로고: trim 안 한 원본 (클라이언트와 같은 비트맵) ===');
t('instaComposite 는 getRawLogo(원본) 를 쓰고 trim 하지 않는다', /function getRawLogo\(/.test(R('api/_lib/instaComposite.js')) && !/\.trim\(\)/.test(R('api/_lib/instaComposite.js')));
t('클라이언트도 /pap-logo-white.png 원본을 naturalWidth 비율로 그린다', /logoW \* \(logo\.naturalHeight \/ logo\.naturalWidth\)/.test(admin));

console.log('\n=== telegram.js 전송 내용물 ===');
t('sendEditorialToTelegram 이 instaComposite 를 쓴다 (brandImage 아님)', /require\('\.\/instaComposite'\)/.test(tg) && /async function sendEditorialToTelegram\(ed\)[\s\S]{0,3000}instaCompositeBuffer\(raw, logo, opts\)/.test(tg));
t('커버는 바이트 그대로 "<제목>-cover.<ext>" (로고 안 얹음)', /fileBase\(ed\.title\) \+ '-cover\.' \+ ext/.test(tg));
t('갤러리는 01.png … 순번 PNG (ZIP 과 같은 이름)', /String\(i \+ 1\)\.padStart\(2, '0'\) \+ '\.png'/.test(tg));
t('문서(document)로 전송 — 사진 재압축(1280px) 회피', /async function sendDocumentsToTelegram\(/.test(tg) && /type: 'document', media: 'attach:\/\/' \+ key/.test(tg) && /sendEditorialToTelegram\(ed\)[\s\S]{0,4000}const r = await sendDocumentsToTelegram\(files, buildCaption\(ed\)\)/.test(tg));
t('insta_logo_settings 를 이미지별로 해석한다', /resolveInstaOpts\(ed\.insta_logo_settings, url\)/.test(tg));
t('sharp 는 여전히 지연 로드 (크론 콜드스타트 보호)', /function sharp\([\s\S]{0,200}require\((['"])sharp\1\)/.test(R('api/_lib/instaComposite.js')));
t('[id].js 는 .select() 전체 행을 넘긴다 (insta_logo_settings 포함)', /\.update\(updates\)\s*\.eq\('id', id\)\s*\.select\(\)\s*\.single\(\)/.test(R('api/editorials/[id].js')));
t('module.exports 에 sendDocumentsToTelegram', /sendDocumentsToTelegram,/.test(tg.slice(tg.lastIndexOf('module.exports'))));

console.log('\n=== 인스타그램 캡션 동봉 (2026-09-14) ===');
/* 2026-09-20 — 순서가 바뀌었다: 캡션을 파일 묶음 **앞에** 보낸다. 16장 합성이 상한을 넘기면 캡션 차례가 안 왔다(사고). */
const _fnBody = tg.slice(tg.indexOf('async function sendEditorialToTelegram(ed)'), tg.indexOf('async function sendEditorialToTelegramSafe'));
t('instagram_caption 원문을 별도 텍스트로 보낸다 (비어 있으면 생략)', /const igCaption = \(ed && typeof ed\.instagram_caption === 'string'\) \? ed\.instagram_caption\.trim\(\) : '';\s*let captionSent = false;\s*if \(igCaption\) \{\s*const c = await sendTextToChatSafe\(CHAT_ID\(\), igCaption\);/.test(_fnBody));
t('캡션이 파일 묶음보다 먼저 나간다 (2026-09-20 사고 후)', _fnBody.indexOf('await sendTextToChatSafe(CHAT_ID(), igCaption)') > 0 && _fnBody.indexOf('await sendTextToChatSafe(CHAT_ID(), igCaption)') < _fnBody.indexOf('await sendDocumentsToTelegram(files'));
t('캡션 전송은 await + 결과(captionSent)를 이미지 결과에 실어 반환', /captionSent = !!\(c && c\.ok\);/.test(_fnBody) && /r\.captionSent = captionSent;\s*console\.log[^\n]*\n\s*return r;/.test(_fnBody));
t('갤러리 합성은 mapPool(3) 로 겹쳐 돌리고 순번(01.png…)은 보존', /await mapPool\(gallery, 3, async \(url, i\) =>/.test(_fnBody) && /String\(i \+ 1\)\.padStart\(2, '0'\) \+ '\.png'/.test(_fnBody));
t('sendTextToChatSafe 는 링크 미리보기 끄고 4000자 자름', /disable_web_page_preview: true/.test(tg) && /slice\(0, 4000\)/.test(tg));

console.log('\n=== 픽셀 검사 (sharp 있을 때만) ===');
(async () => {
  let sharp = null;
  try { sharp = require('sharp'); } catch (_) { console.log('  · sharp 없음 → 픽셀 검사 생략'); }
  if (sharp) {
    try {
      const src = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
      // 로고: 200×100 흰 사각형 (투명 여백 없음)
      const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
      const out = await IC.instaCompositeBuffer(src, logo, IC.resolveInstaOpts(null, 'u'));
      const m = await sharp(out).metadata();
      t('출력은 1080×1350 PNG', m.width === 1080 && m.height === 1350 && m.format === 'png', JSON.stringify(m));
      // 로고 위치: 폭 162(=1080×15%), 높이 81, 가운데, 아래 여백 13.5 → top ≈ 1350-81-14 = 1255. 그 자리 픽셀이 밝아야 한다.
      const px = await sharp(out).extract({ left: 540, top: 1290, width: 1, height: 1 }).raw().toBuffer();
      t('로고 자리(가운데 아래) 픽셀이 흰색 쪽 (알파 85% 합성)', px[0] > 200 && px[1] > 150, Array.from(px).join(','));
      const px2 = await sharp(out).extract({ left: 540, top: 600, width: 1, height: 1 }).raw().toBuffer();
      t('이미지 가운데 픽셀은 원본 색(빨강)', px2[0] > 150 && px2[1] < 80, Array.from(px2).join(','));
      const off = await IC.instaCompositeBuffer(src, logo, Object.assign(IC.resolveInstaOpts(null, 'u'), { logoEnabled: false }));
      const px3 = await sharp(off).extract({ left: 540, top: 1290, width: 1, height: 1 }).raw().toBuffer();
      t('logoEnabled=false 면 로고 없음', px3[0] > 150 && px3[1] < 80, Array.from(px3).join(','));
    } catch (e) { t('픽셀 검사 실행', false, e && e.message); }
  }
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ telegram-editorial-zip-parity FAILED'); process.exit(1); }
  console.log('✅ telegram-editorial-zip-parity passed');
})();
