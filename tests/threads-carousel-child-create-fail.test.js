// PAP Magazine — 스레드 캐러셀: 자식 한 장의 '생성' 실패가 캐러셀 전체를 날렸다 (2026-09-22)
//
// [무슨 일] 9/21 16:03 UTC 게시물. 10장 중 7번째 자식 컨테이너 생성이
// code 1 / subcode 2207052 로 실패했다. 예전 코드는 여기서 바로 throw 해서
// 나머지 9장도 버리고 '미디어 없이 게시함' 으로 글만 올라갔다.
// (9/21 에 고친 4279004 는 '처리 전에 묶은' 문제다. 이건 다른 실패다.)
//
// [고친 것] 생성에 실패한 장은 건너뛰고 이어 간다. 성공한 장이 2장 미만일 때만 멈춘다.
//
// 이 테스트는 postMedia 를 **실제로 돌린다**. supabase·fetch·setTimeout 을 가짜로 바꾼다.
// Run with `node tests/threads-carousel-child-create-fail.test.js` (npm test 에 연결).
'use strict';
const path = require('path');
const Module = require('module');

const SUPABASE = require.resolve('../api/_lib/supabase');
require.cache[SUPABASE] = new Module(SUPABASE);
require.cache[SUPABASE].exports = { supabaseAdmin: { from: () => ({
  select: () => ({ eq: () => ({ single: async () => ({ data: { access_token: 'tok', user_id: 'u1',
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, error: null }) }) }),
}) } };
require.cache[SUPABASE].loaded = true;

let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { console.log('  ✓ ' + l); passed++; } else { console.log('  ✗ ' + l + (d ? ' — ' + d : '')); failed++; } }

const realTimeout = global.setTimeout;
global.setTimeout = (fn) => realTimeout(fn, 0);
const realWarn = console.warn; console.warn = () => {};

const { postMedia } = require('../api/_lib/threads');

// badIdx: 생성 실패시킬 이미지 번호(0부터). throwIdx: fetch 자체가 예외.
function install(badIdx, throwIdx) {
  const log = { carouselChildren: null, published: 0, childPosts: 0 };
  let seq = 0;
  global.fetch = async (url, opt) => {
    const u = String(url);
    const body = opt && opt.body ? new URLSearchParams(String(opt.body)) : null;
    const res = (status, j) => ({ ok: status < 400, status, json: async () => j });
    if (u.endsWith('/me/threads') && body && body.get('is_carousel_item') === 'true') {
      const i = log.childPosts++;
      if (throwIdx && throwIdx.includes(i)) throw new Error('network timeout');
      if (badIdx.includes(i)) return res(400, { error: { message: 'An unknown error occurred', type: 'OAuthException', code: 1, error_subcode: 2207052, is_transient: false } });
      return res(200, { id: 'c' + i });
    }
    if (u.endsWith('/me/threads') && body && body.get('media_type') === 'CAROUSEL') {
      log.carouselChildren = body.get('children');
      return res(200, { id: 'car' + (++seq) });
    }
    if (u.endsWith('/me/threads_publish')) { log.published++; return res(200, { id: 'post1' }); }
    if (u.includes('?fields=status')) return res(200, { status: 'FINISHED' });
    return res(404, { error: { message: 'unexpected ' + u } });
  };
  return log;
}
const imgs = (n) => Array.from({ length: n }, (_, i) => 'https://www.pap-magazine.com/img/' + i + '.jpg');

(async () => {
  console.log('\n[1] 9/21 재현: 10장 중 7번째(인덱스 6) 생성 실패 → 9장으로 게시');
  let log = install([6]);
  let out = await postMedia({ images: imgs(10) }, 'caption');
  ok('예외 없이 게시됨', out && out.id === 'post1');
  ok('게시 1회', log.published === 1, String(log.published));
  ok('캐러셀 자식 9장', log.carouselChildren && log.carouselChildren.split(',').length === 9, log.carouselChildren);
  ok('실패한 c6 은 빠짐', log.carouselChildren && !log.carouselChildren.split(',').includes('c6'));
  ok('순서 유지(c0 이 맨 앞 = 표지)', log.carouselChildren && log.carouselChildren.split(',')[0] === 'c0');
  ok('count=9', out.count === 9, String(out.count));
  ok('dropped=1', out.dropped === 1, String(out.dropped));
  ok('10장 모두 생성 시도함(중간에 멈추지 않음)', log.childPosts === 10, String(log.childPosts));

  console.log('\n[2] 네트워크 예외도 같은 취급');
  log = install([], [2]);
  out = await postMedia({ images: imgs(4) }, 'caption');
  ok('3장으로 게시', out.count === 3 && log.carouselChildren.split(',').length === 3, log.carouselChildren);

  console.log('\n[3] 여러 장 실패, 2장 남으면 게시');
  log = install([0, 1, 3]);
  out = await postMedia({ images: imgs(5) }, 'caption');
  ok('2장 캐러셀', out.count === 2, String(out.count));
  ok('dropped=3', out.dropped === 3, String(out.dropped));

  console.log('\n[4] 1장만 남으면 멈춤(캐러셀은 2장 이상)');
  log = install([0, 1]);
  let err = null;
  try { await postMedia({ images: imgs(3) }, 'caption'); } catch (e) { err = e; }
  ok('예외 발생', !!err);
  ok('게시 안 함', log.published === 0);
  ok('메시지에 실패 번호·성공 장수', err && /1,2번째 컨테이너 실패/.test(err.message) && /성공 1\/3장/.test(err.message), err && err.message);
  ok('메시지에 subcode 포함(원인 추적용)', err && /2207052/.test(err.message), err && err.message);

  console.log('\n[5] 전부 성공이면 예전과 같음');
  log = install([]);
  out = await postMedia({ images: imgs(3) }, 'caption');
  ok('3장, dropped 0', out.count === 3 && out.dropped === 0, JSON.stringify(out));

  console.warn = realWarn;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.warn = realWarn; console.error(e); process.exit(1); });
