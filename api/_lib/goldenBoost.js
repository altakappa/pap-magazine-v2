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

    try {
      const threads = require('./threads');
      const id = await threads.postText(text);
      threadsOk = !!id;
      if (!threadsOk) threadsErr = '게시 id 없음';
    } catch (e) {
      threadsErr = String((e && e.message) || e).slice(0, 160);
      console.warn('[boost] threads 실패:', threadsErr);
    }

    try {
      const x = require('./xPost');
      if (x.isConfigured()) {
        const r = await x.postTweet(text);
        xOk = !!(r && r.ok);
        if (!xOk) xErr = String((r && (r.error || r.reason)) || '게시 실패').slice(0, 160);
      } else {
        xErr = '미설정';
      }
    } catch (e) {
      xErr = String((e && e.message) || e).slice(0, 160);
      console.warn('[boost] x 실패:', xErr);
    }

    /* 결과 기록 실패는 삼킨다 — 부스트 자체는 이미 나갔다 */
    try {
      await supabaseAdmin.from('ig_boosts')
        .update({ threads_ok: threadsOk, x_ok: xOk }).eq('post_id', String(m.id));
    } catch (_) {}

    return { boosted: true, threadsOk, xOk, pushSent, threadsErr, xErr };
  } catch (e) {
    return { boosted: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = {
  maybeBoostPost,
  /* 구이름 호환 (2026-08-09 이전 배선) */
  maybeBoostEditorialPost: maybeBoostPost,
  withinGoldenWindow, boostText, BOOST_WINDOW_MIN,
};
