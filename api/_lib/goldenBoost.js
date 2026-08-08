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
 * 에디토리얼로 판정돼 수집은 스킵되는 새 IG 게시물에 골든아워 부스트.
 * @param m {id, permalink, timestamp} — Graph API 미디어
 * @param opts {backfillMode, now}
 */
async function maybeBoostEditorialPost(m, opts) {
  const o = opts || {};
  try {
    if (o.backfillMode) return { boosted: false, reason: 'backfill' };
    if (!m || !m.id || !m.permalink) return { boosted: false, reason: 'no-media' };
    if (!withinGoldenWindow(m.timestamp, o.now)) return { boosted: false, reason: 'window' };
    const claimed = await claimBoost(m.id, m.permalink);
    if (!claimed) return { boosted: false, reason: 'dup' };

    const text = boostText(m.permalink);
    let threadsOk = false, xOk = false;

    try {
      const threads = require('./threads');
      const id = await threads.postText(text);
      threadsOk = !!id;
    } catch (e) { console.warn('[boost] threads 실패:', (e && e.message) || e); }

    try {
      const x = require('./xPost');
      if (x.isConfigured()) {
        const r = await x.postTweet(text);
        xOk = !!(r && r.ok);
      }
    } catch (e) { console.warn('[boost] x 실패:', (e && e.message) || e); }

    /* 결과 기록 실패는 삼킨다 — 부스트 자체는 이미 나갔다 */
    try {
      await supabaseAdmin.from('ig_boosts')
        .update({ threads_ok: threadsOk, x_ok: xOk }).eq('post_id', String(m.id));
    } catch (_) {}

    return { boosted: true, threadsOk, xOk };
  } catch (e) {
    return { boosted: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = { maybeBoostEditorialPost, withinGoldenWindow, boostText, BOOST_WINDOW_MIN };
