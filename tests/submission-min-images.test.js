/**
 * 총 이미지 하한 (도메니코 2026-09-10): "어떤 화보든 총 이미지 갯수가 최소 4개 이상은 되어야 해."
 * 룩 이미지 + 추가 이미지 합계. 장르(패션/뷰티)·무료/유료와 무관한 절대 하한.
 * 서버(POST/PUT)와 폼이 같은 상수를 쓰는지, 미달을 실제로 400 TOO_FEW_IMAGES 로 막는지 본다.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const st = require(path.join(ROOT, 'api', '_lib', 'submissionType'));
let passed = 0, failed = 0;
function ok(label, cond, detail) { if (cond) { passed++; console.log('  ✓ ' + label); } else { failed++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); } }

console.log('\n=== 총 이미지 하한 (2026-09-10) ===');
ok('MIN_TOTAL_IMAGES 는 6 (2026-09-12 가이드라인 6장과 동일)', st.MIN_TOTAL_IMAGES === 6, String(st.MIN_TOTAL_IMAGES));

const post = fs.readFileSync(path.join(ROOT, 'api', 'submissions', 'index.js'), 'utf8');
const put = fs.readFileSync(path.join(ROOT, 'api', 'submissions', '[id].js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'submission.html'), 'utf8');
const landing = fs.readFileSync(path.join(ROOT, 'frontend', 'submissions.html'), 'utf8');

for (const [name, src] of [['POST index.js', post], ['PUT [id].js', put]]) {
  ok(name + ' 가 공용 상수를 가져온다', /MIN_TOTAL_IMAGES\s*\}\s*=\s*require\('\.\.\/_lib\/submissionType'\)/.test(src));
  ok(name + ' 가 lookUrls+additionalUrls < MIN_TOTAL_IMAGES 면 TOO_FEW_IMAGES 로 거부한다',
     /lookUrls\.length \+ additionalUrls\.length < MIN_TOTAL_IMAGES/.test(src) && /TOO_FEW_IMAGES/.test(src));
  ok(name + ' 하한 검사가 분류(classifySubmissionType)보다 앞에 있다',
     src.indexOf('TOO_FEW_IMAGES') < src.indexOf('classifySubmissionType(looks'));
}

ok('폼 상수 MIN_TOTAL_IMAGES = 6 (서버와 동일)', /var MIN_TOTAL_IMAGES = 6;/.test(html));
ok('폼이 4단계 검증에서 총 이미지를 센다', /_papTotalImageCount\(\);\s*if\(_audit\.blocks\.length>0 && _audit\.emptyLooks\.length===0 && _tot<MIN_TOTAL_IMAGES\)/.test(html));
ok('폼이 제출 직전에도 막는다 (단계 건너뛰기 방지)', /if\(totalAllImages<MIN_TOTAL_IMAGES\)\{/.test(html));
ok('서버 TOO_FEW_IMAGES 를 언어별 문구로 바꾼다', /code==='TOO_FEW_IMAGES'/.test(html) && /tooFewImages:\{ko:/.test(html));
ok('toastMinImages 문구가 9개 언어에 있다', (html.match(/toastMinImages:'/g) || []).length === 9);
const errBlock = html.match(/tooFewImages:\{([^\n]*)\}/);
ok('tooFewImages 오류 문구가 9개 언어에 있다', !!errBlock && ['ko','en','de','it','fr','es','ja','zh','ru'].every((l) => new RegExp("(^|,)" + l + ":'").test(errBlock[1])));
ok('룩 단계 안내(lookCreditsDesc)가 6장 하한을 9개 언어로 말한다', (html.match(/lookCreditsDesc:'[^']*6[^']*'/g) || []).length === 9);
ok('/submissions 랜딩·JSON-LD 가 6장 하한을 말한다', /6 images in total/.test(landing) && (landing.match(/At least 6 images in total/g) || []).length >= 1);

console.log('\npassed: ' + passed + '   failed: ' + failed);
if (failed) { console.log('❌ submission-min-images tests FAILED'); process.exit(1); }
console.log('✅ submission-min-images tests passed');
