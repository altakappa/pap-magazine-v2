/*
 * pinterest-observability.test.js  (2026-08-08)
 *
 * 가드를 붙인 첫날 실측: sync-pinterest 는 ok(888ms) 로 끝났는데
 * 발행 0 · DB 마킹 0 이었다. 발행 대상은 112건이 있었다.
 * 코드를 읽어 보니 토큰 만료(401/403)를 만나면 **200 으로 조용히 끝난다** —
 * 로그로는 '돌았는데 왜 0인지' 구분할 수 없는 구조였다.
 *
 * 이 테스트가 지키는 것:
 *   1) 모든 종료 경로가 cron_runs note 에 사유를 남긴다
 *   2) 토큰 만료는 503 — 사람이 해야 하는 일(토큰 갱신)은 알림이 가야 한다
 *   3) 항목 잘못이 아닌 실패(토큰·네트워크)는 영구 마킹하지 않는다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'api/cron/sync-pinterest.js'), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

console.log('\n=== 1. 모든 종료 경로에 사유가 남는다 ===');
ok(/cronNote/.test(src), 'cronNote 를 쓴다');
ok(/미처리 에디토리얼 없음/.test(src), "'할 게 없어서 0' 이 로그에서 구분된다");
ok(/토큰 만료\/권한 오류/.test(src), "'토큰이 죽어서 0' 이 로그에서 구분된다");
ok(/핀 ' \+ pinned/.test(src), '정상 실행은 발행·스킵·남은 대기를 적는다');
ok(/네트워크오류/.test(src), '네트워크 오류 건수도 센다');
ok(/429 중단/.test(src), '레이트리밋 중단도 사유가 남는다');

console.log('\n=== 2. 토큰 만료는 조용히 넘어가지 않는다 ===');
ok(/status\(503\)/.test(src), '401/403 이면 503 으로 올린다 — 가드가 실패로 잡고 알림이 간다');
ok(!/return res\.status\(200\)\.json\(\{\s*\n?\s*pinned, skipped, authError/.test(src),
   '토큰 오류를 200 으로 돌려주던 옛 경로가 없다');

console.log('\n=== 3. 항목 잘못이 아닌 실패는 영구 마킹하지 않는다 ===');
ok(/항목은 마킹 안 함|마킹하지 않음/.test(src), '토큰 오류 시 synced_at 을 찍지 않는다 (재발행 가능)');
ok(/netErrors\+\+;\s*\n\s*continue/.test(src), '네트워크 오류는 다음 실행에 재시도된다');

console.log('\n=== 3.5 승급 대기 일시정지 스위치 ===');
ok(/PINTEREST_PUBLISH_PAUSED/.test(src), '일시정지 환경변수가 있다 (Trial 샌드박스 핀 낭비 방지)');
ok(/발행 일시정지/.test(src), '정지 상태도 note 로 로그에 남는다');
ok(/status\(200\)\.json\(\{ paused: true/.test(src), '정지는 실패가 아니라 정상 종료다 (알림 노이즈 없음)');
ok(src.indexOf('PINTEREST_PUBLISH_PAUSED') < src.indexOf('const TOKEN'),
   '정지 검사가 토큰 검사보다 먼저다 — 토큰이 없어도 정지 상태가 우선');

console.log('\n=== 4. 안전 램프는 그대로다 (스팸 정지 방지) ===');
ok(/rampBatch/.test(src) && /if \(n < 50\) return 3/.test(src), '신규 계정 워밍업 램프 유지');
ok(/429/.test(src) && /rateLimited = true/.test(src), '429 즉시 중단 유지');

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ pinterest-observability tests passed');
