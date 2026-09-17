/**
 * 골든아워 부스트 — api/_lib/goldenBoost.js (2026-08-09 신설)
 *
 * 왜 ────────────────────────────────────────────────────────────────
 * 도메니코: "메타 광고 없이 게시물마다 참여 광고 태우는 효과를."
 * 참여 광고가 실제로 사는 것은 **게시 직후의 초기 속도**다. 그리고
 * PAP 실측(2026-08-09, 최근 148개 게시물)이 이를 증명한다:
 *
 *     캐러셀 게시물의 corr(첫 3시간 좋아요, 최종 도달) = 0.94
 *
 * 초기 속도가 곧 최종 도달이다. 이 초기 속도를 돈이 아니라 **우리가
 * 이미 가진 채널**(스레드·X 팔로워)로 만든다: sync-instagram 이 새
 * IG 게시물을 감지하면(10분 폴링), 게시 90분 안에 스레드·X 가
 * "지금 보기" 링크로 그 게시물에 트래픽을 쏜다.
 *
 * 왜 에디토리얼(수집 스킵 게시물)에만 쏘나: 기사형 게시물은 임포트
 * 시 X·스레드 자동 게시가 이미 나간다(웹 기사 링크). 에디토리얼은
 * 그 흐름이 없어서 골든아워가 그냥 지나갔다 — 그런데 팔로우 전환은
 * 캐러셀 에디토리얼이 사실상 전부다 (평균 5.3 vs 영상 0.0).
 *
 * 안전핀:
 *   - ig_boosts PK claim-first → 게시물당 정확히 1회 (틱톡 중복 사고 교훈:
 *     "확인 후 게시"가 아니라 "선점 후 게시")
 *   - 백필 모드 차단 (과거 게시물 대량 스캔이 소셜 스팸이 되면 안 됨)
 *   - 90분 창 밖이면 침묵 (뒷북 부스트는 소음)
 *   - 전 과정 best-effort — 부스트 실패가 수집을 절대 막지 않는다
 *   - 링크는 /api/ig-out?src=boost 경유 — 성장 헌법 3조 (측정 없는 발신 금지)
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const BOOST_WINDOW_MIN = Math.max(10, parseInt(process.env.BOOST_WINDOW_MIN || '90', 10) || 90);

/* 일시 오류 1회 재시도 (2026-09-17) ──────────────────────
   9/10 에 사유를 남기게 한 뒤 처음 잡힌 스레드 실패가 이것이었다:

     {"error":{"message":"An unexpected error has occurred. Please retry
      your request later.","type":"OAuthException","is_transient":true,
      "code":2,...}}

   메타가 응답에 **"나중에 다시 시도하라"고 직접 적어 보낸다.** 그런데
   부스트 경로에는 재시도가 없다 — ig_boosts 는 선점(claim-first) 구조라
   한 번 실패하면 다음 크론도 dup 으로 물러나고, 그 화보는 **영영** 스레드에
   안 나간다. 실측(9/10~9/17): 부스트 4건 중 스레드 3건 성공, 실패 1건이
   전부 이 오류다.

   왜 조건을 좁게 두는가: threadsAutopost 가 2026-07-23 에 겪은 사고가
   "영구성 오류를 10분마다 무한 재시도 + 6시간마다 실패 메일" 이었다.
   같은 실수를 반복하지 않으려면 **메타가 일시적이라고 말한 것만** 다시 쏜다.

   레이트리밋(code 4·17·32·613)은 기술적으로는 일시 오류지만 **즉시 재시도가
   상황을 악화시킨다** — transient 로 보지 않는다. 판단 못 하는 문자열도
   재시도하지 않는다(보수적 기본값). 추측으로 다시 쏘지 않는다.

   재시도는 **1회뿐**이고 짧게 기다렸다 쏜다. 부스트는 크론 예산 안에서
   도는 곁다리 작업이라 여기서 오래 붙잡으면 수집 본체가 굶는다. */
const RETRY_WAIT_MS = Math.max(0, parseInt(process.env.BOOST_RETRY_WAIT_MS || '2500', 10) || 0);
/** 메타 레이트리밋 코드 — 일시 오류지만 즉시 재시도는 금지 */
const RATE_LIMIT_CODES = [4, 17, 32, 613];

/**
 * 이 실패 문자열이 **메타가 일시적이라고 명시한** 오류인가.
 * 판단이 안 서면 false — 재시도하지 않는 쪽이 안전하다.
 * @param {string} msg 실패 사유 원문
 * @returns {boolean}
 */
function isTransientFailure(msg) {
  const s = String(msg == null ? '' : msg);
  if (!s) return false;
  // 레이트리밋이면 일시라도 즉시 재시도 금지 — 먼저 걸러낸다.
  if (RATE_LIMIT_CODES.some((c) => new RegExp('"code"\\s*:\\s*' + c + '\\b').test(s))) return false;
  if (/"is_transient"\s*:\s*false/.test(s)) return false;   // 명시적 영구 오류
  if (/"is_transient"\s*:\s*true/.test(s)) return true;     // 메타가 직접 말한 일시 오류
  return false;
}

/** 재시도 전 짧은 대기 (테스트에서 0 으로 줄일 수 있게 분리) */
function waitBeforeRetry(ms) {
  const d = typeof ms === 'number' ? ms : RETRY_WAIT_MS;
  if (!d) return Promise.resolve();
  return new Promise((r) => setTimeout(r, d));
}

/**
 * 게시 시도 + 일시 오류면 1회만 재시도.
 * @param {function(): Promise<boolean>} attempt 성공이면 참값을 돌려주는 게시 함수
 * @param {object} opts {retryWaitMs}
 * @returns {Promise<{ok:boolean, err:string, retried:boolean}>}
 */
async function postWithTransientRetry(attempt, opts) {
  const o = opts || {};
  const once = async () => {
    try {
      const ok = await attempt();
      return { ok: !!ok, err: ok ? '' : '게시 id 없음' };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e).slice(0, 160) };
    }
  };

  const first = await once();
  if (first.ok || !isTransientFailure(first.err)) {
    return { ok: first.ok, err: first.err, retried: false };
  }

  await waitBeforeRetry(o.retryWaitMs);
  const second = await once();
  if (second.ok) return { ok: true, err: '', retried: true };
  /* 두 번 다 죽었으면 **두 사유를 다 남긴다.** 재시도가 있었다는 사실이
     사유에서 사라지면 "한 번 시도하고 포기했다"로 잘못 읽힌다 (교훈 1). */
  return { ok: false, retried: true, err: ('재시도 후에도 실패: ' + second.err).slice(0, 160) };
}

/** 게시 시각이 골든아워(기본 90분) 안인가 */
function withinGoldenWindow(timestamp, nowMs) {
  const t = Date.parse(timestamp || '');
  if (isNaN(t)) return false;
  const ageMin = ((typeof nowMs === 'number' ? nowMs : Date.now()) - t) / 60000;
  return ageMin >= 0 && ageMin <= BOOST_WINDOW_MIN;
}

/* 선점: INSERT 가 성공한 쪽만 부스트한다. 23505(중복) = 이미 다른
   실행이 선점 — 조용히 물러난다. (check-then-act 는 10분 크론 중복
   실행에서 두 번 쏜다 — 드라이브 이중게시 사고와 같은 구멍) */
async function claimBoost(postId, permalink) {
  const { error } = await supabaseAdmin.from('ig_boosts')
    .insert({ post_id: String(postId), permalink: String(permalink) });
  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

function boostText(permalink) {
  const clean = String(permalink).split('?')[0];
  const link = SITE + '/api/ig-out?src=boost&to=post&url=' + encodeURIComponent(clean);
  return '새 화보가 인스타그램에 공개됐습니다.\n지금 가장 먼저 보기 ↓\n\n' + link;
}

/**
 * 자동 게시(X·스레드)가 나가지 않는 모든 새 IG 게시물에 골든아워 부스트.
 * (2026-08-09 확장 — 도메니코: "에디토리얼뿐 아니라 모든 게시물에".
 *  발행 기사형은 제외한다: 임포트 즉시 나가는 기존 자동 게시와 같은 채널
 *  이중 게시가 되기 때문. 나머지 전부 — 에디토리얼 스킵 3종 + 품질 게이트
 *  draft — 는 부스트가 유일한 골든아워 푸시다.)
 * @param m {id, permalink, timestamp} — Graph API 미디어
 * @param opts {backfillMode, now}
 */
async function maybeBoostPost(m, opts) {
  const o = opts || {};
  try {
    if (o.backfillMode) return { boosted: false, reason: 'backfill' };
    if (!m || !m.id || !m.permalink) return { boosted: false, reason: 'no-media' };
    if (!withinGoldenWindow(m.timestamp, o.now)) return { boosted: false, reason: 'window' };
    const claimed = await claimBoost(m.id, m.permalink);
    if (!claimed) return { boosted: false, reason: 'dup' };

    /* 웹 푸시 (B-7, 2026-08-09) — 에디토리얼일 때만. 알림은 신뢰 자산이라
       뉴스·draft 까지 쏘면 구독 해지 사태가 난다. 하루 상한은 webPush 가 지킨다.
       실패는 부스트를 못 막는다. */
    let pushSent = 0;
    if (o.kind === 'editorial') {
      try {
        const { broadcastNewPost } = require('./webPush');
        const pr = await broadcastNewPost({ postId: m.id, permalink: m.permalink,
          title: 'PAP MAGAZINE — 새 화보' });
        pushSent = pr.sent || 0;
      } catch (e) { console.warn('[boost] push 실패:', (e && e.message) || e); }
    }

    const text = boostText(m.permalink);
    let threadsOk = false, xOk = false;
    /* 2026-09-10 — 실패 사유를 반환값으로 돌려준다. 여태 console.warn 으로만
       흘렸더니 ig_boosts 에는 threads_ok=false 만 남고 "왜" 가 어디에도 없었다.
       실측: 부스트 14건 중 스레드 6건만 성공(43%)인데 사유가 0건 — 8/18 에
       cronGuard 로 고친 것과 똑같은 구멍(실패는 보이는데 사유가 안 보인다)이
       부스트 경로에 그대로 남아 있었다. 호출부가 cron_runs.note 에 싣는다. */
    let threadsErr = '', xErr = '';

    /* 2026-09-17 — 스레드·X 모두 같은 재시도 규칙을 탄다. 규칙을 한 벌로
       두는 이유는 교훈 2 — 두 벌이면 한쪽만 고쳐진다. X 는 지금 13/14 로
       거의 안 죽지만, 죽는 날 규칙이 없으면 같은 구멍이 된다. */
    let threadsRetried = false, xRetried = false;

    {
      const r = await postWithTransientRetry(async () => {
        const threads = require('./threads');
        return await threads.postText(text);
      }, { retryWaitMs: o.retryWaitMs });
      threadsOk = r.ok; threadsErr = r.ok ? '' : r.err; threadsRetried = r.retried;
      if (!threadsOk) console.warn('[boost] threads 실패:', threadsErr);
    }

    {
      const x = require('./xPost');
      if (!x.isConfigured()) {
        xErr = '미설정';
      } else {
        const r = await postWithTransientRetry(async () => {
          const tr = await x.postTweet(text);
          /* postTweet 은 던지지 않고 {ok:false, error} 를 돌려주는 경로가 있다.
             그 사유를 삼키면 재시도 판정에 쓸 문자열이 사라지므로 예외로 올린다. */
          if (tr && tr.ok) return true;
          throw new Error(String((tr && (tr.error || tr.reason)) || '게시 실패'));
        }, { retryWaitMs: o.retryWaitMs });
        xOk = r.ok; xErr = r.ok ? '' : r.err; xRetried = r.retried;
        if (!xOk) console.warn('[boost] x 실패:', xErr);
      }
    }

    /* 결과 기록 실패는 삼킨다 — 부스트 자체는 이미 나갔다 */
    try {
      await supabaseAdmin.from('ig_boosts')
        .update({ threads_ok: threadsOk, x_ok: xOk }).eq('post_id', String(m.id));
    } catch (_) {}

    return { boosted: true, threadsOk, xOk, pushSent, threadsErr, xErr, threadsRetried, xRetried };
  } catch (e) {
    return { boosted: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = {
  maybeBoostPost,
  /* 구이름 호환 (2026-08-09 이전 배선) */
  maybeBoostEditorialPost: maybeBoostPost,
  withinGoldenWindow, boostText, BOOST_WINDOW_MIN,
  /* 재시도 판정은 테스트가 직접 돌려 본다 (2026-09-17) — 정규식으로 소스를
     훑는 검사는 규칙이 실제로 맞는지 못 본다. */
  isTransientFailure, postWithTransientRetry,
};
