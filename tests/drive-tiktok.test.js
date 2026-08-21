/**
 * 드라이브 영상 → 틱톡 + 유튜브 영상 생존 감시 (2026-08-07 신설)
 *
 * 틱톡 경로가 유튜브와 다른 점: Buffer 는 파일 업로드를 안 받고 **공개 HTTPS
 * 직링크**만 받는다. 드라이브 링크는 로그인을 요구하므로 우리 스토리지를
 * 한 단계 거쳐야 한다. 그 중계가 이 파일의 주된 검증 대상이다.
 *
 * 그리고 오늘 겪은 사고 두 개를 여기서도 못박는다:
 *   ① upsert 오류 무시 → 같은 영상 2회 공개 게시 (유튜브에서 실제 발생)
 *   ② 부분 유니크 인덱스 → PostgREST onConflict 가 못 씀
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
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('instagramImport.js', { listRecentMedia: async () => [], isLikelyEditorialCaption: () => false, _extractShortcode: () => null });
stub('backfillHealth.js', { diagnoseBackfill: () => ({}), buildBackfillAlert: () => ({}) });
stub('translateHealth.js', { judgeTranslateHealth: () => ({}), buildTranslateAlert: () => ({}) });
stub('faqHealth.js', { judgeFaqHealth: () => ({}), buildFaqAlert: () => ({}), summarizeFaqRuns: () => ({}) });
stub('cronDurationHealth.js', { summarizeDurations: () => ({}), judgeCronDuration: () => ({}), buildCronDurationAlert: () => ({}) });
stub('youtube.js', { uploadVideo: async () => ({ id: 'x' }), getAccessToken: async () => 't', fetchVideoStates: async () => new Map() });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const tk = require(path.join(ROOT, 'api', 'cron', 'drive-tiktok-post.js'));
const bufferLib = require(path.join(ROOT, 'api', '_lib', 'buffer.js'));
const watch = require(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'));
const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'drive-tiktok-post.js'), 'utf8');
const bsrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'buffer.js'), 'utf8');

console.log('\n[1] 캡션 — 틱톡 2200자 상한');
t('CAPTION_MAX 는 2200', tk.CAPTION_MAX === 2200);
const cap = tk.buildCaption({ title: '가'.repeat(400), content: '<p>첫 문장입니다. 두번째.</p>', slug: 'x'.repeat(300), tags: Array.from({length: 30}, (_, i) => 'tag' + i) });
t('아무리 길어도 2200자 이하', cap.length <= 2200, cap.length);
const c2 = tk.buildCaption({ title: '아더에러와 버켄스탁', content: '<p>실로 이었다. 다음.</p>', slug: 'ader', custom_url: 'ader-birk', tags: ['adererror', 'birkenstock'] });
t('기사 URL 이 들어간다', c2.indexOf('pap-magazine.com/article/ader-birk') !== -1, c2);
t('해시태그는 5개 이하', (c2.match(/#[^\s#]+/g) || []).length <= 5, c2.match(/#[^\s#]+/g));
t('줄바꿈 대신 공백 두 칸으로 잇는다 (틱톡이 \\n 을 뭉갠다)', c2.indexOf('\n') === -1);

console.log('\n[2] Buffer 영상 게시 — 공개 직링크만 받는다');
t('createVideoPost 가 있다', typeof bufferLib.createVideoPost === 'function');
// createVideoPost 는 async 다 — 동기 try/catch 로는 못 잡는다.
// (테스트가 '안 던진다'고 착각하면 검증이 거짓말을 한다)
const rejects = async (fn, re) => {
  try { await fn(); return false; } catch (e) { return re.test(String(e && e.message)); }
};
const pending = [];
pending.push(rejects(() => bufferLib.createVideoPost({ channelId: 'c', text: 'x' }), /videoUrl 없음/)
  .then((r) => t('videoUrl 없으면 거부', r)));
pending.push(rejects(() => bufferLib.createVideoPost({ channelId: 'c', videoUrl: 'http://a/b.mp4' }), /공개 HTTPS/)
  .then((r) => t('http(비보안)·상대경로는 거부', r)));
pending.push(rejects(() => bufferLib.createVideoPost({ videoUrl: 'https://a/b.mp4' }), /channelId 없음/)
  .then((r) => t('channelId 없으면 거부', r)));
t('영상도 automatic 고정 (notification 이면 손으로 올려야 한다)', /schedulingType: 'automatic'/.test(bsrc) && bsrc.indexOf("'notification'") === -1);
// 2026-08-07 첫 실게시에서 막힌 지점. 구체 오류 타입을 직접 펼치면 Buffer 가
// 스키마 검증에서 거부한다("can never be of type VoidMutationError").
// 문서 본문의 타입 나열을 믿고 썼다가 틀렸고, 가이드 예제가 정답이었다.
t('오류는 인터페이스 MutationError 로 받는다', /\.\.\. on MutationError \{ message \}/.test(bsrc));
t('구체 오류 타입을 직접 펼치지 않는다', bsrc.indexOf('on VoidMutationError') === -1 && bsrc.indexOf('on RestProxyError') === -1);
t('성공 조각은 PostActionSuccess', /\.\.\. on PostActionSuccess \{ post \{/.test(bsrc));

console.log('\n[3] 스토리지 중계 — 드라이브 링크는 Buffer 가 못 읽는다');
t('media 버킷(공개)에 올린다', /storage\.from\('media'\)/.test(src));
t('공개 URL 을 받아 쓴다', /getPublicUrl/.test(src));
t('업로드 실패를 삼키지 않는다', /스토리지 업로드 실패/.test(src));
t('공개 URL 이 없으면 실패로 본다', /스토리지 공개 URL 없음/.test(src));
t('파일명을 안전한 문자로 정규화한다 (한글 경로 사고 방지)', /replace\(\/\[\^A-Za-z0-9\._-\]\/g/.test(src));
t('드라이브 파일 id 로 경로를 나눠 충돌을 막는다', /STORAGE_DIR \+ '\/' \+ fileId/.test(src));

console.log('\n[4] ⭐️ 오늘의 사고 재발 방지');
t('기록 실패를 확인한다', /const rec = await finishClaim\(/.test(src) && /if \(!rec\.ok\)/.test(src));
/* 휴닝카이가 두 번 올라간 그 사고. 순서를 코드에 못박는다. */
t('올리기 전에 자리를 찜한다',
  src.indexOf('claimDriveFile(') > 0 && src.indexOf('claimDriveFile(') < src.indexOf('createVideoPost('));
t('찜에 실패하면 게시하지 않는다', /if \(!claim\.ok\)[\s\S]{0,200}return res/.test(src));
t('기록 실패는 500 으로 떨어진다', /error: 'record failed'/.test(src));
t('문구가 중복 게시 위험을 말한다', /반복 게시될 수 있음/.test(src));
t('마이그레이션 109 는 부분 인덱스를 쓰지 않는다 (107 의 실수)', (() => {
  const m = fs.readFileSync(path.join(ROOT, 'supabase_migrations', '109_tiktok_posts_drive_file.sql'), 'utf8');
  const after = (m.split('create unique index')[1] || '');
  return /\(drive_file_id\)/.test(after) && !/where/i.test(after);
})());
const rets = [];
for (let i = src.indexOf('return res.status(200).json('); i !== -1; i = src.indexOf('return res.status(200).json(', i + 1)) {
  const end = src.indexOf('});', i);
  rets.push(src.slice(i, end === -1 ? i + 500 : end + 3));
}
t('200 반환이 여러 갈래', rets.length >= 4, rets.length);
t('모든 200 반환이 note(res,…) 를 통과한다', rets.every((r) => r.indexOf('note(res,') !== -1),
  rets.filter((r) => r.indexOf('note(res,') === -1).map((r) => r.slice(0, 70)));

console.log('\n[5] 매칭·제외는 유튜브와 같은 규칙을 쓴다');
t('koMatch 를 공유한다 (규칙이 두 벌이 되면 갈라진다)', /require\('\.\.\/_lib\/koMatch'\)/.test(src));
t('driveVideos 의 제외 규칙을 공유한다', /drive\.shouldSkip/.test(src));
t("틱톡 크론이 자기 채널을 넘긴다 (유튜브 전용 제외에 안 걸리게)",
  /shouldSkip\(f\.name, null, 'tiktok'\)/.test(src));
t('상한 100MB', /MAX_BYTES = 100 \* 1024 \* 1024/.test(src));
t('크론이 vercel.json 에 등록됨',
  (require(path.join(ROOT, 'vercel.json')).crons || []).some((c) => c.path === '/api/cron/drive-tiktok-post'));
t('유튜브 크론과 시간이 겹치지 않는다 (같은 함수 상한을 동시에 밀지 않게)', (() => {
  const c = require(path.join(ROOT, 'vercel.json')).crons || [];
  const y = c.find((x) => x.path === '/api/cron/drive-youtube-post');
  const k = c.find((x) => x.path === '/api/cron/drive-tiktok-post');
  return y && k && y.schedule !== k.schedule;
})());

console.log('\n[6] 유튜브 영상 생존 감시 — 게시는 끝이 아니라 시작이다');
const J = watch.judgeVideoStates;
const rows = [{ video_id: 'a' }, { video_id: 'b' }];
const okStates = new Map([['a', { privacyStatus: 'public', uploadStatus: 'processed' }], ['b', { privacyStatus: 'public' }]]);
t('전부 공개면 정상', J(rows, okStates).healthy === true);
t('응답에 없는 영상은 사라진 것', J(rows, new Map([['a', { privacyStatus: 'public' }]])).bad[0].cause === 'gone');
t('비공개로 바뀌면 잡는다', J(rows, new Map([['a', { privacyStatus: 'public' }], ['b', { privacyStatus: 'private' }]])).bad[0].cause === 'private');
t('거부(저작권 등)를 잡는다', J([{ video_id: 'a' }], new Map([['a', { privacyStatus: 'public', rejectionReason: 'copyright' }]])).bad[0].cause === 'rejected');
t('거부가 비공개보다 먼저 (더 근본 원인)',
  J([{ video_id: 'a' }], new Map([['a', { privacyStatus: 'private', rejectionReason: 'copyright' }]])).bad[0].cause === 'rejected');
t('처리 실패를 잡는다', J([{ video_id: 'a' }], new Map([['a', { failureReason: 'conversion' }]])).bad[0].cause === 'failed');
t('영상이 없으면 판단하지 않는다', J([], new Map()).healthy === true && J([], new Map()).checked === 0);
const va = watch.buildVideoStateAlert(J(rows, new Map()), 'https://x.test');
t('알림이 Studio 확인을 안내한다', /YouTube Studio/.test(va.lines.join(' ')), va.lines);
t('알림에 영상 id 가 들어간다', /a : /.test(va.lines.join(' ')));

console.log('\n[7] 감시 배선 + 스코프');
const wsrc = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'), 'utf8');
t('핸들러가 checkYouTubeVideos 를 호출한다', /const ytVideos = await checkYouTubeVideos\(/.test(wsrc));
t('응답에 ytVideos 가 실린다', /res\.status\(200\)\.json\(\{ ok: true[^}]*\bytVideos\b/.test(wsrc));
t('알림 키가 분리돼 있다', /YT_VIDEO_ALERT_KEY = 'youtube-video-health'/.test(wsrc));
t('스코프가 없으면 고장으로 울리지 않는다 (재인증 전 오경보 방지)', /skipped: true/.test(wsrc));
const ysrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'youtube.js'), 'utf8');
t('youtube.readonly 스코프가 추가됐다', /youtube\.readonly/.test(ysrc));
t('403 을 재인증 안내로 바꾼다', /youtube\.readonly 가 없습니다/.test(ysrc));
t('50개씩 나눠 묻는다 (videos.list 상한)', /slice\(i, i \+ 50\)/.test(ysrc));

/* ── 틱톡 읽기 스코프 (2026-08-21) ────────────────────────────────
   스토리 전용 영상은 웹 기사가 없어 유튜브 쇼츠 제목을 만들 데가 없다.
   같은 영상이 틱톡에 올라가 있고 거기엔 사람이 쓴 캡션이 있으므로,
   그 캡션을 제목의 원천으로 쓴다(첫 프레임 AI 추측보다 정확·무료).
   여기서 지키는 것: ① 스코프가 실제로 늘어났는가 ② 캡션 필드를 한쪽만
   보지 않는가 ③ 실패 사유를 뭉개지 않는가(스코프 미승인 vs 네트워크). */
console.log('\n[틱톡 읽기 스코프 · 캡션 원천]');
{
  const tsrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'tiktok.js'), 'utf8');

  /* 2026-08-21 — video.list 를 기본 스코프에 넣었더니 인증 화면이
     non_sandbox_target 으로 죽었다. 되던 값을 기본으로 되돌리고 env 로 연다.
     여기서 지키는 핵심: **쓰지도 못하는 권한 때문에 되던 인증을 막지 않는다.**
     리프레시가 깨져 재인증이 필요한 날 기본 스코프가 인증 불가면 게시가 통째로 멈춘다. */
  t('기본 스코프는 실제로 인증되던 값이다 (video.list 없음)',
    /TIKTOK_SCOPES \|\| 'user\.info\.basic,video\.publish'/.test(tsrc));
  t('기본값에 video.list 를 넣지 않았다',
    !/\|\| 'user\.info\.basic,video\.publish,video\.list'/.test(tsrc));
  t('env 로 켤 수 있다', /process\.env\.TIKTOK_SCOPES/.test(tsrc));
  t('non_sandbox_target 사고를 코드 옆에 적어 뒀다',
    /non_sandbox_target/.test(tsrc));
  t('추정임을 명시했다 (콘솔 확인 전까지 단정하지 않는다)',
    /이건 추정이다/.test(tsrc));
  t('env 를 바꾸면 재배포해야 한다는 것도 적어 뒀다', /재배포/.test(tsrc));

  t('내 영상 목록 함수를 내보낸다', /listMyVideos/.test(tsrc));
  t('video\\/list 엔드포인트를 부른다', /\/video\/list\//.test(tsrc));
  t('title 과 video_description 을 둘 다 요청한다',
    /fields\s*=\s*'[^']*title[^']*video_description/.test(tsrc));

  /* 캡션이 어느 필드에 들어오는지 계정·버전마다 다르다는 보고가 있다.
     한쪽만 보면 어떤 계정에서는 제목이 통째로 빈다. */
  const tk = (() => { try { return require(path.join(ROOT, 'api', '_lib', 'tiktok.js')); }
                      catch (e) { return null; } })();
  if (tk && typeof tk.captionOf === 'function') {
    t('captionOf: title 이 있으면 title', tk.captionOf({ title: 'A' }) === 'A');
    t('captionOf: title 이 비면 video_description',
      tk.captionOf({ title: '  ', video_description: 'B' }) === 'B');
    t('captionOf: 둘 다 없으면 빈 문자열', tk.captionOf({}) === '');
    t('captionOf: null 도 죽지 않는다', tk.captionOf(null) === '');
  } else {
    t('captionOf 를 불러올 수 있다', false, 'require 실패');
  }

  t('실패 사유를 그대로 올린다 (권한 없음과 네트워크 오류를 구분해야 한다)',
    /video\.list 실패 \(/.test(tsrc));
  t('요청 건수에 상한이 있다 (한 번에 20건)', /Math\.min\(20,/.test(tsrc));
}

Promise.all(pending).then(() => {
  console.log('\n' + (fail ? '❌' : '✅') + ` ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
});
