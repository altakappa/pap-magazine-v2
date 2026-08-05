/**
 * 유튜브 영상 실제 상태 진단 — tests/youtube-video-state.test.js (2026-08-05 신설)
 *
 * 무슨 일이 있었나 ────────────────────────────────────────────────────
 * youtube_posts 에는 52건이 'submitted' 로 남아 있는데, 그중 28건은 공개
 * URL 로 열리지 않았다. 우리 DB 는 그 이유를 한 글자도 모른다 — detail 이
 * 전부 null 이고, 'submitted' 는 업로드 요청이 200 을 받았다는 뜻일 뿐이다.
 *
 * '아마 음원 저작권 때문일 것' 은 추측이다. 추측을 사실로 바꾸려면 유튜브에
 * 직접 물어야 한다: videos.list 의 privacyStatus / uploadStatus /
 * rejectionReason / regionRestriction.blocked 네 값이 답을 확정한다.
 *
 * 이 테스트가 지키는 것 ───────────────────────────────────────────────
 *   ① 판정 규칙 — 안 보이는 영상을 원인별로 가른다 (거절/비공개/삭제/지역차단)
 *   ② 침묵 금지 — 유튜브가 돌려주지 않은 id 를 빈칸이 아니라 'missing' 으로 센다
 *   ③ 배선 — 진단 엔드포인트에 ?videos=1 모드가 실제로 걸려 있다
 *
 * Run with `node tests/youtube-video-state.test.js` (npm test 에 연결됨).
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
function section(s) { console.log('\n=== ' + s + ' ==='); }

// DB·인증은 스텁 — 순수 판정 로직만 본다 (reel-video-recovery.test.js 와 같은 방식).
function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('cors.js', { handleCors: () => false });

const diag = require('../api/admin/youtube-diagnose');
const summarize = diag.summarizeVideoStates;

section('① 원인별 판정');
{
  const items = [
    { id: 'ok1', status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true },
      snippet: { title: '정상 영상' }, contentDetails: {} },
    { id: 'priv1', status: { privacyStatus: 'private', uploadStatus: 'processed' },
      snippet: { title: '비공개' }, contentDetails: {} },
    { id: 'rej1', status: { privacyStatus: 'public', uploadStatus: 'rejected', rejectionReason: 'copyright' },
      snippet: { title: '저작권 거절' }, contentDetails: { licensedContent: true } },
    { id: 'geo1', status: { privacyStatus: 'public', uploadStatus: 'processed' },
      snippet: { title: '지역 차단' }, contentDetails: { regionRestriction: { blocked: ['KR', 'JP'] } } },
  ];
  const ids = ['ok1', 'priv1', 'rej1', 'geo1', 'gone1'];
  const out = summarize(items, ids);
  const by = Object.fromEntries(out.rows.map((r) => [r.video_id, r]));

  t('물어본 개수를 그대로 센다', out.requested === 5);
  t('정상 영상은 사유가 없다', by.ok1.why === null && by.ok1.privacy === 'public');
  t('비공개는 공개 상태를 사유로 남긴다', /비공개|private/.test(by.priv1.why || ''), by.priv1.why);
  t('거절은 거절 사유를 그대로 보여준다', /copyright/.test(by.rej1.why || ''), by.rej1.why);
  t('거절이 다른 사유보다 먼저다', by.rej1.why.indexOf('거절') >= 0);
  t('지역 차단은 Content ID 가능성을 짚는다', /Content ID/.test(by.geo1.why || ''), by.geo1.why);
  t('차단 국가 수를 센다', by.geo1.blocked_regions === 2);
  t('licensedContent 를 그대로 싣는다', by.rej1.licensed_content === true && by.ok1.licensed_content === false);
}

section('② 침묵 금지 — 돌아오지 않은 id');
{
  const out = summarize([], ['a', 'b']);
  t('유튜브가 안 준 id 도 행으로 남는다', out.rows.length === 2);
  t('found=false 로 명시한다', out.rows.every((r) => r.found === false));
  t('missing 으로 센다', out.counts.missing === 2);
  t('사유에 삭제/다른 채널 가능성을 적는다', /삭제/.test(out.rows[0].why));
  t('문제 건수에 포함된다', out.problems === 2);
  t('items 가 null 이어도 죽지 않는다', summarize(null, ['x']).counts.missing === 1);
  t('id 목록이 비면 0건', summarize([], []).requested === 0);
}

section('③ 집계');
{
  const items = [
    { id: 'a', status: { privacyStatus: 'public', uploadStatus: 'processed' }, contentDetails: {} },
    { id: 'b', status: { privacyStatus: 'unlisted', uploadStatus: 'processed' }, contentDetails: {} },
    { id: 'c', status: { privacyStatus: 'private', uploadStatus: 'failed', failureReason: 'codec' }, contentDetails: {} },
  ];
  const out = summarize(items, ['a', 'b', 'c']);
  t('공개/일부공개/비공개를 따로 센다',
    out.counts.public === 1 && out.counts.unlisted === 1 && out.counts.private === 1,
    JSON.stringify(out.counts));
  t('업로드 실패도 따로 센다', out.counts.failed === 1);
  t('공개가 아닌 건 전부 문제로 잡는다', out.problems === 2);
}

section('④ 배선');
{
  const src = R('api/admin/youtube-diagnose.js');
  t('?videos=1 모드가 있다', /req\.query && req\.query\.videos/.test(src));
  t('유튜브에 직접 묻는다', /youtube\/v3\/videos/.test(src));
  t('원인 판정에 필요한 part 를 모두 요청한다',
    /status/.test(src) && /contentDetails/.test(src) && /processingDetails/.test(src));
  t('채널 자신의 OAuth 토큰을 쓴다', /getAccessToken/.test(src));
  t('50개씩 나눠 조회한다 (videos.list 상한)', /chunk\(ids, 50\)/.test(src));
  t('쿼터 때문에 기본 진단에는 섞지 않는다',
    src.indexOf("req.query.videos") < src.indexOf('const env = {'),
    '기본 진단은 DB 만 보고, 유튜브 조회는 요청했을 때만');
  t('실패해도 기본 진단을 죽이지 않는다', /videos mode failed/.test(src));
  t('기본 응답이 이 모드를 안내한다', /\?videos=1/.test(src));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ youtube-video-state tests FAILED'); process.exit(1); }
console.log('✅ youtube-video-state tests passed');
