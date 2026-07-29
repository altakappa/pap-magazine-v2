/**
 * 서브미션 이미지 총량 상한 회귀 테스트 (2026-07-29)
 *
 * 왜 이 테스트가 필요한가 — 실제로 난 사고:
 *   서버(api/submissions/upload-url.js)는 룩+추가 **합계** 30장을 상한으로 봤는데,
 *   클라이언트(frontend/submission.html)는 추가 이미지(files1)만 세고 있었다.
 *   그래서 룩 25장 + 추가 10장 = 35장이면 UI 는 전부 받아주고 서버가 400 으로
 *   통째로 거부했다. 게다가 그 400 에는 code 도 로그도 없어서 회원에게는
 *   "제출 실패"만 떴고, 서버 로그로도 원인을 알 수 없었다.
 *   (다나에 알라르콘 — 17분간 8회 재시도, 스토리지에 파일 0개)
 *
 * 이 테스트가 강제하는 것:
 *   1) 서버 MAX_FILES == 클라이언트 MAX_TOTAL_IMAGES  ← 어긋나면 같은 사고 재발
 *   2) 클라이언트가 '합계'로 센다 (files1 단독 카운트 금지)
 *   3) 제출 전 상한 검사가 있다 (하한 <1 만 보던 시절로 회귀 금지)
 *   4) 400 3종에 code 와 서버 로그가 붙어 있다
 *   5) 회원 대면 문구가 9개 언어 전부 있다
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = fs.readFileSync(path.join(ROOT, 'api/submissions/upload-url.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/submission.html'), 'utf8');

const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('=== ' + t + ' ==='); }

// ── 1. 상한값이 서버·클라이언트에서 같은가 (핵심) ────────────────────
section('서버·클라이언트 상한 동기화');

const serverMax = (API.match(/const MAX_FILES\s*=\s*(\d+)/) || [])[1];
const clientMax = (HTML.match(/var MAX_TOTAL_IMAGES\s*=\s*(\d+)/) || [])[1];

ok('서버에 MAX_FILES 상수가 있다', !!serverMax);
ok('클라이언트에 MAX_TOTAL_IMAGES 상수가 있다', !!clientMax);
ok('두 상한이 정확히 같다 (' + serverMax + ' == ' + clientMax + ')', serverMax === clientMax);

// ── 2. 클라이언트가 '합계'로 세는가 ──────────────────────────────────
section('클라이언트 총량 카운트');

ok('_papTotalImageCount() 헬퍼가 있다', /function _papTotalImageCount\s*\(/.test(HTML));
ok('헬퍼가 룩 이미지를 센다', /_papTotalImageCount[\s\S]{0,400}lookFiles/.test(HTML));
ok('헬퍼가 추가 이미지를 센다', /_papTotalImageCount[\s\S]{0,400}files1/.test(HTML));
ok('헬퍼가 수정모드의 유지 이미지도 센다',
  /_papTotalImageCount[\s\S]{0,500}existingLookUrls/.test(HTML) &&
  /_papTotalImageCount[\s\S]{0,600}existingAdditionalUrls/.test(HTML));

// 사고의 원형: files1 단독으로 상한을 비교하던 코드가 되살아나면 안 된다.
ok('files1 단독으로 상한을 비교하지 않는다 (회귀 금지)',
  !/files1\.length\s*\+\s*queue\.length\s*>=\s*maxFiles/.test(HTML));
ok('룩 업로드도 총량 상한을 검사한다',
  /_papTotalImageCount\(\)\s*\+\s*queue\.length\s*>=\s*MAX_TOTAL_IMAGES/.test(HTML));

// ── 3. 제출 전 상한 검사 ─────────────────────────────────────────────
section('제출 전 상한 검사');

ok('totalAllImages 를 상한과 비교한다', /totalAllImages\s*>\s*MAX_TOTAL_IMAGES/.test(HTML));
ok('하한(<1) 검사도 그대로 살아 있다', /totalAllImages\s*<\s*1/.test(HTML));
ok('초과 시 몇 장 줄여야 하는지 알려준다', /tooManyImages[\s\S]{0,200}over\s*:/.test(HTML));
ok('잔여 장수 안내 UI 가 있다', /id="imageQuotaNotice"/.test(HTML));
ok('잔여 안내를 갱신하는 함수가 있다', /function _papRenderImageQuota\s*\(/.test(HTML));

// ── 4. 서버 400 에 code + 로그가 붙어 있는가 ─────────────────────────
section('서버 400 진단 가능성');

[
  ['too_many_files', '장수 초과'],
  ['unsupported_type', '형식 불가'],
  ['file_too_large', '용량 초과'],
].forEach(function (pair) {
  const code = pair[0];
  ok(pair[1] + ' 400 에 code=' + code + ' 가 있다',
    new RegExp("code:\\s*'" + code + "'").test(API));
});

// 로그가 없으면 다음 사고 때도 "400 만 남고 이유는 모름" 이 반복된다.
const errLogs = (API.match(/console\.error\('\[upload-url\] rejected:/g) || []).length;
ok('거부 사유가 서버 로그에 남는다 (' + errLogs + '건)', errLogs >= 4);

ok('장수 초과 응답이 실제 개수와 상한을 함께 준다',
  /count:\s*files\.length/.test(API) && /max:\s*MAX_FILES/.test(API));

// ── 5. 회원 대면 문구 9개 언어 ───────────────────────────────────────
section('회원 대면 문구 9개 언어');

['tooManyImages', 'imgQuotaLeft', 'unsupportedType', 'fileTooLarge'].forEach(function (key) {
  const m = HTML.match(new RegExp('\\b' + key + ':\\{([\\s\\S]*?)\\},\\n'));
  if (!m) { ok(key + ' 사전이 있다', false); return; }
  const body = ',' + m[1];
  const missing = LANGS.filter(function (l) {
    return !new RegExp('[{,]' + l + ":'").test(body);
  });
  ok(key + ' — 9개 언어 (' + (9 - missing.length) + '/9)' +
    (missing.length ? ' 누락:' + missing.join(',') : ''), missing.length === 0);
});

// ── 6. 프론트가 서버 code 를 실제로 매핑하는가 ───────────────────────
section('서버 code → 언어별 문구 매핑');

ok('_localizeApiError 가 too_many_files 를 처리', /code===\s*'too_many_files'/.test(HTML));
ok('_localizeApiError 가 unsupported_type 를 처리', /code===\s*'unsupported_type'/.test(HTML));
ok('_localizeApiError 가 file_too_large 를 처리', /code===\s*'file_too_large'/.test(HTML));

console.log('');
console.log('passed: ' + passed + '   failed: ' + failed);
if (failed > 0) {
  console.error('❌ submission-image-cap tests failed');
  process.exit(1);
}
console.log('✅ submission-image-cap tests passed');
