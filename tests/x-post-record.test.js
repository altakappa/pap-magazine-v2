/**
 * X 게시 기록 — 가드 (2026-09-02 신설, 마이그레이션 141)
 *
 * ■ 왜 만들었나
 * 도메니코: "X 에 올라가는 게시글 말투를 인스타 말투로 학습해서 입혀줄 수 있어?"
 *
 * 입히는 건 **이미 하고 있었다** — papVoice.X_VOICE 가 @pap_magazine 실캡션
 * 50개(2026-07-28~08-03) 역설계에서 나온 리듬을 그대로 담고 있다.
 * 없는 것은 **고쳤는지 확인할 눈금**이었다:
 *
 *   크론 노트   'account=magazine · 수집 1건 · X 1/1건 · 스레드 1/1건'
 *   저장된 본문  없음 (x_posts 같은 표가 없었다)
 *
 * 개수만 세는 기록은 "돌았다 ≠ 잘 나갔다" 를 못 가른다. 말투가 좋아졌는지
 * 나빠졌는지 아무도 볼 수 없으니 고칠 수도 없다.
 *
 * 여기서 지키는 것:
 *   ① 성공·실패 **둘 다** 남긴다 (성공만 남기면 왜 안 나갔는지 모른다)
 *   ② 기록 실패가 트윗을 되돌리지 않는다 (DB 사고가 게시 사고로 번지면 안 된다)
 *   ③ 목이 하나다 — postTweet 한 곳에만 붙인다 (호출부마다 붙이면 한쪽만 고쳐진다)
 *   ④ supabase 를 최상단에서 require 하지 않는다 (env 없는 실행에서 CI 가 죽는다)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'xPost.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

console.log('[1] 기록이 트윗을 되돌리지 않는다  ← ②');
/* xPost 를 그대로 require 한다. supabase 를 스텁하지 않는다 —
   최상단 require 가 생기면 여기서 바로 죽는다. 그게 이 테스트의 절반이다. */
const xp = require(path.join(ROOT, 'api', '_lib', 'xPost.js'));
t('supabase 없이도 모듈이 뜬다  ← ④', typeof xp.postTweet === 'function');
t('supabase 를 최상단에서 부르지 않는다',
  !/^const .*require\('\.\/supabase'\)/m.test(SRC));
t('기록 함수 안에서 지연 로딩한다',
  /require\('\.\/supabase'\);\s*\/\/ 지연 로딩|\/\/ 지연 로딩/.test(SRC)
  && /async function recordTweet/.test(SRC));

(async () => {
  /* SUPABASE_URL 이 없으면 조용히 넘어가야 한다. 던지면 트윗 경로가 끊긴다. */
  const savedUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  let threw = false;
  try { await xp.recordTweet({ text: 'x', ok: true }); } catch (_) { threw = true; }
  t('env 가 없으면 기록을 건너뛴다 (던지지 않는다)', threw === false);

  /* supabase 가 있어도 insert 가 터지면 삼켜야 한다. */
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  const Module = require('module');
  const sp = path.join(ROOT, 'api', '_lib', 'supabase.js');
  const m = new Module(sp, null);
  m.filename = sp; m.loaded = true;
  m.exports = { supabaseAdmin: { from() { throw new Error('DB 터짐'); } } };
  require.cache[sp] = m;
  threw = false;
  try { await xp.recordTweet({ text: 'x', ok: true }); } catch (_) { threw = true; }
  t('insert 가 터져도 삼킨다 (트윗은 이미 나갔다)  ← ②', threw === false);

  /* 실제로 무엇을 적는지 — 성공·실패 둘 다 */
  const rows = [];
  m.exports = { supabaseAdmin: { from() { return { insert(r) { rows.push(r); return Promise.resolve({}); } }; } } };
  await xp.recordTweet({ account: 'magazine', text: '본문', ok: true, tweet_id: '123' });
  t('본문을 그대로 남긴다 (말투를 보려면 본문이 있어야 한다)',
    rows.length === 1 && rows[0].text === '본문', rows[0]);
  if (savedUrl) process.env.SUPABASE_URL = savedUrl; else delete process.env.SUPABASE_URL;

  console.log('\n[2] 목이 하나다  ← ③');
  t('postTweet 안에서 기록한다', /async function postTweet[\s\S]{0,4000}recordTweet\(/.test(SRC));
  const calls = (SRC.match(/await recordTweet\(/g) || []).length;
  t('성공·실패·예외 세 갈래 모두 남긴다  ← ①', calls >= 3, calls + '곳');
  t('페퍼릿 계정을 구분해 남긴다', /label: 'pepperit'/.test(SRC));
  t('계정 기본값은 매거진이다', /c\.label \|\| \(c\.token \? 'pepperit' : 'magazine'\)/.test(SRC));

  console.log('\n[3] 마이그레이션');
  const sql = fs.readFileSync(path.join(ROOT, 'supabase_migrations', '141_x_posts.sql'), 'utf8');
  t('x_posts 표를 만든다', /create table if not exists public\.x_posts/.test(sql));
  t('본문 칼럼이 필수다', /text\s+text\s+not null/.test(sql));
  t('실패 기록을 위해 tweet_id 는 비어도 된다', !/tweet_id\s+text\s+not null/.test(sql));
  t('같은 트윗을 두 번 적지 않는다', /unique index[\s\S]{0,120}tweet_id[\s\S]{0,60}where tweet_id is not null/.test(sql));
  t('RLS 를 켠다 (공개 읽기 금지 규약)', /enable row level security/.test(sql));

  console.log('\n' + (fail ? '✗' : '✓') + ' x-post-record: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
