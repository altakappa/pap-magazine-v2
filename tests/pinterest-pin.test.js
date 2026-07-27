// PAP Magazine — 핀터레스트 자동 핀 크론 회귀 테스트 (2026-07-27 신설)
// 지키는 것: ① 키 없으면 조용히 스킵 ② 실행당 핀 수 상한 ③ 중복 방지 로그
// ④ 크론 등록 ⑤ 키 위생 처리 (네이버 401 사고 재발 방지)
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
const src = fs.readFileSync(path.join(__dirname, '../api/cron/pinterest-pin.js'), 'utf8');
const vercel = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');

ok('키 없으면 스킵 (배포 순서 자유)', /PINTEREST_ACCESS_TOKEN[\s\S]{0,400}미설정 — 스킵/.test(src));
ok('키 위생 처리 (공백·개행·따옴표)', src.includes('cleanCred'));
ok('실행당 핀 상한 (스팸 판정 방지)', /PINS_PER_RUN = Math\.max\(1, Math\.min\(5/.test(src));
ok('중복 방지 로그 테이블 사용', src.includes('pinterest_pin_log'));
ok('발행 에디토리얼만 대상', src.includes("eq('status', 'published')"));
ok('공식 v5 API 사용', src.includes('api.pinterest.com/v5/pins'));
ok('원문 링크 부착', src.includes("SITE + '/' + e.slug"));
ok('vercel.json 크론 등록 (매시)', vercel.includes('"/api/cron/pinterest-pin"'));
ok('실패해도 던지지 않음 (다음 실행 재시도)', /catch \(err\) \{\s*console\.warn\('\[pinterest-pin\] 실패/.test(src));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ pinterest-pin tests failed'); process.exit(1); }
console.log('✅ pinterest-pin tests passed');
