// PAP Magazine — "읽혔으나 0건" 을 성공으로 센 구멍 (2026-09-21)
//
// [무슨 일] celeb-account-watch 노트가 매일 "기준선 130건" 을 찍고 있었다.
// 기준선은 계정당 딱 한 번만 나와야 하는 숫자다. 등록 계정이 98개인데
// 하루 130건이 나오면 누군가 매번 다시 기준선을 잡고 있다는 뜻이다.
//
// [원인] 개인(비프로페셔널) 인스타 계정은 Graph business_discovery 로
// 읽히긴 하는데 게시물이 0건으로 온다. 그러면 이렇게 됐다:
//   · out.polled++          → 성공으로 세어진다
//   · last_error = null     → 증거가 지워진다
//   · items.length === 0    → baseline_done 이 **영영 안 켜진다**
//   · out.baselined++       → 매 순번마다 '기준선' 으로 다시 세어진다
// 결과: 그 계정들은 9일 동안 단 한 번도 감시 단계에 들어가지 못했다.
//
// [산수로 검증] baseline_done=false 인 인스타 계정 9개 × (하루 72실행 ×
// 20개 폴링 ÷ 98계정 = 계정당 14.7회) = 예측 132건/일. 실제 노트 130건/일.
//
// [교훈] "돌았다 ≠ 했다" 의 한 겹 안쪽. **읽혔다 ≠ 읽어왔다.**
// 빈 결과를 성공으로 세면 감시가 영원히 정상으로 보인다.
//
// Run with `node tests/celeb-watch-empty-poll.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-account-watch.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 빈 결과를 따로 세는가 ===');
ok('empty 카운터가 있다', /out = \{[^}]*empty: 0/.test(SRC));
ok('어느 계정이 비었는지 이름을 모은다', /emptyNames/.test(SRC));
ok('0건이면 기준선 분기에 들어가기 전에 빠진다',
  SRC.indexOf('if (!items.length) {') < SRC.indexOf('if (!acc.baseline_done) {'),
  '순서가 뒤집히면 다시 기준선으로 센다');
ok('0건일 때 out.empty 를 올린다', /if \(!items\.length\) \{[\s\S]{0,300}out\.empty\+\+/.test(SRC));
ok('0건일 때 continue 한다 (아래 판정·알림으로 안 내려간다)',
  /if \(!items\.length\) \{[\s\S]{0,400}continue;/.test(SRC));

console.log('\n=== 기준선이 다시는 반복되지 않는가 ===');
{
  const m = SRC.match(/if \(!acc\.baseline_done\) \{[\s\S]*?\n    \}/);
  ok('기준선 분기를 찾았다', !!m);
  if (m) {
    const body = m[0];
    /* 예전 코드: `if (!dry && items.length)` — items 가 0 이면 baseline_done 을
       안 켜면서 out.baselined++ 는 했다. 그게 130건/일의 정체다.
       이제 0건은 위에서 걸러지므로 이 분기는 items.length 를 다시 볼 필요가 없다. */
    ok('기준선 분기가 items.length 로 게이트하지 않는다 (위에서 이미 걸렀다)',
      !/!dry && items\.length/.test(body), body.slice(0, 160));
    ok('baseline_done 을 켠다', /baseline_done: true/.test(body));
    ok('seen 을 채운다', /celeb_account_seen/.test(body));
    ok('baselined 를 올린다', /out\.baselined\+\+/.test(body));
    ok('baselined 증가가 baseline_done 기록 뒤에 온다',
      body.indexOf('baseline_done: true') < body.indexOf('out.baselined++'));
  }
}

console.log('\n=== 증거를 지우지 않는가 ===');
ok('last_error 를 무조건 null 로 덮지 않는다',
  !/last_polled_at: new Date\(\)\.toISOString\(\), last_error: null,/.test(SRC));
ok('0건이면 사유를 남긴다', /const emptyWhy = media\.length \? null/.test(SRC));
ok('사유에 왜 0건인지가 적혀 있다 (사람이 읽고 판단할 수 있게)',
  /개인\(비프로페셔널\) 계정이면 Graph API 로 못 읽는다/.test(SRC));
ok('정상일 때는 여전히 last_error 를 지운다 (낡은 오류가 남지 않게)',
  /media\.length \? null/.test(SRC));

console.log('\n=== 노트에 드러나는가 ===');
ok('노트에 "읽혔으나 0건" 이 나온다', /읽혔으나 0건 ' \+ out\.empty/.test(SRC));
ok('경고 표시가 붙는다 (기준선에 섞여 정상으로 보이면 안 된다)',
  /⚠️ 읽혔으나 0건/.test(SRC));
ok('어느 계정인지 노트에 적는다', /out\.emptyNames\.join/.test(SRC));
ok('0건이 없으면 노트가 지저분해지지 않는다 (조건부 출력)',
  /out\.empty \? ' · ⚠️ 읽혔으나 0건/.test(SRC));

console.log('\n=== 사람의 결정을 코드가 가로채지 않는가 ===');
ok('0건이라고 자동으로 비활성화하지 않는다 (도메니코가 필수로 지정한 계정이다)',
  !/if \(!items\.length\)[\s\S]{0,600}enabled: false/.test(SRC));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
