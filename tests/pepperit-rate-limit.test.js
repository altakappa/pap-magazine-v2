/*
 * pepperit-rate-limit.test.js  (2026-10-08)
 *
 * sync-pepperit 이 26시간에 79번 '실패' 로 찍혔다. 전부 메타 앱 호출 한도(code 4).
 * 우리 코드 고장이 아니라 앱 전체가 나눠 쓰는 시간당 한도였고, 진짜 실패를 묻고 있었다.
 *
 * 고친 내용을 **실제로 돌려서** 확인한다 (소스 문자열 검사 아님):
 *  1. 한도 오류 → 200 + note '⚠️ 한도초과' (ok=true 지만 표식이 남아 점검이 센다)
 *  2. 한도 아닌 오류(500 데이터 과다 등) → 그대로 500 (진짜 고장은 계속 실패로 보인다)
 *  3. 실행 간격이 10분이 아니다 (호출량 자체를 줄인다)
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

process.env.IG_ACCESS_TOKEN = 'x'; process.env.IG_USER_ID = '1'; process.env.CRON_SECRET = 'sekret';

// supabase 는 require.cache 주입으로 스텁 (no-eager-npm-deps 가 요구하는 검증된 패턴)
const sbPath = require.resolve('../api/_lib/supabase');
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true,
  exports: { supabaseAdmin: { from() { throw new Error('DB 호출되면 안 됨'); } } } };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/_lib\/cronGuard$/.test(request)) return { withCronGuard: (_n, h) => h };
  if (/_lib\/supabase$/.test(request)) return { supabaseAdmin: { from() { throw new Error('DB 호출되면 안 됨'); } } };
  if (/_lib\/auth$/.test(request)) return { requireAdmin: async () => null };
  if (/_lib\/instagramImport$/.test(request)) return {};
  if (/_lib\/pingSearch$/.test(request)) return { PEPPERIT_SITE: 'x' };
  if (/_lib\/xPost$/.test(request)) return {};
  return origLoad.apply(this, arguments);
};
const handler = require('../api/cron/sync-pepperit.js');
Module._load = origLoad;

function run(fetchImpl) {
  global.fetch = fetchImpl;
  return new Promise(async (resolve) => {
    const out = {};
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; resolve(out); return this; } };
    await handler({ headers: { authorization: 'Bearer sekret' }, query: {} }, res);
  });
}

(async () => {
  const limitBody = JSON.stringify({ error: { message: '(#4) Application request limit reached', type: 'OAuthException', is_transient: true, code: 4 } });
  let r = await run(async () => ({ ok: false, status: 403, text: async () => limitBody, json: async () => JSON.parse(limitBody) }));
  ok(r.status === 200, '한도 초과 → 200 (실패로 세지 않음)');
  ok(r.body && r.body.rate_limited === true, 'rate_limited 표식');
  ok(r.body && /^⚠️ 한도초과/.test(r.body.note), "note 가 '⚠️ 한도초과' 로 시작 — 점검이 센다");

  r = await run(async () => ({ ok: false, status: 500, text: async () => '{"error":{"message":"Please reduce the amount of data","code":1}}', json: async () => ({}) }));
  ok(r.status === 500, '한도 아닌 오류는 그대로 500 — 진짜 고장은 계속 보인다');

  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const c = vj.crons.find((x) => x.path === '/api/cron/sync-pepperit');
  ok(c && c.schedule !== '4-54/10 * * * *', '10분 간격이 아님 (호출량 축소)');
  ok(c && c.schedule.split(' ')[0].split(',').length <= 3, '시간당 3회 이하');

  console.log('\n' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})();
