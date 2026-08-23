/**
 * 텔레그램 webhook 을 **실제로 실행해 본다** (2026-08-23 신설)
 *
 * ■ 왜 필요했나 — 이 저장소에서 이미 터진 사고다
 *   2026-08-23, 깨우기 코드를 갈아끼우면서 allowedChats() 함수를 통째로 지웠다.
 *   npm test 는 전부 통과했다. celeb-brief.test.js 가 소스를 **문자열로만**
 *   검사했기 때문이다 — 정규식은 "없어진 함수를 부르고 있다"를 못 본다.
 *   결과: webhook 이 11분 동안 모든 메시지에 500(ReferenceError)을 냈고,
 *   도메니코가 링크를 보냈는데 아무 답도 없었다.
 *
 *   소스 검사 테스트는 '의도'를 지키고, 이 테스트는 '실행되는가'를 지킨다.
 *   둘 다 필요하다.
 *
 * ■ node_modules 가 있을 때만 돈다
 *   CI 는 npm ci 없이 npm test 를 돌린다(no-eager-npm-deps.test.js 머리말).
 *   supabase-js 가 없으면 건너뛰고 그 사실을 **출력**한다 — 조용히 통과하면
 *   "돌았다"고 착각하게 된다.
 */
'use strict';
const assert = require('assert');
const path = require('path');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('텔레그램 webhook 실행 검사');

let deps = true;
try { require('@supabase/supabase-js'); } catch (_e) { deps = false; }

if (!deps) {
  console.log('  … 건너뜀 (@supabase/supabase-js 없음 — CI 환경)');
  console.log('\n텔레그램 webhook 실행 검사: 0건 (건너뜀)');
} else {
  // ── 환경·스텁 준비 (webhook 을 require 하기 **전에** 해야 한다) ──
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-key';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'stub-key';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
  process.env.TELEGRAM_PERSONAL_CHAT_ID = '777';
  process.env.CRON_SECRET = '';                    // 깨우기는 생략시킨다

  const upserts = [];
  const chain = () => {
    const o = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'update', 'in']) o[m] = () => o;
    o.then = (resolve) => resolve({ data: [], error: null });
    o.upsert = (rows) => { upserts.push(rows); return { then: (r) => r({ data: null, error: null }) }; };
    return o;
  };
  const supa = require(path.join(__dirname, '..', 'api/_lib/supabase'));
  supa.supabaseAdmin = { from: () => chain() };

  const sent = [];
  const tg = require(path.join(__dirname, '..', 'api/_lib/telegram'));
  tg.sendTextToChatSafe = async (chatId, text) => { sent.push({ chatId, text }); return { ok: true }; };

  const handler = require(path.join(__dirname, '..', 'api/telegram/webhook'));

  function makeRes() {
    const r = { statusCode: 0, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  }
  const call = (body, headers) => {
    const res = makeRes();
    return handler({ method: 'POST', headers: headers || { 'x-telegram-bot-api-secret-token': 'test-secret' }, body }, res)
      .then(() => res);
  };
  const msg = (text) => ({ message: { message_id: 1, chat: { id: 777 }, from: { id: 777 }, text } });

  const run = async () => {
    /* 핵심: 링크가 든 정상 메시지에서 **예외 없이** 200 이 나와야 한다.
       allowedChats 가 사라졌던 그 경로다. */
    let res = await call(msg('@jennierubyjane https://www.instagram.com/p/AAA111/'));
    assert.strictEqual(res.statusCode, 200, '링크 메시지에서 200 이 아니다: ' + JSON.stringify(res.body));
    assert.ok(upserts.length >= 1, '큐에 적재되지 않았다');
    assert.strictEqual(upserts[0][0].username, 'jennierubyjane');
    n++; console.log('  ✓ 링크 메시지가 예외 없이 처리된다');

    res = await call(msg('그냥 잡담'));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.skipped, 'no_instagram_link');
    n++; console.log('  ✓ 링크 없는 메시지는 조용히 넘어간다');

    res = await call(msg('https://www.instagram.com/p/BBB222/'));
    assert.strictEqual(res.body.skipped, 'handle_required', '핸들 없는 링크를 되묻지 않는다');
    assert.ok(sent.some((s) => /계정 핸들/.test(s.text)), '핸들 요청 회신이 안 나갔다');
    n++; console.log('  ✓ 핸들 없는 링크는 되묻는다');

    res = await call(msg('올려'));
    assert.strictEqual(res.statusCode, 200, '게시 명령에서 예외가 났다: ' + JSON.stringify(res.body));
    assert.ok(sent.some((s) => /올릴 브리프가 없습니다/.test(s.text)), '브리프가 없을 때 안내가 없다');
    n++; console.log('  ✓ 게시 명령이 예외 없이 처리된다');

    res = await call(msg('안녕'), { 'x-telegram-bot-api-secret-token': 'wrong' });
    assert.strictEqual(res.statusCode, 401, '시크릿이 틀린데 통과했다');
    n++; console.log('  ✓ 시크릿이 틀리면 401');

    const other = { message: { message_id: 2, chat: { id: 999 }, text: '@x https://www.instagram.com/p/CCC/' } };
    res = await call(other);
    assert.strictEqual(res.body.skipped, 'chat_not_allowed', '허용 안 된 채팅이 통과했다');
    n++; console.log('  ✓ 허용되지 않은 채팅은 무시한다');

    console.log('\n텔레그램 webhook 실행 검사: ' + n + '건 통과');
  };
  run().catch((e) => { console.error('  ✗ ' + (e && e.stack || e)); process.exit(1); });
}
