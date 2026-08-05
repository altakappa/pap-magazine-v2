/**
 * 릴스 mp4 수집·복구·감시 회귀 (2026-08-04 신설).
 *
 * 무슨 일이 있었나 ────────────────────────────────────────────────────
 * 2026-07-31 부터 Graph API 목록 응답이 VIDEO 항목에 thumbnail_url 만 주고
 * media_url 을 생략하기 시작했다. _normalizeMedia 는 media_url 만 보고
 * videoUrls 를 채웠으므로 릴스의 videoUrls 가 빈 배열이 됐다.
 * archiveVideosToStorage 는 빈 배열을 0회 반복하고 로그 한 줄 없이 [] 를
 * 돌려줬고, 기사는 source_media_type='VIDEO' 인데 videos:[] 로 발행됐다.
 *
 * 그 기사는 youtube-post 의 후보 필터(videos.length >= 1)에서 탈락한다.
 * youtube-post 는 "업로드할 릴스 기사 없음" 이라며 ok=true 를 남긴다.
 * → 8일간 1,353회를 '성공'으로 돌면서 쇼츠 업로드는 사실상 0건이었고,
 *   실패 알림은 한 번도 울리지 않았다. 실측 피해: 릴스 기사 6건.
 *
 * 이 테스트가 지키는 세 가지 ───────────────────────────────────────────
 *   ① 수집: 목록에 media_url 이 없으면 media id 로 단건 재조회한다.
 *   ② 복구: 이미 videos=[] 로 굳은 기사를 찾아 되돌린다.
 *   ③ 감시: "후보 0건" 을 정상과 고장으로 갈라서, 고장일 때만 울린다.
 *
 * 셋 중 하나라도 빠지면 같은 침묵이 재발한다. ①만 있으면 이미 망가진 기사가
 * 영영 남고, ②만 있으면 매번 복구에 의존하며, ③이 없으면 ①②가 동시에
 * 실패했을 때 또 아무도 모른다.
 *
 * Run with `node tests/reel-video-recovery.test.js` (npm test 에 연결됨).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

// DB·인증·알림을 스텁으로 — 순수 로직만 검증한다 (pipeline-watch.test.js 와 같은 방식).
function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}

const uploaded = [];
stub('supabase.js', {
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async (p, buf) => { uploaded.push({ path: p, bytes: buf.length }); return { error: null }; },
        getPublicUrl: (p) => ({ data: { publicUrl: 'https://cdn.test/' + p } }),
      }),
    },
  },
});
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('cronGuard.js', { withCronGuard: (_name, fn) => fn });

const ig = require('../api/_lib/instagramImport');

/* 가짜 fetch — 네트워크 없이 Graph API / CDN 응답을 흉내낸다. */
const realFetch = global.fetch;
function fakeResponse(opts) {
  const o = opts || {};
  const headers = {
    'content-type': o.contentType || 'application/json',
    'content-length': String(o.length == null ? 3 : o.length),
  };
  return {
    ok: o.ok !== false,
    status: o.status || (o.ok === false ? 404 : 200),
    headers: { get: (k) => headers[String(k).toLowerCase()] || null },
    json: async () => o.json || {},
    text: async () => o.text || '',
    arrayBuffer: async () => new Uint8Array(o.bytes || [1, 2, 3]).buffer,
  };
}

async function main() {
console.log('\n=== ① 수집 — 목록에 media_url 이 없어도 mp4 를 포기하지 않는다 ===');
(function () {
  // 07-31 이후 실제 응답 형태: VIDEO 인데 media_url 이 없다.
  const post = ig.normalizeMedia({
    id: '17958892404191497',
    media_type: 'VIDEO',
    thumbnail_url: 'https://cdn/thumb.jpg',
    permalink: 'https://instagram.com/reel/Dbm6fquPe6o',
  });
  t('media_url 없는 VIDEO 를 버리지 않고 재조회 대상으로 남긴다',
    Array.isArray(post.videoResolveIds) && post.videoResolveIds[0] === '17958892404191497',
    '여기서 놓치면 이후 어느 단계도 mp4 를 되찾을 수 없다');
  t('썸네일은 그대로 이미지로 쓴다 (기사 자체는 성립해야 한다)',
    post.mediaUrls[0] === 'https://cdn/thumb.jpg');
  t('videoUrls 는 아직 비어 있다', post.videoUrls.length === 0);
})();
(function () {
  const post = ig.normalizeMedia({
    id: 'x', media_type: 'VIDEO',
    media_url: 'https://cdn/reel.mp4', thumbnail_url: 'https://cdn/t.jpg',
  });
  t('media_url 이 정상으로 오면 재조회하지 않는다',
    post.videoUrls[0] === 'https://cdn/reel.mp4' && post.videoResolveIds.length === 0,
    '멀쩡한 응답까지 단건 재조회하면 Graph API 호출이 배로 늘어난다');
})();
(function () {
  // 캐러셀 안의 영상도 같은 구멍을 갖는다 — 자식 id 가 있어야 재조회가 가능하다.
  const post = ig.normalizeMedia({
    id: 'album', media_type: 'CAROUSEL_ALBUM',
    children: { data: [
      { id: 'c1', media_type: 'IMAGE', media_url: 'https://cdn/1.jpg' },
      { id: 'c2', media_type: 'VIDEO', thumbnail_url: 'https://cdn/2.jpg' },
    ] },
  });
  t('캐러셀 자식 영상도 재조회 대상으로 잡는다', post.videoResolveIds[0] === 'c2');
  t('자식 조회가 id 를 함께 요청한다', /children\{id,/.test(R('api/_lib/instagramImport.js')),
    'id 가 없으면 자식 영상은 재조회 자체가 불가능하다');
})();

console.log('=== resolveVideoUrls — 단건 재조회 ===');
await (async function () {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return fakeResponse({ json: { id: 'v1', media_type: 'VIDEO', media_url: 'https://cdn/recovered.mp4' } });
  };
  const post = { videoUrls: [], videoResolveIds: ['v1'] };
  const stat = await ig.resolveVideoUrls(post, { token: 'T', userId: 'U' });
  {
    t('media_url 을 회수해 videoUrls 에 채운다',
      post.videoUrls[0] === 'https://cdn/recovered.mp4' && stat.resolved === 1);
    t('회수한 id 는 비워 둔다 (두 번 호출해도 중복 수집 없음)', post.videoResolveIds.length === 0);
    t('media_url 을 명시적으로 요청한다', /fields=[^&]*media_url/.test(calls[0]));
  }
})();

console.log('=== archiveVideosToStorage — 실패를 삼키지 않는다 ===');
await (async function () {
  global.fetch = async () => fakeResponse({ contentType: 'video/mp4', length: 3 });
  const report = {};
  const urls = await ig.archiveVideosToStorage({ id: 'p1', videoUrls: ['https://cdn/a.mp4'] }, 2, undefined, report);
  t('정상 경로: Storage 로 복사하고 공개 URL 을 돌려준다',
    urls.length === 1 && /v0\.mp4$/.test(urls[0]), JSON.stringify(urls));
  t('report 에 시도·성공 수가 남는다', report.attempted === 1 && report.succeeded === 1);
})();
await (async function () {
  global.fetch = async () => fakeResponse({ ok: false, status: 403, text: 'expired' });
  const report = {};
  const urls = await ig.archiveVideosToStorage({ id: 'p2', videoUrls: ['https://cdn/b.mp4'] }, 2, undefined, report);
  t('다운로드 실패는 report.failures 로 밖에 알린다',
    urls.length === 0 && report.attempted === 1 && report.failures.length === 1,
    '"URL 이 0개" 와 "받다가 실패" 를 구분하지 못해 videos:[] 기사가 정상처럼 발행됐다');
  t('실패 사유에 상태코드가 남는다', report.failures.length === 1 && /403/.test(report.failures[0].reason));
})();
await (async function () {
  const report = {};
  await ig.archiveVideosToStorage({ id: 'p3', videoUrls: [] }, 2, undefined, report);
  t('영상 URL 자체가 0개면 attempted=0 으로 구분된다',
    report.attempted === 0 && report.failures.length === 0);
  global.fetch = realFetch;
})();

console.log('=== 수집 크론 결선 (sync-instagram) ===');
(function () {
  const s = R('api/cron/sync-instagram.js');
  const iResolve = s.indexOf('await resolveVideoUrls(post');
  const iArchive = s.indexOf('await archiveVideosToStorage(post');
  t('재조회를 아카이브보다 먼저 부른다', iResolve > -1 && iArchive > iResolve,
    `resolve@${iResolve} archive@${iArchive} — 순서가 뒤집히면 재조회가 무의미하다`);
  t('릴스인데 mp4 를 못 건지면 반드시 로그를 남긴다',
    /post\.mediaType === 'VIDEO' && !videoUrls\.length/.test(s) && /릴스 mp4 수집 실패/.test(s),
    '조용히 넘어가면 "발행은 됐는데 쇼츠는 안 올라가는" 상태가 다시 만들어진다');
  t('결과 집계에 video_missing 을 센다', /video_missing/.test(s));
})();

console.log('=== ② 복구 크론 (video-repair) ===');
const repair = require('../api/cron/video-repair');
(function () {
  const rows = [
    { id: 'a', videos: [],                 source_instagram_post_id: '1' },
    { id: 'b', videos: null,               source_instagram_post_id: '2' },
    { id: 'c', videos: ['https://x/1.mp4'], source_instagram_post_id: '3' },
    { id: 'd', videos: [],                 source_instagram_post_id: null },
  ];
  const got = repair.pickRepairTargets(rows).map((r) => r.id);
  t('videos=[] 와 videos=null 을 둘 다 잡는다', got.includes('a') && got.includes('b'),
    'DB 에 두 형태가 섞여 있어 한쪽만 보면 절반을 놓친다');
  t('이미 mp4 가 있는 기사는 건드리지 않는다', !got.includes('c'));
  t('IG post id 가 없으면 손댈 방법이 없으므로 건너뛴다', !got.includes('d'));
})();
(function () {
  const rows = [
    { id: 'gone', videos: [], source_instagram_post_id: '1' },
    { id: 'ok',   videos: [], source_instagram_post_id: '2' },
  ];
  const skip = { gone: repair.MAX_FAILS };
  const got = repair.pickRepairTargets(rows, { skip }).map((r) => r.id);
  t('반복 실패한 기사는 포기한다 (원본 삭제·비공개)', !got.includes('gone') && got.includes('ok'),
    '매 시간 같은 기사를 두드리면 Graph API 호출만 태운다');
  const partial = repair.pickRepairTargets(rows, { skip: { gone: repair.MAX_FAILS - 1 } }).map((r) => r.id);
  t('아직 한도 전이면 계속 시도한다', partial.includes('gone'));
})();
(function () {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, videos: [], source_instagram_post_id: String(i) }));
  t('한 번에 고칠 수를 제한한다 (서버리스 시간 한도)', repair.pickRepairTargets(many).length === 5);
  t('limit 상한은 20', repair.pickRepairTargets(many, { limit: 999 }).length === 20);
})();
(function () {
  const s = R('api/cron/video-repair.js');
  t('복구 후 유튜브 크론을 즉시 깨운다', /cron\/youtube-post/.test(s),
    '신선도 창(3일)을 넘기면 복구해도 업로드되지 않는다');
  t('dry-run 으로 대상만 확인할 수 있다', /dry/.test(s));
  t('실행기록·실패알림이 붙어 있다', /module\.exports = withCronGuard\('video-repair'/.test(s));

  /* 2026-08-04: 수집 버그로 5일간 mp4 가 비었다. 복구된 시점엔 이미 3일 창
     밖이라 "고쳤는데 여전히 안 올라간다" 가 된다. 복구 경로만 창을 넓힌다. */
  t('복구 직후엔 넓힌 신선도 창으로 깨운다', /youtube-post\?days=' \+ WAKE_DAYS/.test(s),
    '복구했는데 창 밖이라 영영 못 올라가는 구멍');
  t('넓힌 창은 상수로 고정 (기본 3일은 그대로)', /const WAKE_DAYS = 7;/.test(s));

  const y = R('api/cron/youtube-post.js');
  t('youtube-post 가 ?days 를 받는다', /req\.query && req\.query\.days/.test(y));
  t('기본값은 여전히 3일', /\|\| 3\) \|\| 3\)/.test(y),
    '기본을 넓히면 옛 릴스가 밀려 올라와 쇼츠의 신선도가 깨진다');
  t('days 는 1~14 로 묶는다', /Math\.max\(1, Math\.min\(14,/.test(y),
    '창이 무한히 열리면 아카이브 백필 전체가 후보가 된다');
  t('빈 결과 메모에 실제 창 길이를 남긴다', /최근 ' \+ freshDays \+ '일/.test(y),
    '어느 창으로 훑었는지 모르면 로그만 보고 판단할 수 없다');
})();
(function () {
  const v = JSON.parse(R('vercel.json'));
  const paths = (v.crons || []).map((c) => c.path);
  t('vercel.json 에 복구 크론이 등록돼 있다', paths.some((p) => p.indexOf('/api/cron/video-repair') === 0),
    '파일만 있고 스케줄이 없으면 아무도 부르지 않는다');
})();

console.log('=== ③ 침묵 감지 (pipeline-watch) ===');
const watch = require('../api/cron/pipeline-watch');
const { judgeReelHealth, buildReelAlert } = watch;
(function () {
  // 07-31~08-04 실제 상황: 릴스 기사는 들어오는데 전부 mp4 가 없다.
  const d = judgeReelHealth({ videoArticles: 6, withVideo: 0, uploadsInWindow: 0, zeroRuns: 400, runsInWindow: 400 });
  t('릴스 기사가 전부 mp4 없이 발행되면 고장으로 본다', d.healthy === false && d.cause === 'mp4-missing');
  t('사유에 건수를 밝힌다', /6건/.test(d.reason), d.reason);
})();
(function () {
  // mp4 는 있는데 업로드가 0 — 수집이 아니라 게시 쪽 문제다. 문안이 달라야 한다.
  const d = judgeReelHealth({ videoArticles: 4, withVideo: 4, uploadsInWindow: 0, zeroRuns: 200, runsInWindow: 200 });
  t('연료는 있는데 안 올라가면 다른 원인으로 구분한다', d.healthy === false && d.cause === 'candidates-ignored');
})();
(function () {
  // 오탐 방지 — 릴스를 정말 안 올린 기간에 울리면 알림 신뢰가 깎인다.
  const d = judgeReelHealth({ videoArticles: 0, withVideo: 0, uploadsInWindow: 0, zeroRuns: 300, runsInWindow: 300 });
  t('릴스 자체가 0건이면 판단을 보류한다 (정상)', d.healthy === true && d.cause === null,
    '릴스를 안 올린 주말마다 알림이 오면 아무도 안 보게 된다');
})();
(function () {
  const d = judgeReelHealth({ videoArticles: 5, withVideo: 5, uploadsInWindow: 3, zeroRuns: 100, runsInWindow: 120 });
  t('정상 가동은 조용하다', d.healthy === true && d.cause === null);
  const d2 = judgeReelHealth({ videoArticles: 5, withVideo: 2, uploadsInWindow: 0, zeroRuns: 1, runsInWindow: 2 });
  t('실행 표본이 적으면 성급히 울리지 않는다', d2.healthy === true, JSON.stringify(d2));
})();
(function () {
  const a = buildReelAlert(judgeReelHealth({ videoArticles: 6, withVideo: 0, uploadsInWindow: 0, zeroRuns: 400, runsInWindow: 400 }));
  const body = a.lines.join(' ');
  t('알림 제목에 무엇이 멈췄는지 적는다', /쇼츠/.test(a.title));
  t('원인 후보를 함께 적는다', /media_url|토큰|60MB/.test(body),
    '알림만 받고 어디를 볼지 모르면 무용지물이다');
  t('자동 복구 수단을 안내한다', /video-repair/.test(body));
  t('사업 영향을 한 줄로 밝힌다', /유입/.test(body));
  const b = buildReelAlert(judgeReelHealth({ videoArticles: 4, withVideo: 4, uploadsInWindow: 0, zeroRuns: 200, runsInWindow: 200 }));
  t('원인이 다르면 안내 문안도 다르다', /신선도|중복|YOUTUBE_PUBLIC/.test(b.lines.join(' ')));
})();
/* 복구 순서 회귀 (2026-08-04) ─────────────────────────────────────────
 * created_at 은 '언제 우리 DB 에 들어왔나', published_date 는 '언제 세상에
 * 나갔나' 다. 아카이브 기사를 나중에 일괄 수입하면 created_at 이 최신이 되어
 * 복구 예산(기본 5건)을 옛 기사가 먼저 먹는다. 실제로 5칸 중 2칸을 2023·2024년
 * 기사가 차지했고 그중 하나는 원본이 사라져 어차피 못 고치는 건이었다.
 * 쇼츠에는 신선도 창이 있으므로 최근 기사를 먼저 손봐야 복구가 값을 한다. */
(function () {
  const v = R('api/cron/video-repair.js');
  t('발행일 기준으로 최근 기사를 먼저 고른다', /\.gte\('published_date', cutoff\)/.test(v));
  t('정렬도 발행일 기준', /\.order\('published_date', \{ ascending: false \}\)/.test(v));
  t('수집 시각으로 자르던 옛 코드가 남아 있지 않다',
    v.indexOf(".gte('created_at', cutoff)") === -1,
    'created_at 으로 자르면 아카이브 일괄 수입 때 최근 기사가 밀린다');
  t('예산이 남을 때만 아카이브까지 내려간다', /targets\.length < limit/.test(v));
  t('발행일이 빈 행도 아카이브 쪽에서 줍는다', /published_date\.is\.null/.test(v));
  t('두 조회가 같은 기사를 두 번 세지 않는다', /new Set\(targets\.map/.test(v));
})();

(function () {
  const w = R('api/cron/pipeline-watch.js');
  t('감시 크론이 릴스 점검을 호출한다', /checkReelVideos\(/.test(w));
  t('알림 키를 다른 감시와 분리', /REEL_ALERT_KEY\s*=\s*'reel-video-health'/.test(w),
    '한쪽 쿨다운이 다른 쪽 알림을 삼키면 안 된다');
  t('복구되면 정상화 알림도 보낸다', /정상화/.test(w));
  t('릴스 점검 실패가 본 크론을 죽이지 않는다', /reel video health 실패/.test(w));
})();

/* ─────────────────────────────────────────────────────────────────────
   ④ 영구 실패와 일시 실패를 가른다 (2026-08-05 추가)

   Graph 는 인스타 음원(라이선스 음악)을 얹은 릴스에 media_url 을 아예 주지
   않는다. 다시 물어도 답이 같으므로 재시도는 순수한 낭비다. 그런데 예전
   코드는 이 경우를 네트워크 오류와 똑같이 세어 MAX_FAILS(3)를 다 태웠고,
   남는 기록은 '재조회 0/1' 뿐이라 왜 포기했는지 설명할 수 없었다.
   실측 5건(아더에러·청하·프라다·규진 공항·규진 베이델리)이 전부 이 경우.

   여기서 잠그는 것: ① 영구/일시 판정이 뒤집히지 않는다 ② 영구는 즉시
   포기한다 ③ 사유가 저장된다 ④ 복구되면 사유도 지워진다.
   ───────────────────────────────────────────────────────────────────── */
console.log('=== ④ 영구 실패 구분 (2026-08-05) ===');
(function () {
  const c = repair.classifyMissingVideo;

  const denied = c({ mediaType: 'VIDEO' }, { attempted: 1, resolved: 0, failed: 1 });
  t('재조회에도 media_url 이 없으면 영구로 본다',
    denied.permanent === true && denied.reason === 'media_url_denied', JSON.stringify(denied));
  t('영구 사유에 인스타 음원 맥락을 남긴다', /음원/.test(denied.message), denied.message);

  const none = c({ mediaType: 'IMAGE' }, { attempted: 0, resolved: 0 });
  t('영상 후보가 아예 없으면 not_video',
    none.permanent === true && none.reason === 'not_video', JSON.stringify(none));

  const noneVid = c({ mediaType: 'VIDEO' }, { attempted: 0, resolved: 0 });
  t('VIDEO 인데 후보가 없는 건 따로 표시한다',
    noneVid.reason === 'video_without_source', JSON.stringify(noneVid));

  const partial = c({ mediaType: 'CAROUSEL_ALBUM' }, { attempted: 2, resolved: 1 });
  t('일부라도 회수되면 일시 실패로 남겨 다시 시도한다',
    partial.permanent === false, JSON.stringify(partial));

  t('stat 이 없어도 죽지 않는다', c({}, undefined).permanent === true);

  const s = R('api/cron/video-repair.js');
  t('영구 실패는 재시도를 태우지 않고 즉시 포기한다', /fails\[t\.id\] = MAX_FAILS;/.test(s),
    '3회를 기다리면 사흘간 헛되이 Graph 를 두드린다');
  t('포기 사유를 기록한다', /reasons\[t\.id\] = \{/.test(s));
  t('사유를 실패 횟수와 같은 레코드에 저장한다', /saveSkip\(fails, reasons\)/.test(s));
  t('복구되면 사유 기록도 함께 지운다', /delete reasons\[t\.id\];/.test(s));
  t('요약에 영구 포기 건수를 드러낸다', /영구 포기 ' \+ results\.permanent/.test(s),
    '조용히 포기하면 8일 침묵이 재발한다');
  t('reset 은 사유까지 비운다', /saveSkip\(\{\}, \{\}\)/.test(s));
})();

/* ⑤ backfill-video 의 '영상이 없음' 을 두 원인으로 가른다 (2026-08-05) */
(function () {
  const f = require('../api/admin/articles/backfill-video').classifyBackfillMiss;
  t('이미지 게시물은 not_video', f({ media_type: 'IMAGE' }).reason === 'not_video');
  t('영상인데 media_url 이 없으면 media_url_missing',
    f({ media_type: 'VIDEO' }).reason === 'media_url_missing');
  t('캐러셀 안의 영상도 media_url_missing 으로 본다',
    f({ media_type: 'CAROUSEL_ALBUM', children: { data: [{ media_type: 'IMAGE' }, { media_type: 'VIDEO' }] } })
      .reason === 'media_url_missing');
  t('안내 문구가 원인별로 다르다',
    f({ media_type: 'IMAGE' }).note !== f({ media_type: 'VIDEO' }).note);
  t('원인이 응답에 실린다', /reason: why\.reason/.test(R('api/admin/articles/backfill-video.js')));
})();

}

main().then(() => {
  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ reel-video-recovery tests FAILED'); process.exit(1); }
  console.log('✅ reel-video-recovery tests passed');
}).catch((e) => { console.log('❌ reel-video-recovery tests CRASHED'); console.error(e); process.exit(1); });
