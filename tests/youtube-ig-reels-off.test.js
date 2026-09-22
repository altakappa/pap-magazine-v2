// PAP Magazine — 유튜브: 인스타 릴스 경로를 끈다 (2026-09-22)
//
// 도메니코: "영상은 유튜브 폴더에서 가져가서 올려주고 인스타에서 가져가지 않으면 돼"
// + "유튜브 폴더에서 영상을 가져가면 소리를 음소거하지 않아도 괜찮아".
// 인스타 릴스 → 유튜브(youtube-post)는 음원 저작권 때문에 음소거해서 올렸고,
// 그래서 소리 없는 쇼츠가 나갔다. 이 경로는 꺼야 하고, 드라이브 경로는 소리를 건드리면 안 된다.
//
// Run with `node tests/youtube-ig-reels-off.test.js` (npm test 에 연결).
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { console.log('  ✓ ' + l); passed++; } else { console.log('  ✗ ' + l + (d ? ' — ' + d : '')); failed++; } }

// supabase: 어떤 체인이 와도 빈 결과
const chain = new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? (res) => res({ data: [], error: null, count: 0 }) : chain),
  apply: () => chain,
});
const SUPABASE = require.resolve('../api/_lib/supabase');
require.cache[SUPABASE] = new Module(SUPABASE);
require.cache[SUPABASE].exports = { supabaseAdmin: { from: () => chain, rpc: () => chain } };
require.cache[SUPABASE].loaded = true;

process.env.CRON_SECRET = 'test-secret';
process.env.YOUTUBE_PUBLIC = '1'; // 켜진 환경에서도 꺼져 있어야 한다

let fetchCalls = [];
global.fetch = async (u) => { fetchCalls.push(String(u)); return { ok: false, status: 599, json: async () => ({}), text: async () => '' }; };

function fakeRes() {
  const r = { locals: {}, statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

(async () => {
  console.log('\n[1] youtube-post 는 크론으로 불려도 아무것도 올리지 않는다');
  const handler = require('../api/cron/youtube-post.js');
  const fn = handler.default || handler;
  const res = fakeRes();
  await fn({ method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: {} }, res);
  const body = res.body || {};
  ok('200 응답', res.statusCode === 200, String(res.statusCode));
  ok('disabled:true', body.disabled === true, JSON.stringify(body).slice(0, 200));
  ok('노트에 꺼짐 사유', /드라이브 유튜브 폴더에서만/.test(String(res.locals.cronNote || body.note || '')));
  ok('영상 다운로드·유튜브 호출 없음', !fetchCalls.some((u) => /googleapis|youtube|\.mp4|storage\/v1/.test(u)), fetchCalls.join(' | '));

  console.log('\n[2] 스위치가 꺼진 상태로 고정돼 있다');
  const src = read('api/cron/youtube-post.js');
  ok('IG_REELS_TO_YOUTUBE = false', /const IG_REELS_TO_YOUTUBE = false;/.test(src));
  ok('꺼짐 검사가 업로드보다 먼저', src.indexOf('if (!IG_REELS_TO_YOUTUBE)') > 0 && src.indexOf('if (!IG_REELS_TO_YOUTUBE)') < src.indexOf('uploadVideo(uploadBuffer'));

  console.log('\n[3] 드라이브 경로는 소리를 건드리지 않는다');
  for (const f of ['api/cron/drive-youtube-post.js', 'api/cron/drive-story-shorts.js']) {
    const s = read(f);
    ok(f + ' — muteMp4 안 씀', !/muteMp4/.test(s));
    ok(f + ' — uploadVideo 로 올림', /uploadVideo\(/.test(s));
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
