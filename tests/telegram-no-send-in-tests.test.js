'use strict';
/**
 * 테스트가 운영 텔레그램 알림을 쏘지 못하게 막는다 (2026-09-23).
 *
 * [무슨 일] submission-no-tiff 테스트의 supabaseAdmin 스텁에 getPublicUrl 이 빠져 있었다.
 * 통과 케이스(jpeg·png·webp)가 TypeError 로 catch 에 떨어졌고, 그 catch 의 운영 알림이
 * 진짜 그룹방으로 나갔다 — "🚨 업로드URL 발급 실패 … getPublicUrl is not a function" 2건.
 * 게다가 그 단언은 "400 이 아니다" 여서 500 도 통과였다. 테스트는 초록불, 방은 빨간불.
 *
 * [막는 것] 알림 함수가 tests/*.test.js 진입점에서 돌 때는 전송하지 않고 skipped 를 돌려준다.
 * env 에 봇 토큰이 들어 있는 기계에서 npm test 를 돌려도 방이 울리지 않는다.
 */
const path = require('path');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

(async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '-100';
  process.env.TELEGRAM_PERSONAL_CHAT_ID = '-200';

  let fetched = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { fetched++; throw new Error('테스트에서 실제 전송 시도'); };

  const tg = require('../api/_lib/telegram');
  try {
    t('inTestRun() 이 tests/*.test.js 진입점을 알아본다', tg.inTestRun() === true);

    const a = await tg.sendTextToTelegramSafe('그룹방 알림');
    t('그룹방 알림은 전송하지 않고 skipped', a && a.ok === false && a.skipped === 'test_run', JSON.stringify(a));

    const b = await tg.sendTextToTelegramPersonalSafe('개인방 알림');
    t('개인방 알림도 전송하지 않고 skipped', b && b.ok === false && b.skipped === 'test_run', JSON.stringify(b));

    t('fetch 를 한 번도 부르지 않았다', fetched === 0, 'fetch ' + fetched + '회');
  } finally {
    global.fetch = realFetch;
  }

  /* 같은 사고의 다른 절반: 스텁이 부실하면 핸들러가 조용히 catch 로 간다.
     upload-url 을 쓰는 테스트의 스토리지 스텁에 getPublicUrl 이 있는지 본다. */
  const fs = require('fs');
  const f = fs.readFileSync(path.join(__dirname, 'submission-no-tiff.test.js'), 'utf8');
  t('submission-no-tiff 스텁에 getPublicUrl 이 있다', /getPublicUrl/.test(f));
  t('submission-no-tiff 가 200 과 발급 개수를 단언한다', /r\.code === 200/.test(f));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ telegram-no-send-in-tests FAILED'); process.exit(1); }
  console.log('✅ telegram-no-send-in-tests passed');
})();
