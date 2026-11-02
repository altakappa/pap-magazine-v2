/**
 * 발행 텔레그램 전송 = 관리자 "전체 ZIP 다운로드" 내용물 (2026-09-14 도메니코)
 * "전체 ZIP 다운로드 누르면 받아지는 이미지가 그대로, 커버 포함해서 로고 이미지까지 전체 다 텔레그램으로."
 *
 *  · api/_lib/instaComposite.js 가 pap-admin.js _papInstaCompositeOne 의 좌표 규칙을 그대로 옮겼는지(순수 함수 layout)
 *  · telegram.js sendEditorialToTelegram 이 커버(바이트 그대로) + 갤러리 합성 PNG 를 **문서**로 보내는지
 *  · sharp 가 있으면 실제로 기준 캔버스 크기의 PNG 가 나오는지(픽셀 검사)
 *    ※ 2026-11-02 기준 캔버스가 1080×1350 → 2160×2700 으로 올라갔다. 기대값을
 *      숫자로 박지 않고 resolveInstaOpts 가 돌려준 W·H 로 쓴다 — 규격이 또 바뀌어도
 *      이 시험이 지키려는 것('ZIP 과 텔레그램이 같은 규칙')은 그대로 유지되도록.
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
t('설정 자체가 없으면 관리자 기본값 (4:5 · 15% · 1% · 85% · 켜짐)', oz.W === IC.CANVAS_W && oz.H === IC.CANVAS_H_45 && oz.logoPct === 15 && oz.padPct === 1 && oz.logoAlpha === 85 && oz.logoEnabled === true);
t('1:1 이면 2160×2160 (2026-11-02 기준 상향)', IC.resolveInstaOpts({ global: { aspect: '1:1' } }, 'u').H === 2160);

console.log('\n=== 좌표 규칙 = 클라이언트 캔버스 ===');
// pap-admin.js: scale = max(W/iw, H/ih) * imgScale/100; dx = (W-dw)/2 + offsetX/100*W; dy = (H-dh)/2 + offsetY/100*H
t('클라이언트 공식이 그대로 있다', /var scale = Math\.max\(W \/ iw, H \/ ih\) \* \(imgScale \/ 100\);/.test(admin) && /var dx = \(W - dw\) \/ 2 \+ \(offsetX \/ 100\) \* W;/.test(admin));
const L1 = IC.layout(1600, 2000, oz);
t('세로 4:5 원본은 캔버스를 꽉 채우고 오프셋 0', L1.dw === oa.W && L1.dh === oa.H && L1.dx === 0 && L1.dy === 0 && L1.vw === oa.W && L1.vh === oa.H);
const L2 = IC.layout(3000, 2000, oz);
t('가로 원본은 cover-fit 으로 좌우가 잘린다 (dx<0 → sx 만큼 extract)', L2.dh === oa.H && L2.dx < 0 && L2.sx === -L2.dx && L2.left === 0 && L2.vw === oa.W);
const L3 = IC.layout(1600, 2000, Object.assign({}, oz, { offsetY: 3 }));
t('offsetY 3% → 캔버스 높이의 3% 만큼 아래로, 위가 비고 아래가 잘린다', (() => { const d = Math.round(oa.H * 0.03); return L3.dy === d && L3.top === d && L3.vh === oa.H - d; })());
const L4 = IC.layout(1600, 2000, Object.assign({}, oz, { imgScale: 120 }));
t('imgScale 120% → 1.2배, 가운데 정렬로 사방 잘림', L4.dw === Math.round(oa.W * 1.2) && L4.dh === Math.round(oa.H * 1.2) && L4.dx === Math.round((oa.W - L4.dw) / 2) && L4.dy === Math.round((oa.H - L4.dh) / 2) && L4.vw === oa.W && L4.vh === oa.H);

console.log('\n=== 로고: trim 안 한 원본 (클라이언트와 같은 비트맵) ===');
t('instaComposite 는 getRawLogo(원본) 를 쓰고 trim 하지 않는다', /function getRawLogo\(/.test(R('api/_lib/instaComposite.js')) && !/\.trim\(\)/.test(R('api/_lib/instaComposite.js')));
t('클라이언트도 /pap-logo-white.png 원본을 naturalWidth 비율로 그린다', /logoW \* \(logo\.naturalHeight \/ logo\.naturalWidth\)/.test(admin));

console.log('\n=== telegram.js 전송 내용물 ===');
t('sendEditorialToTelegram 이 instaComposite 를 쓴다 (brandImage 아님)', /require\('\.\/instaComposite'\)/.test(tg) && /async function sendEditorialToTelegram\(ed\)[\s\S]{0,3000}instaCompositeFile\(raw, logo, opts\)/.test(tg));
t('커버는 바이트 그대로 "<제목>-cover.<ext>" (로고 안 얹음)', /fileBase\(ed\.title\) \+ '-cover\.' \+ ext/.test(tg));
/* 2026-11-02 — 이름의 '순번' 은 ZIP 과 같게 유지하되, 확장자는 합성 결과가 정한다.
   텔레그램은 2배 해상도로 내보내고 사진이 캔버스를 덮으면 JPEG 다(용량·화질 모두 유리).
   덮지 못하는 경우엔 PNG 그대로 — 투명 가장자리를 지켜야 하기 때문이다. */
t('갤러리 이름은 01, 02 … 순번 유지 (확장자는 합성 결과가 정한다)', /String\(i \+ 1\)\.padStart\(2, '0'\) \+ '\.' \+ f\.ext/.test(tg));
t('문서(document)로 전송 — 사진 재압축(1280px) 회피', /async function sendDocumentsToTelegram\(/.test(tg) && /type: 'document', media: 'attach:\/\/' \+ key/.test(tg) && /sendEditorialToTelegram\(ed\)[\s\S]{0,4000}const r = await sendDocumentsToTelegram\(files, buildCaption\(ed\)\)/.test(tg));
t('insta_logo_settings 를 이미지별로 해석한다 (배율만 추가로 넘긴다)', /resolveInstaOpts\(ed\.insta_logo_settings, url, TG_IMAGE_SCALE\)/.test(tg));
t('sharp 는 여전히 지연 로드 (크론 콜드스타트 보호)', /function sharp\([\s\S]{0,200}require\((['"])sharp\1\)/.test(R('api/_lib/instaComposite.js')));
t('[id].js 는 .select() 전체 행을 넘긴다 (insta_logo_settings 포함)', /\.update\(updates\)\s*\.eq\('id', id\)\s*\.select\(\)\s*\.single\(\)/.test(R('api/editorials/[id].js')));
t('module.exports 에 sendDocumentsToTelegram', /sendDocumentsToTelegram,/.test(tg.slice(tg.lastIndexOf('module.exports'))));

console.log('\n=== 인스타그램 캡션 동봉 (2026-09-14) ===');
/* 2026-09-20 — 순서가 바뀌었다: 캡션을 파일 묶음 **앞에** 보낸다. 16장 합성이 상한을 넘기면 캡션 차례가 안 왔다(사고). */
const _fnBody = tg.slice(tg.indexOf('async function sendEditorialToTelegram(ed)'), tg.indexOf('async function sendEditorialToTelegramSafe'));
t('instagram_caption 원문을 별도 텍스트로 보낸다 (비어 있으면 생략)', /const igCaption = \(ed && typeof ed\.instagram_caption === 'string'\) \? ed\.instagram_caption\.trim\(\) : '';\s*let captionSent = false;\s*if \(igCaption\) \{\s*const c = await sendTextToChatSafe\(CHAT_ID\(\), igCaption\);/.test(_fnBody));
t('캡션이 파일 묶음보다 먼저 나간다 (2026-09-20 사고 후)', _fnBody.indexOf('await sendTextToChatSafe(CHAT_ID(), igCaption)') > 0 && _fnBody.indexOf('await sendTextToChatSafe(CHAT_ID(), igCaption)') < _fnBody.indexOf('await sendDocumentsToTelegram(files'));
t('캡션 전송은 await + 결과(captionSent)를 이미지 결과에 실어 반환', /captionSent = !!\(c && c\.ok\);/.test(_fnBody) && /r\.captionSent = captionSent;\s*console\.log[^\n]*\n\s*return r;/.test(_fnBody));
t('갤러리 합성은 mapPool(3) 로 겹쳐 돌리고 순번(01, 02…)은 보존', /await mapPool\(gallery, 3, async \(url, i\) =>/.test(_fnBody) && /String\(i \+ 1\)\.padStart\(2, '0'\) \+ '\.' \+ f\.ext/.test(_fnBody));
t('sendTextToChatSafe 는 링크 미리보기 끄고 4000자 자름', /disable_web_page_preview: true/.test(tg) && /slice\(0, 4000\)/.test(tg));

/* 2026-11-02 — 배율을 더 걸어도 '구도' 는 같아야 한다.
   이 시험의 본래 목적이 거기다. 배율을 바꿔도 비율 값이 그대로인지 직접 확인한다. */
const _p1 = IC.resolveInstaOpts(S, 'https://x/a.jpg');
const _p2 = IC.resolveInstaOpts(S, 'https://x/a.jpg', 2);
t('배율이 달라도 구도 값(logoPct·padPct·offset)은 같다',
  _p1.logoPct === _p2.logoPct && _p1.padPct === _p2.padPct &&
  _p1.offsetX === _p2.offsetX && _p1.offsetY === _p2.offsetY && _p1.imgScale === _p2.imgScale);
t('배율은 캔버스 크기에만 걸린다', _p2.W === _p1.W * 2 && _p2.H === _p1.H * 2);

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
      t('출력은 기준 캔버스 크기의 PNG', m.width === oa.W && m.height === oa.H && m.format === 'png', JSON.stringify(m));
      /* 로고 자리를 캔버스 크기에서 계산한다 — 규격이 바뀌어도 따라간다.
         폭 = W×logoPct(15%), 높이 = 폭×(로고 100/200), 가운데, 아래 여백 = H×padPct(1%). */
      const lw = Math.round(oa.W * 0.15);
      const lh = Math.round(lw * (100 / 200));
      const ltop = Math.round(oa.H - lh - oa.H * 0.01);
      const px = await sharp(out).extract({ left: Math.round(oa.W / 2), top: ltop + Math.round(lh / 2), width: 1, height: 1 }).raw().toBuffer();
      t('로고 자리(가운데 아래) 픽셀이 흰색 쪽 (알파 85% 합성)', px[0] > 200 && px[1] > 150, Array.from(px).join(','));
      const px2 = await sharp(out).extract({ left: Math.round(oa.W / 2), top: Math.round(oa.H / 2), width: 1, height: 1 }).raw().toBuffer();
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
