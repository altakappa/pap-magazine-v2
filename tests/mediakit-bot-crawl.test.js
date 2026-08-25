// PAP Magazine — /mediakit 크롤러 429 회귀 테스트 (2026-08-25)
//
// GSC "서버 오류(5xx)" 162건의 표본이 전부 /mediakit/ko/brand_* 였다. 원인:
// 핸들러가 레이트리미터(60/분)를 봇 판별보다 먼저 태워, 구글봇이 브랜드
// 미디어킷 페이지를 한꺼번에 크롤하면 429 를 받았다. GSC 는 429 를 서버
// 오류로 분류한다(크롤 예산 감점). 봇은 로그를 안 남기므로 리미터를 태울
// 이유가 없다 — 판별을 앞으로 옮기고 봇은 즉시 302.
//
// Run with `node tests/mediakit-bot-crawl.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'mediakit.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failures.push(label); failed++; }
}

console.log('\n=== /mediakit 봇 크롤 429 방지 ===');

const iBot = src.indexOf('const uaIsBot');
const iLimit = src.indexOf('rateLimitStrict(');
ok('봇 판별(uaIsBot)이 레이트리미터보다 먼저 온다',
   iBot > -1 && iLimit > -1 && iBot < iLimit, `bot@${iBot} limit@${iLimit}`);
ok('레이트리미터는 사람 트래픽에만 걸린다 (!uaIsBot 가드)',
   /!uaIsBot && await rateLimitStrict\(/.test(src));
ok('봇은 여전히 302 리다이렉트를 받는다 (로그 미기록)',
   /if \(uaIsBot\) return res\.redirect\(302, dest\);/.test(src));
ok('봇 판별이 기존과 동일한 2중 판별(isLikelyBot + isBot)',
   /isLikelyBot\(uaEarly\) \|\| isBot\(uaEarly\)/.test(src));
ok('사람 로그 기록에 쓰는 ua 는 동일 값을 재사용한다',
   /const ua = uaEarly;/.test(src));

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log('✓ mediakit bot-crawl tests passed');
process.exit(0);
