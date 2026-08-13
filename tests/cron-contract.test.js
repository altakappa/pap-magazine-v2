/**
 * 2026-08-13 — 크론이 지켜야 할 두 가지 계약.
 *
 * ■ 왜 필요한가 (둘 다 이 저장소에서 이미 터진 사고다)
 *
 *   1) res.locals 를 만들지 않고 res.locals.cronNote 에 쓴다
 *      Vercel 서버리스의 res 에는 locals 가 없다. cronGuard 는 읽을 때만
 *      방어(res.locals && ...)하므로, 쓰는 쪽이 공책을 먼저 만들어야 한다.
 *      없으면 크론이 **할 일을 다 끝낸 직후 마지막 줄에서** 넘어진다.
 *
 *      실측(2026-08-13): submission-authorization-sweep 이 6번 실행, 6번 전부
 *      'Cannot set properties of undefined (setting cronNote)' 로 500.
 *      보이드도 텔레그램도 이미 끝난 뒤라 돈은 안전했지만, 매번 거짓 실패
 *      알림이 나갔고 cron_runs 는 전부 빨간색이었다. 거짓 경보가 쌓이면
 *      진짜 고장을 아무도 안 믿는다 — cronGuard 의 존재 이유가 뒤집힌다.
 *
 *      pipeline-watch.js 주석 두 곳(228·836줄)이 같은 계열의 사고를 이미
 *      기록하고 있다. 세 번째다. 사람 주의력으로 막을 일이 아니다.
 *
 *   2) 돈을 건드리는 크론에 CRON_SECRET 검사가 없다
 *      /api/cron/* 은 공개 URL 이다. 예약 실행만 허용하려면 핸들러가 직접
 *      Bearer 를 봐야 한다. 결제·삭제·해지를 하는 크론이 열려 있으면
 *      무제한 호출로 외부 API 레이트리밋·함수 비용·알림 도배가 가능하다.
 *
 * ■ 이 테스트는 소스를 직접 읽는다
 *   런타임으로 세우려면 supabase·PayPal·텔레그램을 전부 스텁해야 하는데,
 *   정작 문제인 "한 줄이 없다" 는 스텁으로 증명되지 않는다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

/** 주석을 걷어낸 '실제 코드'만 본다 — 주석 속 언급이 통과로 잡히면 안 된다. */
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'api'), []);

console.log('=== 1. cronNote 를 쓰는 곳은 공책을 먼저 만든다 ===');
{
  const offenders = [];
  let writers = 0;
  for (const f of files) {
    const code = codeOf(fs.readFileSync(f, 'utf8'));
    // cronGuard 자신은 '읽는' 쪽이라 제외한다.
    if (f.endsWith(path.join('_lib', 'cronGuard.js'))) continue;
    if (!/res\.locals\.cronNote\s*=/.test(code)) continue;
    writers += 1;
    if (!/res\.locals\s*=\s*res\.locals\s*\|\|/.test(code)) {
      offenders.push(path.relative(ROOT, f));
    }
  }
  ok('cronNote 를 쓰는 파일이 하나 이상 잡힌다 (' + writers + '개)', writers > 0,
    '0 이면 이 테스트가 아무것도 안 보고 있다는 뜻이다 — 정규식이 낡았다');
  ok('공책(res.locals) 을 안 만들고 쓰는 파일이 0개다', offenders.length === 0,
    '빠진 파일: ' + offenders.join(', ')
      + '\n        핸들러 맨 앞에 `res.locals = res.locals || {};` 한 줄을 넣어라.'
      + '\n        없으면 크론이 할 일을 다 끝낸 뒤 마지막 줄에서 500 으로 죽는다.');
}

console.log('=== 2. 돈·삭제를 건드리는 크론은 예약 실행만 허용한다 ===');
{
  // 실수로 열린 채 나가면 곧바로 외부에서 부를 수 있는 것들.
  const MUST_GUARD = [
    'api/cron/submission-authorization-sweep.js', // PayPal 보이드
    'api/cron/subscription-expiry-sweep.js',      // 구독 강등
    'api/cron/withdraw-purge.js',                 // 계정 삭제
    'api/cron/purge-rejected-submissions.js',     // 서브미션 삭제
    'api/cron/send-due-campaigns.js',             // 대량 메일 발송
    'api/cron/trial-ending-reminder.js',          // 대량 메일 발송
  ];
  for (const rel of MUST_GUARD) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { ok(rel + ' 가 존재한다', false, '파일이 사라졌다 — 목록을 고쳐라'); continue; }
    const code = codeOf(fs.readFileSync(abs, 'utf8'));
    const usesSecret = /process\.env\.CRON_SECRET/.test(code);
    const rejects = /status\(401\)/.test(code);
    ok(rel + ' 가 CRON_SECRET 으로 막혀 있다', usesSecret && rejects,
      'secret 참조=' + usesSecret + ' 401 반환=' + rejects
        + '\n        /api/cron/* 는 공개 URL 이다. 핸들러가 직접 Bearer 를 봐야 한다.');
  }
}

console.log('=== 3. SLA 스윕이 실제로 SLA 를 지킨다 (회귀 방지) ===');
{
  const sweep = fs.readFileSync(path.join(ROOT, 'api/cron/submission-authorization-sweep.js'), 'utf8');
  const code = codeOf(sweep);
  ok("authorized 인 건만 훑는다",
    /\.eq\('payment_status', 'authorized'\)/.test(code),
    '이미 청구/해제된 건을 다시 건드리면 안 된다');
  ok('마감을 넘긴 건은 보이드한다',
    /voidAuthorization\(row\.paypal_authorization_id\)/.test(code));
  ok("보이드 뒤 상태가 awaiting_authorization 으로 돌아간다",
    /payment_status: 'awaiting_authorization'/.test(code),
    '이 상태여야 마이페이지에 "결제 승인 이어서 하기" 버튼이 뜬다 — 막다른 길 방지와 짝이다');
  ok('보이드 뒤 승인번호를 지운다',
    /paypal_authorization_id: null/.test(code),
    '남겨두면 다음 스윕이 죽은 승인을 또 보이드하려 든다');
  ok('알림을 await 한다 (서버리스는 응답 후 함수를 얼린다)',
    !/[^t]\s+sendTextToTelegramSafe\(/.test(code.replace(/await sendTextToTelegramSafe\(/g, 'await_ok(')),
    'await 없이 부르면 알림이 도착하지 않는다 — 6a13439 와 같은 사고');
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ cron-contract tests passed');
process.exit(0);
