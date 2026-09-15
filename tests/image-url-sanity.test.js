// PAP Magazine — 구조화 데이터 이미지 URL 위생 회귀 테스트 (2026-09-15)
//
// [왜] GSC '이미지 메타데이터 > url 입력란의 URL이 잘못되었습니다' 481페이지.
// 478페이지는 자연 해소됐고, 남은 것을 DB 전수로 뒤져 하나를 찾았다:
//   /editorial/isolation 갤러리 57번
//   https://drive.google.com/thumbnail?id=1gcr3kQVt9CDiy06Ax-w4vjvDNJiAV-S<h1 class=
// 2022년 레거시 임포트가 HTML 조각을 URL 에 붙여 넣은 값이다.
// 갤러리 필터가 "문자열이냐"만 보고 "URL 이냐"는 안 봐서 화면의 img 태그에도,
// ImageObject 스키마에도 그대로 나갔다. DB 는 정정했고, 이 테스트는
// 렌더 가드가 살아 있는지를 본다.
//
// Run with `node tests/image-url-sanity.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'seoRenderer.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

// 판별기를 파일에서 그대로 떼어내 실행한다. 규칙을 여기에 다시 적으면
// 그게 바로 "규칙 두 벌"이고, 한쪽만 고쳐진다.
const m = SRC.match(/const BAD_URL_CHARS_RE[\s\S]*?\nfunction isUsableImageUrl\(u\) \{[\s\S]*?\n\}/);
let isUsableImageUrl = null;
if (m) {
  // eslint-disable-next-line no-new-func
  isUsableImageUrl = new Function(`${m[0]}; return isUsableImageUrl;`)();
}

console.log('\n=== 판별기를 소스에서 떼어내 실제로 돌린다 ===');
ok('seoRenderer 에서 isUsableImageUrl 을 찾았다', !!isUsableImageUrl);

if (isUsableImageUrl) {
  console.log('\n--- 버려야 하는 것 ---');
  const bad = [
    ['실제 사고값 (HTML 조각이 붙은 drive URL)',
      'https://drive.google.com/thumbnail?id=1gcr3kQVt9CDiy06Ax-w4vjvDNJiAV-S<h1 class='],
    ['공백이 든 URL',              'https://x.com/a b.jpg'],
    ['data: URI (SNS 가 렌더 못 함)', 'data:image/png;base64,iVBORw0KGgo='],
    ['http (혼합 콘텐츠)',          'http://x.com/a.jpg'],
    ['프로토콜 상대',              '//x.com/a.jpg'],
    ['루트 상대경로',              '/images/a.jpg'],
    ['빈 문자열',                  ''],
    ['공백만',                     '   '],
    ['호스트에 점이 없다',          'https://localhost/a.jpg'],
    ['따옴표 주입',                'https://x.com/a.jpg"onerror=1'],
    ['문자열이 아님 (null)',        null],
    ['문자열이 아님 (숫자)',        12345],
  ];
  for (const [label, v] of bad) ok(`버린다 — ${label}`, isUsableImageUrl(v) === false, JSON.stringify(v));

  console.log('\n--- 통과시켜야 하는 것 ---');
  const good = [
    ['supabase 스토리지', 'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/uploads/1782883490406_pbkv6ny169.jpg'],
    ['자사 도메인',        'https://www.pap-magazine.com/pap-logo.png'],
    ['쿼리스트링 포함',    'https://x.co/a.jpg?w=1080&q=80'],
    ['퍼센트 인코딩',      'https://x.co/%ED%95%9C%EA%B8%80.jpg'],
    ['유튜브 썸네일',      'https://img.youtube.com/vi/aaaaaaaaaaa/maxresdefault.jpg'],
    ['앞뒤 공백은 다듬는다', '  https://x.co/a.jpg  '],
  ];
  for (const [label, v] of good) ok(`통과 — ${label}`, isUsableImageUrl(v) === true, JSON.stringify(v));
}

console.log('\n=== 배선 — 갤러리와 스키마 양쪽에 걸려 있는가 ===');
ok('갤러리 필터가 문자열 검사가 아니라 URL 검사다',
  /asArray\(record\.gallery\)\.filter\(isUsableImageUrl\)/.test(SRC));
ok('옛 문자열 검사가 남아 있지 않다',
  !/asArray\(record\.gallery\)\.filter\(u => typeof u === 'string'\)/.test(SRC));
ok('스키마 image 배열도 같은 판별기를 쓴다',
  /\[ogImage, \.\.\.gallery\]\.filter\(isUsableImageUrl\)/.test(SRC));
ok('전부 걸러져도 image 가 비지 않는다 (기본 커버 보장)',
  /_imgs\.length \? _imgs : \[DEFAULT_OG_IMAGE\]/.test(SRC));
ok('버리기만 하고 고치지 않는다 (URL 추측 복원 금지)',
  !/isUsableImageUrl[\s\S]{0,400}replace\(/.test(SRC.slice(SRC.indexOf('function isUsableImageUrl'))));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
