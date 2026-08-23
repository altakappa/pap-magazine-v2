/**
 * PAP Magazine — 인스타그램 성과 스냅샷 크론 (2026-07-21 신설)
 * Route: /api/cron/ig-snapshot   (vercel.json: 매시 :01)
 *
 * 왜: 도메니코가 "참여가 줄었다 / 팔로워 증가가 꺾였다"고 할 때 검증할 데이터가
 * 없었다. 좋아요·댓글·팔로워를 아무 데도 저장하지 않아 매번 게시 빈도 같은
 * 간접 증거로 추측해야 했다. 이제 실측치를 남긴다.
 *
 * 주기가 필요한 이유: 게시물 좋아요는 게시 직후 급상승하므로, 시기 간 비교를
 * 하려면 "게시 후 24시간" 같은 동일 나이 시점의 값이 필요하다 (뷰 ig_post_24h).
 *
 * 2026-08-12 — 3시간 → 매시 :01. 3시간 간격에서는 게시물의 첫 관측 나이가
 * 0~3시간에 균등하게 흩어져, 1시간령을 잡을 확률이 3분의 1뿐이었다.
 * algo-coach 의 1시간령 조기 알림(매시 :10)이 그 관측을 필요로 한다.
 * 24시간 관측 정밀도도 ±1.5시간에서 ±0.5시간으로 좋아진다.
 *
 * 사용법:
 *   GET /api/cron/ig-snapshot              — 수집·저장 (크론)
 *   GET /api/cron/ig-snapshot?report=1     — 저장된 데이터로 추세 리포트
 *   GET /api/cron/ig-snapshot?report=1&days=14
 */

const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { captureSnapshot, buildReport } = require('../_lib/igSnapshot');
// 2026-08-22 — 이탈 계측 (도메니코: "이탈자가 매일 100-200명").
// follower_count(gains)를 하루 1회 받아 두면 이탈 = gains − net 으로 도출된다.
const { captureFlux, fluxCapturedToday, computeUnfollows, isSpike } = require('../_lib/igFlux');
const { buildIgLedger } = require('../_lib/igLedger');
const { sendTextToTelegramPersonalSafe } = require('../_lib/telegram');

module.exports = withCronGuard('ig-snapshot', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  // 리포트 모드 — 저장된 것만 읽는다 (IG API 미호출).
  if (req.query && req.query.report === '1') {
    const days = parseInt(req.query.days || '', 10) || 30;
    return res.status(200).json({ ok: true, report: await buildReport(days) });
  }

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }

  const limit = Math.max(1, Math.min(50, parseInt((req.query && req.query.limit) || '', 10) || 25));
  const result = await captureSnapshot({ limit });

  /* ── 이탈 계측 (2026-08-22) — 하루 1회, 실패해도 스냅샷 본체를 막지 않는다 ──
     API 는 최근 30일 시계열을 한 번에 주므로 하루 1콜이면 백필까지 된다.
     시간당 크론이지만 fluxCapturedToday 가드로 첫 성공 후에는 건너뛴다. */
  let flux = null;
  try {
    if (!(await fluxCapturedToday())) {
      flux = await captureFlux();
      console.log('[ig-snapshot] flux:', JSON.stringify(flux));

      /* 이탈 급증 경보 — gains 저장 직후 하루 1회만 검사한다.
         '어제' 이탈이 과거 28일 분포의 P50+2×IQR 를 넘으면 텔레그램.
         알림에는 직전 24시간에 올린 게시물 형식 요약을 싣는다 — 코드가
         원인을 못 짚으므로(게시물별 언팔 지표 없음) 재료만 나란히 놓는다. */
      if (flux && flux.status === 'ok') {
        try {
          const ledger = await buildIgLedger(30);
          const withFlux = computeUnfollows(
            (await require('../_lib/supabase').supabaseAdmin
              .from('ig_follower_flux').select('day, gains')
              .order('day', { ascending: true }).limit(60)).data || [],
            ledger.days);
          const known = withFlux.filter((d) => typeof d.unfollows === 'number');
          const yesterday = known[known.length - 1];
          const verdict = yesterday
            ? isSpike(known.slice(0, -1).map((d) => d.unfollows), yesterday.unfollows, 2)
            : null;
          if (verdict && verdict.spike) {
            await sendTextToTelegramPersonalSafe([
              '📉 IG 이탈 급증 — ' + yesterday.day,
              '이탈 ' + yesterday.unfollows + '명 (평소 P50 ' + verdict.p50 + ' · 임계 ' + verdict.threshold + ')',
              '그날 게시: 캐러셀 ' + yesterday.carousels + ' · 릴스 ' + yesterday.videos + ' · 이미지 ' + yesterday.images,
              '순증 ' + yesterday.delta + ' · 신규 ' + yesterday.gains,
              '누가·어떤 게시물 때문인지는 API 가 안 준다 — 그날 올린 것을 직접 봐줘.',
            ].join('\n'));
          }
        } catch (e) {
          console.warn('[ig-snapshot] 이탈 경보 실패(비치명):', e && e.message);
        }
      }
    }
  } catch (e) {
    console.warn('[ig-snapshot] flux 실패(비치명):', e && e.message);
  }

  return res.status(200).json({ ok: true, ...result, flux: flux && flux.status });
});
