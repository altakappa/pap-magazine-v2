// PAP Magazine — 스레드 캐러셀: 자식이 처리되기 전에 묶었다 (2026-09-21)
//
// [무슨 일] 9/14 부터 일주일 49건 중 20건(41%)이 캐러셀 생성에 실패했다.
// 전부 code 100 / subcode 4279004 "ID 가 X 인 하위 요소가 유효하지 않거나
// 없거나 만료되었습니다." 실패하면 '미디어 없이 게시함' 으로 사진 없는 글이 나갔다.
//
// [원인] 자식 컨테이너를 만들자마자 CAROUSEL 을 만들었다. 기다린 건 캐러셀
// 하나뿐이었다. 9/13 이전 0건은 처리가 빨랐을 뿐, 운이었다.
//
// 이 테스트는 waitChildren 을 **실제로 돌린다**. fetch 를 가짜로 바꿔
// 자식마다 몇 번째 조회에서 FINISHED/ERROR 가 되는지 정해 두고 결과를 본다.
// setTimeout 도 즉시 실행으로 바꿔 몇 초씩 기다리지 않는다.
//
// Run with `node tests/threads-carousel-children.test.js` (npm test 에 연결).
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'threads.js'), 'utf8');

const SUPABASE = require.resolve('../api/_lib/supabase');
require.cache[SUPABASE] = new Module(SUPABASE);
require.cache[SUPABASE].exports = { supabaseAdmin: { from: () => ({}) } };
require.cache[SUPABASE].loaded = true;

let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { console.log('  ✓ ' + l); passed++; } else { console.log('  ✗ ' + l + (d ? ' — ' + d : '')); failed++; } }

const realTimeout = global.setTimeout;
global.setTimeout = (fn) => realTimeout(fn, 0);

const { waitChildren } = require('../api/_lib/threads');

// plan: id → 매 조회마다 돌려줄 status 배열 (끝나면 마지막 값 유지)
function fakeFetch(plan, calls) {
  return async (url) => {
    const id = String(url).split('/v1.0/')[1].split('?')[0];
    calls[id] = (calls[id] || 0) + 1;
    const seq = plan[id] || ['IN_PROGRESS'];
    const st = seq[Math.min(calls[id] - 1, seq.length - 1)];
    if (st === 'THROW') throw new Error('network');
    return { json: async () => ({ status: st }) };
  };
}

(async () => {
  console.log('\n=== 소스: 묶기 전에 기다리는가 ===');
  ok('waitChildren 이 있다', /async function waitChildren\(ids, token, rounds\)/.test(SRC));
  const post = SRC.slice(SRC.indexOf('async function postMedia'));
  ok('CAROUSEL 생성 전에 waitChildren 을 부른다',
    post.indexOf('await waitChildren(children') > 0
    && post.indexOf('await waitChildren(children') < post.indexOf("media_type: 'CAROUSEL'"));
  ok('캐러셀에는 준비된 자식만 넣는다', /children: ready\.join\(','\)/.test(post));
  ok('만든 자식 전부를 그대로 넣지 않는다', !/children: children\.join/.test(post));
  ok('준비된 게 2장 미만이면 캐러셀을 만들지 않는다', /if \(ready\.length < 2\)/.test(post));
  ok('실패 사유에 몇 장이 준비됐는지 적는다', /캐러셀 자식 준비 안 됨/.test(post));
  ok('자식을 한꺼번에 폴링한다 (장수만큼 시간이 곱해지지 않게)', /await Promise\.all\(pending\.map/.test(SRC));
  ok('반환 count 가 실제 게시 장수다', /count: ready\.length/.test(post));

  console.log('\n=== 실제로 돌린다 ===');
  {
    const calls = {};
    global.fetch = fakeFetch({ a: ['FINISHED'], b: ['IN_PROGRESS', 'FINISHED'], c: ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'] }, calls);
    const r = await waitChildren(['a', 'b', 'c'], 't');
    ok('늦게 끝나는 자식도 기다려서 전부 받는다', r.ready.join() === 'a,b,c', JSON.stringify(r));
    ok('제외된 자식 없음', r.dropped.length === 0);
    ok('끝난 자식은 다시 조회하지 않는다', calls.a === 1, JSON.stringify(calls));
  }
  {
    global.fetch = fakeFetch({ a: ['FINISHED'], b: ['ERROR'], c: ['FINISHED'] }, {});
    const r = await waitChildren(['a', 'b', 'c'], 't');
    ok('ERROR 난 자식은 뺀다', r.ready.join() === 'a,c', JSON.stringify(r));
    ok('뺀 자식과 사유를 돌려준다', r.dropped.length === 1 && r.dropped[0].status === 'ERROR');
  }
  {
    global.fetch = fakeFetch({ a: ['FINISHED'], b: ['IN_PROGRESS'], c: ['FINISHED'] }, {});
    const r = await waitChildren(['a', 'b', 'c'], 't', 3);
    ok('시간 안에 안 끝난 자식도 뺀다 (넣으면 4279004 가 난다)', r.ready.join() === 'a,c');
    ok('안 끝난 건 IN_PROGRESS 로 남는다', r.dropped[0].status === 'IN_PROGRESS');
  }
  {
    global.fetch = fakeFetch({ c: ['FINISHED'], a: ['IN_PROGRESS', 'FINISHED'], b: ['FINISHED'] }, {});
    const r = await waitChildren(['a', 'b', 'c'], 't');
    ok('순서를 유지한다 (첫 컷이 표지다)', r.ready.join() === 'a,b,c', r.ready.join());
  }
  {
    global.fetch = fakeFetch({ a: ['THROW', 'FINISHED'], b: ['FINISHED'] }, {});
    const r = await waitChildren(['a', 'b'], 't');
    ok('조회 한 번 실패해도 다음 라운드에 다시 본다', r.ready.join() === 'a,b', JSON.stringify(r));
  }
  {
    global.fetch = fakeFetch({ a: ['EXPIRED'], b: ['FINISHED'] }, {});
    const r = await waitChildren(['a', 'b'], 't');
    ok('EXPIRED 도 뺀다', r.ready.join() === 'b');
  }
  {
    const calls = {};
    global.fetch = fakeFetch({}, calls);
    await waitChildren(['a'], 't', 8);
    ok('라운드 상한을 지킨다 (크론 120초 예산)', calls.a === 8, String(calls.a));
  }

  global.setTimeout = realTimeout;
  console.log('\n' + (failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음') + ' — 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed === 0 ? 0 : 1);
})();
