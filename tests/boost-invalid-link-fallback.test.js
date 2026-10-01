/**
 * 부스트 링크 거절 → 직링크 1회 대체 — tests/boost-invalid-link-fallback.test.js (2026-10-01 신설)
 *
 * 왜 ─────────────────────────────────────────────────
 * 9/24~9/30 실측: 스레드 부스트 8건 중 5건 실패(9/28~9/30 4연속). 사유는 전부
 * error_subcode 4279047 '유효하지 않은 링크 첨부', is_transient:false — 재시도
 * 규칙은 손을 떼고 그 화보는 스레드에 영영 안 나갔다. 같은 기간 스레드 기사 게시
 * (리다이렉트 없는 우리 기사 주소)는 멀쩡했다. 다른 점은 /api/ig-out 302 링크 하나.
 *
 * 지키는 것 (maybeBoostPost 를 실제로 돌린다 — 소스 정규식 검사 아님):
 *   1. 4279047 거절이면 직링크(리다이렉트 없음, 쿼리 제거)로 정확히 1회 다시 쏜다
 *   2. 대체 성공 → threadsOk=true · threadsLinkFallback · 첫 사유 보존
 *   3. 대체도 거절 → '직링크도 실패: …' (두 번만 쏘고 멈춘다 — 무한 재시도 금지)
 *   4. 다른 영구 오류(예: code 190)·성공·일시 오류에는 대체가 끼지 않는다
 *   5. note 표식 'ok(직링크: …)' 가 성공으로 세어진다(isBoostOk) · 토큰 가림
 *   6. 경계: subcode 42790470 같은 다른 숫자는 거절로 안 본다
 *   7. X 경로는 그대로 ig-out 링크(계측 유지)
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

/* supabase: insert(선점) 성공 · update 무시 */
const fakeDb = {
  from() {
    return {
      insert: async () => ({ error: null }),
      update() { return { eq: async () => ({ error: null }) }; },
    };
  },
};
stub('supabase.js', { supabaseAdmin: fakeDb });

/* 스레드: 호출 기록 + 시나리오별 응답 */
const threadsCalls = [];
let threadsPlan = [];
stub('threads.js', {
  postText: async (text) => {
    threadsCalls.push(text);
    const step = threadsPlan.shift();
    if (step instanceof Error) throw step;
    return step === undefined ? 'thread-id' : step;
  },
});
const xCalls = [];
stub('xPost.js', {
  isConfigured: () => true,
  postTweet: async (text) => { xCalls.push(text); return { ok: true }; },
});

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const gb = require(path.join(ROOT, 'api', '_lib', 'goldenBoost.js'));
const sync = fs.readFileSync(path.join(ROOT, 'api/cron/sync-instagram.js'), 'utf8');

const INVALID = '게시 실패: {"error":{"message":"Fatal","type":"OAuthException","code":-1,"error_subcode":4279047,"is_transient":false,"error_user_title":"유효하지 않은 링크 첨부"}}';
const AUTH = '게시 실패: {"error":{"message":"Invalid OAuth access token","type":"OAuthException","code":190,"is_transient":false}}';
const TRANSIENT = '게시 실패: {"error":{"message":"An unexpected error","is_transient":true,"code":2}}';
const PERMA = 'https://www.instagram.com/p/Dd6ZyesPEH4/?igsh=abc';

let seq = 0;
async function boost(plan) {
  threadsCalls.length = 0; xCalls.length = 0; threadsPlan = plan.slice();
  const now = Date.now();
  return gb.maybeBoostPost({ id: 'm' + (++seq), permalink: PERMA, timestamp: new Date(now - 5 * 60000).toISOString() },
    { now, retryWaitMs: 0 });
}

(async function run() {
  /* 6. 판별 경계 */
  t('4279047 → 링크 거절', gb.isInvalidLinkFailure(INVALID) === true);
  t('한국어 제목만 있어도 링크 거절', gb.isInvalidLinkFailure('… "error_user_title":"유효하지 않은 링크 첨부" …') === true);
  t('경계: 42790470 은 다른 숫자', gb.isInvalidLinkFailure('{"error_subcode":42790470}') === false);
  t('경계: 빈 값·null 은 아님', gb.isInvalidLinkFailure('') === false && gb.isInvalidLinkFailure(null) === false);
  t('다른 영구 오류(190)는 아님', gb.isInvalidLinkFailure(AUTH) === false);
  t('일시 오류는 아님', gb.isInvalidLinkFailure(TRANSIENT) === false);

  /* 직링크 문구 */
  const direct = gb.boostTextDirect(PERMA);
  t('직링크: 쿼리 제거 · ig-out 없음', /https:\/\/www\.instagram\.com\/p\/Dd6ZyesPEH4\/$/.test(direct) && !/ig-out/.test(direct));

  /* 1·2. 거절 → 직링크 성공 */
  let r = await boost([new Error(INVALID), 'tid-2']);
  t('대체 성공: 스레드 2회 호출(원 + 직링크)', threadsCalls.length === 2, threadsCalls.length);
  t('1회차는 ig-out 링크, 2회차는 직링크', /api\/ig-out\?src=boost/.test(threadsCalls[0]) && threadsCalls[1] === direct);
  t('대체 성공: threadsOk=true · fallback 표시 · 첫 사유 보존',
    r.threadsOk === true && r.threadsLinkFallback === true && /4279047/.test(r.threadsFirstErr) && r.threadsErr === '', r);

  /* 3. 대체도 거절 → 멈춤 */
  r = await boost([new Error(INVALID), new Error(INVALID)]);
  t('대체도 거절: 딱 2회에서 멈춘다', threadsCalls.length === 2, threadsCalls.length);
  t('대체도 거절: 직링크도 실패 사유', r.threadsOk === false && /^직링크도 실패: /.test(r.threadsErr) && r.threadsErr.length <= 160, r.threadsErr);

  /* 4. 다른 경우엔 대체가 끼지 않는다 */
  r = await boost(['tid']);
  t('첫 시도 성공: 1회 · fallback 없음', threadsCalls.length === 1 && r.threadsOk && !r.threadsLinkFallback);
  r = await boost([new Error(AUTH)]);
  t('토큰 오류(190): 1회 · 대체 없음 · 원 사유 그대로', threadsCalls.length === 1 && !r.threadsOk && !r.threadsLinkFallback && /190/.test(r.threadsErr));
  r = await boost([new Error(TRANSIENT), 'tid']);
  t('일시 오류: 종전 재시도로 건짐 · 대체 없음', threadsCalls.length === 2 && r.threadsOk && r.threadsRetried && !r.threadsLinkFallback
    && /ig-out/.test(threadsCalls[1]));

  /* 7. X 는 계측 링크 유지 */
  t('X 는 그대로 ig-out 링크', xCalls.length === 1 && /api\/ig-out\?src=boost/.test(xCalls[0]));

  /* 5. note 표식 */
  const pick = (re, label) => { const m = sync.match(re); if (!m) { console.log('  ✗ 소스에서 ' + label + ' 못 찾음'); process.exit(1); } return m[0]; };
  // eslint-disable-next-line no-new-func
  const lib = new Function(pick(/function scrubSecret\(s\)\{[\s\S]*?\n\}/, 'scrubSecret') + '\n'
    + pick(/function recordBoost\(results, b\)\{[\s\S]*?\n\}/, 'recordBoost') + '\n'
    + pick(/function isBoostOk\(v\)\{[\s\S]*?\n\}/, 'isBoostOk') + '\nreturn { recordBoost, isBoostOk };')();
  const a = {};
  lib.recordBoost(a, { boosted: true, threadsOk: true, threadsLinkFallback: true, threadsFirstErr: INVALID, xOk: true });
  t('표식 ok(직링크: 첫 사유…)', /^ok\(직링크: 게시 실패/.test(a.boost_threads[0]), a.boost_threads[0]);
  t('경계: 첫 사유 60자 컷', a.boost_threads[0].length === 'ok(직링크: '.length + 60 + 1, a.boost_threads[0].length);
  t('직링크 성공은 성공으로 센다', lib.isBoostOk(a.boost_threads[0]) === true);
  const b = {};
  lib.recordBoost(b, { boosted: true, threadsOk: true, threadsLinkFallback: true, threadsFirstErr: 'x {"access_token":"EAAGabcdef1234567890"}', xOk: true });
  t('보안: 표식 안의 토큰은 가려진다', !/EAAG[A-Za-z0-9]{10,}/.test(b.boost_threads[0]));
  const c = {};
  lib.recordBoost(c, { boosted: true, threadsOk: false, threadsLinkFallback: true, threadsErr: '직링크도 실패: …', xOk: true });
  t('직링크도 실패는 실패로 센다', lib.isBoostOk(c.boost_threads[0]) === false && /^실패: 직링크도 실패/.test(c.boost_threads[0]));
  const d = {};
  lib.recordBoost(d, { boosted: true, threadsOk: true, threadsRetried: true, threadsFirstErr: TRANSIENT, xOk: true });
  t('회귀: 재시도 표식은 종전 그대로', /^ok\(재시도: /.test(d.boost_threads[0]));

  console.log(`\nboost-invalid-link-fallback: ${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
