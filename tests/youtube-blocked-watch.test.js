/**
 * 유튜브 저작권 차단 감지 — tests/youtube-blocked-watch.test.js (2026-08-07 신설)
 *
 * 무슨 일이 있었나 ────────────────────────────────────────────────────
 * 감시기(pipeline-watch)는 videos.list 를 `part=status` 로만 물었다.
 * 그런데 Content ID 소유권 주장은 영상을 '거절'하지 않는다 — 그대로 두고
 * 나라별로 '막는다'. 그래서 차단된 영상의 status 는 이렇게 보인다:
 *
 *     privacyStatus  = public
 *     uploadStatus   = processed
 *     rejectionReason= null
 *
 * 즉 status 만 보는 눈에는 완벽하게 정상이다. 2026-08-07 실측에서
 * eBKJKbk4SjE 가 정확히 이 모양이었고, 실제로는 249개국 차단 —
 * 사실상 전 세계에서 재생 불가였는데 감시기는 '정상 29건'에 넣고 있었다.
 * 답은 contentDetails.regionRestriction.blocked 에만 있다.
 *
 * 여기서 지키는 것:
 *   ① part 에 contentDetails 가 실제로 들어간다 (안 넣으면 영원히 못 본다)
 *   ② blocked 국가가 하나라도 있으면 문제로 잡는다
 *   ③ 전 세계 차단과 일부 지역 차단의 문구가 다르다
 *   ④ '되돌릴 수 있는 것'이 알림 맨 앞에 온다 (차단 > 사라짐)
 *   ⑤ 정상 영상은 여전히 조용하다 — 오탐이 나면 아무도 안 본다
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [], isLikelyEditorialCaption: () => false, _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('backfillHealth.js', { diagnoseBackfill: () => ({}), buildBackfillAlert: () => ({}) });
stub('translateHealth.js', { judgeTranslateHealth: () => ({}), buildTranslateAlert: () => ({}) });
stub('faqHealth.js', { judgeFaqHealth: () => ({}), buildFaqAlert: () => ({}), summarizeFaqRuns: () => ({}) });
stub('cronDurationHealth.js', { summarizeDurations: () => ({}), judgeCronDuration: () => ({}), buildCronDurationAlert: () => ({}) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const watch = require(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'));
const J = watch.judgeVideoStates;
const A = watch.buildVideoStateAlert;

const rows = (...ids) => ids.map((id) => ({ video_id: id }));
const S = (m) => ({ get: (k) => m[k] });
const OKST = { privacyStatus: 'public', uploadStatus: 'processed', blockedRegions: 0, licensedContent: false };

console.log('\n[1] part 에 contentDetails 가 들어간다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'youtube.js'), 'utf8');
  const m = src.match(/youtube\/v3\/videos\?part=([^&]+)&/);
  t('videos.list 호출을 찾는다', !!m, src.slice(0, 0));
  t('part 에 status 가 있다', !!m && /status/.test(m[1]), m && m[1]);
  t('part 에 contentDetails 가 있다 — 이게 없으면 차단을 영원히 못 본다',
    !!m && /contentDetails/.test(m[1]), m && m[1]);
  t('blockedRegions 를 숫자로 뽑아 넘긴다', /blockedRegions:\s*Array\.isArray/.test(src));
  t('regionRestriction 이 없어도 0 으로 떨어진다 (undefined 아님)',
    /regionRestriction\)\s*\|\|\s*\{\}/.test(src));
}

console.log('\n[2] 차단을 문제로 잡는다');
{
  // 실제 eBKJKbk4SjE 의 모양 그대로 — status 만 보면 완벽히 정상이다.
  const d = J(rows('claimed'), S({
    claimed: { privacyStatus: 'public', uploadStatus: 'processed', rejectionReason: null, blockedRegions: 249 },
  }));
  t('정상으로 넘기지 않는다', d.healthy === false);
  t('원인을 blocked 로 찍는다', d.bad[0] && d.bad[0].cause === 'blocked', JSON.stringify(d.bad[0]));
  t('차단 국가 수를 그대로 싣는다', d.bad[0].blocked_regions === 249);
  t('저작권을 짚어 준다', /저작권/.test(d.bad[0].why), d.bad[0].why);
  t('정상 집계에 안 들어간다', d.ok === 0);
}

console.log('\n[3] 전 세계 차단과 일부 지역 차단을 구분한다');
{
  const world = J(rows('w'), S({ w: { ...OKST, blockedRegions: 249 } })).bad[0];
  const some = J(rows('s'), S({ s: { ...OKST, blockedRegions: 2 } })).bad[0];
  t('249개국은 전 세계로 읽는다', /전 세계/.test(world.why), world.why);
  t('2개국은 전 세계라고 말하지 않는다', !/전 세계/.test(some.why), some.why);
  t('일부 차단도 문제로는 잡는다', some.cause === 'blocked');
  t('둘 다 국가 수를 보여준다', /249/.test(world.why) && /2개국/.test(some.why));
}

console.log('\n[4] 되돌릴 수 있는 것이 앞에 온다');
{
  // 사라진 영상 5건이 먼저 들어와도, 알림 앞 5줄을 그것들이 다 먹으면 안 된다.
  const ids = ['g1', 'g2', 'g3', 'g4', 'g5', 'claimed'];
  const map = {};
  for (const g of ids.slice(0, 5)) map[g] = undefined; // 유튜브가 안 돌려줌 = gone
  map.claimed = { ...OKST, blockedRegions: 249 };
  const d = J(rows(...ids), { get: (k) => map[k] });
  t('6건 모두 문제로 잡힌다', d.bad.length === 6, d.bad.length);
  t('차단이 맨 앞이다', d.bad[0].cause === 'blocked', d.bad.map((b) => b.cause).join(','));
  const alert = A(d, 'https://x.test');
  t('알림 제목이 차단을 말한다', /차단/.test(alert.title), alert.title);
  t('앞 5줄 안에 차단 영상이 있다', alert.lines.slice(0, 5).some((l) => /claimed/.test(l)), alert.lines);
}

console.log('\n[5] 정상은 조용하다 (오탐 금지)');
{
  const d = J(rows('a', 'b'), S({ a: { ...OKST }, b: { ...OKST } }));
  t('전부 정상이면 healthy', d.healthy === true, JSON.stringify(d.bad));
  t('정상 2건으로 센다', d.ok === 2);
  t('blockedRegions 가 없어도(undefined) 문제 삼지 않는다',
    J(rows('c'), S({ c: { privacyStatus: 'public', uploadStatus: 'processed' } })).healthy === true);
  t('비공개는 여전히 잡는다',
    J(rows('p'), S({ p: { ...OKST, privacyStatus: 'private' } })).bad[0].cause === 'private');
  t('거절도 여전히 잡는다',
    J(rows('r'), S({ r: { ...OKST, rejectionReason: 'copyright' } })).bad[0].cause === 'rejected');
  t('사라진 것도 여전히 잡는다', J(rows('x'), S({})).bad[0].cause === 'gone');
}

console.log('\n[6] 알림 문구 사전에 blocked 가 있다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'), 'utf8');
  t('map 에 blocked 항목이 있다', /blocked:\s*'저작권으로 차단됨'/.test(src));
  t('차단 판정이 privacyStatus 검사보다 먼저다',
    src.indexOf("cause: 'blocked'") < src.indexOf("cause: 'private'"),
    '차단된 영상은 public 이라 순서가 뒤바뀌면 영원히 안 잡힌다');
  t('전 세계 기준을 환경변수로 뺀다', /YT_BLOCK_WORLDWIDE_MIN/.test(src));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ youtube-blocked-watch tests FAILED'); process.exit(1); }
console.log('✅ youtube-blocked-watch tests passed');
