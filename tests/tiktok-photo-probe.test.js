// PAP Magazine — 틱톡 에디토리얼 게시 실패 시 "어느 사진이 왜" 를 남긴다 (2026-09-21)
//
// [무슨 일] 9/15~9/20 에디토리얼 틱톡 게시가 6일 중 6일
// "Image could not be read from its URL" 로 실패했다. 원인을 못 찾았다.
//   · Vercel 런타임 로그는 1시간만 남는다 → 다음 날엔 이미 없다
//   · 우리 셸에서는 사이트 접속이 막혀 재현이 안 된다
//   · 원본 파일 크기·형식·버킷은 성공한 편과 차이가 없었다
// 증거가 남는 유일한 순간은 실패한 바로 그때다. 그래서 그때 잰다.
//
// Run with `node tests/tiktok-photo-probe.test.js` (npm test 에 연결).
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'tiktok-post.js'), 'utf8');

let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { console.log('  ✓ ' + l); passed++; } else { console.log('  ✗ ' + l + (d ? ' — ' + d : '')); failed++; } }

console.log('\n=== 점검 함수 ===');
ok('probePhotos 가 있다', /async function probePhotos\(urls\)/.test(SRC));
ok('사진마다 제한시간이 있다 (크론 60초 예산을 못 먹게)', /AbortSignal\.timeout\(8000\)/.test(SRC));
ok('병렬로 잰다 (10장 직렬이면 80초까지 간다)', /Promise\.all\(urls\.map\(one\)\)/.test(SRC));
ok('상태코드·콘텐츠타입·크기·시간을 남긴다', /r\.status \+ ':' \+ ct \+ ':' \+ Math\.round\(buf\.byteLength \/ 1024\)/.test(SRC));
ok('타임아웃을 따로 이름 붙인다', /TimeoutError' \) \? 'timeout'|TimeoutError'\) \? 'timeout'/.test(SRC));
ok('전부 정상이면 그렇다고 적는다 (우리 쪽 문제가 아님을 증명)', /전부 정상\(=우리 쪽 문제 아님/.test(SRC));

console.log('\n--- 판정식을 실제로 돌린다 ---');
{
  const m = SRC.match(/const bad = rows\.filter\(\(x\) => !(\/.*?\/)\.test\(x\)\);/);
  ok('정상 판정식을 찾았다', !!m);
  if (m) {
    // eslint-disable-next-line no-new-func
    const re = new Function('return ' + m[1])();
    ok('200 + image/jpeg 는 정상', re.test('1:200:image/jpeg:120KB:300ms'));
    ok('200 + text/html 은 이상 (에러 페이지가 200 으로 오는 경우)', !re.test('2:200:text/html:3KB:90ms'));
    ok('502 는 이상', !re.test('3:502:image/jpeg:0KB:10ms'));
    ok('타임아웃은 이상', !re.test('4:ERR:timeout:8001ms'));
  }
}

console.log('\n=== 실패 경로에만 붙는다 ===');
ok('"could not be read" 일 때만 점검한다 (다른 거부엔 불필요한 호출 안 함)', /if \(\/could not be read\/i\.test\(detail\)\)/.test(SRC));
ok('점검이 터져도 원래 실패 사유는 남는다', /catch \(pe\) \{ detail \+= ' \|\| 사진점검 실패/.test(SRC));
ok('detail 길이를 자른다', /detail = detail\.slice\(0, 900\)/.test(SRC));
ok('점검은 성공 경로에 없다 (정상 게시에 비용 0)', !/detail = 'buffer:'[^\n]*probePhotos/.test(SRC));
ok('게시 판단을 바꾸지 않는다 (status 는 여전히 failed)',
  /status = 'failed';\s*\n\s*detail = String\(err/.test(SRC));

console.log('\n' + (failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음') + ' — 통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed === 0 ? 0 : 1);
