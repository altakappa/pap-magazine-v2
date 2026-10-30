/**
 * Buffer 429 차단기 (2026-10-30)
 *
 * 왜: 10-28 부터 Buffer 가 429 만 돌려주는데 drive-tiktok-post 57회·tiktok-reels 18회
 *     연속 실패. "잠시 후 재시도" 가 10분마다 한 요청을 더 태워 30일 롤링 상한이
 *     영원히 안 비워지는 구조였다. 여기서 지키는 것:
 *   ① 429 한 번 → 차단기 ON → 다음 graphql 호출은 fetch 를 하지 않고 즉시 쿨다운 예외
 *   ② 쿨다운 예외/429 예외에 rateLimited=true 가 붙는다 (크론이 구분하는 근거)
 *   ③ DB 가 없으면 차단기는 '쿨다운 아님' (차단기 고장이 게시를 영구히 막지 않는다)
 *   ④ drive-tiktok-post 는 429 를 파일 실패 횟수에 세지 않고(포기 금지) 200 보류로 응답
 *   ⑤ tiktok-reels 도 쿨다운이면 자리 찜 전에 200 보류
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

// 가짜 supabase: ops_alert_state 한 줄짜리 메모리 테이블
const rows = {};
function fakeDb() {
  return {
    from(table) {
      const st = { table, key: null, sel: false };
      const q = {
        select() { st.sel = true; return q; },
        eq(_c, v) { st.key = v; return q; },
        maybeSingle: async () => ({ data: rows[st.key] ? { last_payload: rows[st.key].last_payload } : null }),
        upsert: async (row) => { rows[row.key] = row; return { error: null }; },
      };
      return q;
    },
  };
}
function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
}

(async () => {
  console.log('=== ① 429 → 차단기 ON → 다음 호출은 네트워크 없이 보류 ===');
  stub('supabase.js', { supabaseAdmin: fakeDb() });
  process.env.BUFFER_API_KEY = 'test-key';
  const breaker = require('../api/_lib/bufferBreaker');
  const buffer = require('../api/_lib/buffer');
  let fetches = 0;
  global.fetch = async () => { fetches++; return { status: 429, ok: false, json: async () => ({}) }; };

  let e1 = null;
  try { await buffer.graphql('query { x }'); } catch (e) { e1 = e; }
  t('첫 호출은 fetch 를 한다', fetches === 1);
  t('429 예외에 rateLimited=true', !!(e1 && e1.rateLimited));
  t('429 예외는 newlyTripped=true (처음 켜짐)', !!(e1 && e1.newlyTripped));
  t('DB 에 쿨다운 until 이 적힌다', !!(rows[breaker.KEY] && Date.parse(rows[breaker.KEY].last_payload.until) > Date.now()));

  let e2 = null;
  try { await buffer.graphql('query { y }'); } catch (e) { e2 = e; }
  t('쿨다운 중 두 번째 호출은 fetch 를 하지 않는다', fetches === 1, 'fetches=' + fetches);
  t('두 번째 예외는 BUFFER_COOLDOWN + rateLimited', !!(e2 && e2.code === 'BUFFER_COOLDOWN' && e2.rateLimited));
  const c = await breaker.check();
  t('check() 가 cooling=true', c.cooling === true && !!c.until);

  console.log('=== ③ DB 없으면 쿨다운 아님 (안전한 실패 모드) ===');
  breaker._reset();
  stub('supabase.js', (() => { throw new Error('no env'); })); // require 가 throw 하는 상황 흉내
  // _db() 는 require 실패를 null 로 다룬다 — 캐시된 모듈을 지워 다시 require 하게 한다
  delete require.cache[path.join(ROOT, 'api', '_lib', 'supabase.js')];
  const c2 = await breaker.check();
  t('DB 접근 불가 → cooling=false', c2.cooling === false);

  console.log('=== ④⑤ 크론 소스 가드 (실행 아닌 소스 검사) ===');
  const drive = fs.readFileSync(path.join(ROOT, 'api/cron/drive-tiktok-post.js'), 'utf8');
  const reels = fs.readFileSync(path.join(ROOT, 'api/cron/tiktok-reels.js'), 'utf8');
  t('drive: 쿨다운이면 드라이브 조회 전에 200 보류', /breaker\.check\(\)[\s\S]{0,300}held: true/.test(drive));
  t('drive: 429(rateLimited) 는 bumpFailCount 를 타지 않는다',
    /else if \(err && err\.rateLimited\)[\s\S]{0,600}\} else \{\s*const n = await bumpFailCount/.test(drive));
  t('drive: 차단기 처음 켜질 때만 텔레그램', /newlyTripped\)\s*\{\s*await tellHuman/.test(drive));
  t('drive: 429 실패는 502 가 아니라 200 보류', /429\|쿨다운[\s\S]{0,200}status\(200\)/.test(drive));
  t('reels: 쿨다운이면 자리 찜 전에 200 보류', /breaker\.check\(\)[\s\S]{0,300}held: true[\s\S]*claiming/.test(reels));
  t('reels: 429 실패는 502 가 아니라 200 보류', /429\|쿨다운[\s\S]{0,200}status\(200\)/.test(reels));
  const bjs = fs.readFileSync(path.join(ROOT, 'api/_lib/buffer.js'), 'utf8');
  t('buffer.js: 429 에서 breaker.trip 을 부른다', /status === 429[\s\S]{0,400}breaker\.trip\(/.test(bjs));
  t('buffer.js: 예외 문구 "(429) — 잠시 후 재시도" 가 사라졌다 (틀린 진단)', !/\(429\) — 잠시 후 재시도'/.test(bjs));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ buffer-breaker tests FAILED'); process.exit(1); }
  console.log('✅ buffer-breaker tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
