'use strict';
/**
 * 서브미션 TIFF 차단 (2026-09-22 도메니코 결정 "3번으로 하자").
 * MODERN TEARS 재제출 20장 중 14장이 TIFF → 스토리지엔 정상 저장됐지만 브라우저가 TIFF 를 못 그려
 * 관리자 화면·(승인 시) 공개 사이트 모두 검은 칸. 폼과 서버 양쪽에서 TIFF 를 받지 않는다.
 *
 * 서버 핸들러(api/submissions/upload-url.js)를 require 스텁으로 실제 실행해 image/tiff 가 400 unsupported_type 인지 본다.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

(async () => {
  console.log('=== 서버: upload-url 이 image/tiff 를 거부한다 (실행) ===');
  const stubs = {
    '../_lib/cors': { handleCors: () => false },
    '../_lib/rateLimit': { rateLimit: () => false, RATE_LIMITS: { upload: {} } },
    '../_lib/auth': { requireAuth: () => ({ id: 'u1' }) },
    '../_lib/supabase': { supabaseAdmin: { storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://x/put', token: 'tk', path: 'p' }, error: null }) }) } } },
  };
  const orig = Module.prototype.require;
  Module.prototype.require = function (n) { if (Object.prototype.hasOwnProperty.call(stubs, n)) return stubs[n]; return orig.apply(this, arguments); };
  let handler;
  try { delete require.cache[require.resolve('../api/submissions/upload-url.js')]; handler = require('../api/submissions/upload-url.js'); }
  finally { Module.prototype.require = orig; }
  function res() { const o = { code: 0, body: null, status(c) { o.code = c; return o; }, json(b) { o.body = b; return o; }, setHeader() {} }; return o; }
  const origErr = console.error; console.error = () => {};
  let r = res();
  await handler({ method: 'POST', headers: {}, body: { files: [{ name: 'a.tif', type: 'image/tiff', size: 1000, category: 'look' }] } }, r);
  t('image/tiff → 400 unsupported_type', r.code === 400 && r.body && r.body.code === 'unsupported_type', JSON.stringify(r.body));
  r = res();
  await handler({ method: 'POST', headers: {}, body: { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 1000, category: 'look' }, { name: 'b.png', type: 'image/png', size: 1000, category: 'look' }, { name: 'c.webp', type: 'image/webp', size: 1000, category: 'look' }] } }, r);
  t('jpeg·png·webp 는 여전히 통과 (400 아님)', r.code !== 400, 'code ' + r.code + ' ' + JSON.stringify(r.body).slice(0, 120));
  console.error = origErr;
  const src = R('api/submissions/upload-url.js');
  t('ALLOWED_MIME / MIME_TO_EXT 에 tiff 항목이 없다 (주석 제외)', !/^\s*'image\/tiff'/m.test(src));

  console.log('\n=== 폼: accept 와 클라이언트 허용 목록에서 TIFF 제거, 안내 문구 9개 언어 ===');
  const html = R('frontend/submission.html');
  t('<input accept> 두 곳에 tiff/.tif 없음', (html.match(/accept="image\/jpeg,image\/png,image\/webp,\.jpg,\.jpeg,\.png,\.webp"/g) || []).length === 2 && !/accept="[^"]*tif/.test(html));
  t("클라이언트 allowed 목록 두 곳이 ['image/jpeg','image/png','image/webp']", (html.match(/var allowed=\['image\/jpeg','image\/png','image\/webp'\]/g) || []).length === 2 && !/var allowed=\[[^\]]*tiff/.test(html));
  const line = html.split('\n').find((l) => l.includes('unsupportedType:{ko:')) || '';
  t('unsupportedType 문구 9개 언어 모두 "TIFF 를 받지 않는다" 사유 포함 (JPG·PNG·WebP 만)', (line.match(/TIFF/g) || []).length === 9 && /JPG · PNG · WebP 만 업로드할 수 있습니다\. TIFF 는 웹에서 표시되지 않아 받지 않습니다\./.test(line) && !/WebP · TIFF 만/.test(line));
  t('toastOnlyImgFmt 9개 언어에 TIFF 없음', (html.match(/toastOnlyImgFmt:'[^']*'/g) || []).length === 9 && !(html.match(/toastOnlyImgFmt:'[^']*'/g) || []).some((v) => /TIFF/.test(v)));
  t('submission 사전 data-v ≥ 10', (function () { const m = html.match(/content="submission" data-v="(\d+)"/); return m && Number(m[1]) >= 10; })());

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ submission-no-tiff FAILED'); process.exit(1); }
  console.log('✅ submission-no-tiff passed');
})();
