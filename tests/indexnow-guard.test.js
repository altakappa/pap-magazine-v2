/*
 * indexnow-guard.test.js  (2026-08-07)
 *
 * /api/indexnow 는 매일 02:00 에 예약돼 있으면서 cron_runs 에 아무 기록을
 * 남기지 않았다. 그래서 셋을 구분할 방법이 없었다 —
 *   ① 안 도는 것  ② 돌지만 제출할 게 없는 것  ③ 제출했는데 거절당한 것
 *
 * 특히 ③ 이 위험했다. 엔드포인트가 전부 거절해도 함수는 200 과
 * "submitted: 50" 을 돌려줬다. 그 숫자는 '보낸 개수' 지 '받아준 개수' 가 아니다.
 * 네이버·빙이 키를 못 읽어 403 을 주고 있어도 겉으로는 매일 성공이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'api/indexnow.js');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

console.log('\n=== 1. 관측 가능한가 ===');
ok(/withCronGuard\(\s*'indexnow'/.test(src), "withCronGuard('indexnow') 로 감싸져 있다");
ok(/cronNote/.test(src), 'cronNote 로 결과를 로그에 남긴다');
ok(/인증 거부/.test(src), '인증에 막힌 실행도 로그에 사유가 남는다');
ok(/제출 생략/.test(src), "'제출할 게 없었다' 와 '실패' 를 로그에서 구분할 수 있다");

console.log('\n=== 2. 수락 여부를 실제로 센다 ===');
ok(/accepted/.test(src), '수락 개수(accepted)를 따로 센다');
ok(/status\s*===\s*200\s*\|\|\s*.*status\s*===\s*202/.test(src),
   'IndexNow 규격대로 200·202 만 수락으로 본다');
ok(/if \(!accepted\)/.test(src), '수락이 0이면 별도 경로를 탄다');
ok(/status\(502\)/.test(src),
   '전부 거절이면 5xx 로 올린다 — 그래야 가드가 실패로 잡고 알림이 간다');
ok(!/return res\.status\(200\)\.json\(\{\s*\n?\s*submitted: urlList\.length,\s*\n?\s*mode/.test(src),
   '수락 확인 없이 200 을 돌려주던 옛 경로가 남아있지 않다');

console.log('\n=== 3. 판정 함수가 규격대로 동작한다 ===');
/* import 만으로 env 를 요구하는 모듈(supabase 등)을 갈아끼운다.
   이 저장소는 같은 함정을 이미 겪었다 — aiCreditWatch 가 import 만으로
   env 를 요구해 CI 스위트를 통째로 죽였다(86312cf). 같은 실수 반복 금지. */
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (req) {
  if (/_lib\/supabase$/.test(req)) return { supabaseAdmin: { from: () => ({}) } };
  if (/_lib\/cronGuard$/.test(req)) return { withCronGuard: (name, h) => h };
  return _origLoad.apply(this, arguments);
};
delete require.cache[require.resolve(SRC)];
const m = require(SRC);
Module._load = _origLoad;
const A = m.epAccepted;
ok(A({ status: 200 }) === true, '200 = 수락');
ok(A({ status: 202 }) === true, '202 = 수락 (키 확인 대기)');
ok(A({ status: 403 }) === false, '403 = 거절 (키 파일을 못 읽은 경우)');
ok(A({ status: 400 }) === false, '400 = 거절');
ok(A({ status: 429 }) === false, '429 = 거절 (과다 제출)');
ok(A({ error: 'timeout' }) === false, '타임아웃 = 수락 아님');
ok(A(null) === false, 'null 이어도 터지지 않는다');

console.log('\n=== 4. 엔드포인트 라벨이 로그를 짧게 유지한다 ===');
const L = m.epLabel;
ok(L('https://searchadvisor.naver.com/indexnow') === '네이버', '네이버 라벨');
ok(L('https://www.bing.com/indexnow') === '빙', '빙 라벨');
ok(L('https://api.indexnow.org/indexnow') === 'indexnow.org', 'indexnow.org 라벨');
ok(m.ENDPOINTS.every((e) => L(e).length <= 24), '모든 엔드포인트 라벨이 24자 이하 (note 500자 상한 보호)');
ok(m.ENDPOINTS.length >= 3, `제출 엔드포인트 ${m.ENDPOINTS.length}곳`);

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ indexnow-guard tests passed');
