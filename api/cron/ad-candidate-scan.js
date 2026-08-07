/**
 * GET /api/cron/ad-candidate-scan — 광고(부스트) 후보 게시물 브리핑 (매일 아침)
 *
 * @pap_magazine 최근 게시물을 스캔해 "참여가 검증된 = 부스트할 가치가 있는"
 * 게시물만 골라 브리핑을 만든다. 목표는 진성 팔로워 → 광고 목표는 '참여',
 * 소재는 유기적으로 이미 반응이 터진 게시물만 (알고리즘 신호 증폭 원리).
 *
 * 판정 기준 (최근 30개 게시물의 실측 평균 대비 상대 기준 — 자동 갱신):
 *   - 좋아요 ≥ 평균×1.5           (도달·호감)
 *   - 또는 댓글 ≥ 평균×2           (팬덤 신호, 가중치 높음)
 *   - 릴스(VIDEO)는 +10% 가산      (신규 도달·저장 우위)
 *   - 하한 게이트: 좋아요 < 평균×0.4 이면 무조건 제외 (저품질 광고 방지)
 *
 * 저장·공유(save/share)는 business_discovery 로 조회 불가(본인 인사이트 전용)
 * 이므로, 운영자가 최종 부스트 전 인사이트에서 저장·공유를 한 번 더 확인하도록
 * 브리핑에 안내를 포함한다.
 *
 * 수동: 관리자 토큰 GET ?dry=1
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { discoverAccount } = require('../_lib/igDiscovery');
// 2026-08-07 — 가드 추가. 그전까지 이 크론은 cron_runs 에 아무 기록도
// 남기지 않아 '도는지 안 도는지 알 수 없는' 상태였다(7일 로그 0건).
// 실패해도 아무도 몰랐다는 뜻이다.
const { withCronGuard } = require('../_lib/cronGuard');

const ACCOUNTS = ['pap_magazine']; // 필요 시 페퍼릿 등 확장

function classify(media) {
  const withLikes = media.filter((m) => m.likes != null);
  if (!withLikes.length) return { avgL: 0, avgC: 0, candidates: [] };
  const avgL = withLikes.reduce((s, m) => s + m.likes, 0) / withLikes.length;
  const avgC = withLikes.reduce((s, m) => s + (m.comments || 0), 0) / withLikes.length;

  const now = Date.now();
  const candidates = withLikes.map((m) => {
    const ageH = m.ts ? (now - new Date(m.ts).getTime()) / 3600000 : 999;
    const isReel = m.type === 'VIDEO';
    const likeBar = avgL * (isReel ? 1.35 : 1.5);   // 릴스는 좋아요 기준 완화(가산)
    const cmtBar = avgC * 2;
    const passLike = m.likes >= likeBar;
    const passCmt = (m.comments || 0) >= cmtBar;
    const gate = m.likes >= avgL * 0.4;             // 하한 게이트
    const qualify = gate && (passLike || passCmt);
    const reasons = [];
    if (passLike) reasons.push('좋아요 ' + m.likes + ' (평균 ' + Math.round(avgL) + '의 ' + (m.likes / avgL).toFixed(1) + '배)');
    if (passCmt) reasons.push('댓글 ' + (m.comments || 0) + ' (평균 ' + avgC.toFixed(0) + '의 ' + ((m.comments || 0) / Math.max(1, avgC)).toFixed(1) + '배)');
    if (isReel) reasons.push('릴스(신규 도달·저장 우위)');
    return {
      permalink: m.permalink, type: m.type, likes: m.likes, comments: m.comments || 0,
      age_hours: Math.round(ageH), qualify, reasons,
      caption_head: m.caption_head.replace(/\n/g, ' ').slice(0, 60),
      score: (m.likes || 0) + (m.comments || 0) * 3 + (isReel ? avgL * 0.2 : 0),
    };
  });
  return { avgL: Math.round(avgL), avgC: +avgC.toFixed(1), candidates };
}

module.exports = withCronGuard('ad-candidate-scan', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = !!(req.query && req.query.dry === '1');

  try {
    const out = [];
    for (const u of ACCOUNTS) {
      const acc = await discoverAccount(u, 30);
      if (acc.error) { out.push({ account: u, error: acc.error }); continue; }
      const { avgL, avgC, candidates } = classify(acc.media || []);
      // 최근 7일 내 + 적합 판정만, 점수순 상위 5
      const recent = candidates.filter((c) => c.age_hours <= 168 && c.qualify)
        .sort((a, b) => b.score - a.score).slice(0, 5);
      out.push({
        account: u, avg_likes: avgL, avg_comments: avgC,
        bar: { like: Math.round(avgL * 1.5), like_reel: Math.round(avgL * 1.35), comment: Math.round(avgC * 2) },
        candidates: recent,
        note: '부스트 전 인사이트에서 저장·공유 수를 한 번 더 확인하세요(진성 팔로워 전환의 최강 지표). 광고 목표는 참여, 타겟은 저장된 CELEB1/ART1/EDITORIAL1 재사용.',
      });
    }

    // trend_reports 오늘자에 병합 저장 (kind: ad-candidate)
    let saved = false;
    if (!dry) {
      const items = out.flatMap((o) => (o.candidates || []).map((c) => ({
        kind: 'ad-candidate', account: o.account, title: c.caption_head,
        link: c.permalink, type: c.type, likes: c.likes, comments: c.comments,
        reasons: c.reasons,
      })));
      if (items.length) {
        const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        const { data: existing } = await supabaseAdmin
          .from('trend_reports').select('id, items').eq('report_date', today).maybeSingle();
        if (existing) {
          const merged = (existing.items || []).filter((x) => x.kind !== 'ad-candidate').concat(items);
          const { error } = await supabaseAdmin.from('trend_reports').update({ items: merged }).eq('id', existing.id);
          saved = !error;
        } else {
          const { error } = await supabaseAdmin.from('trend_reports').insert({ report_date: today, items, model: 'ad-candidate-scan' });
          saved = !error;
        }
      }
    }

    return res.status(200).json({ scanned_at: new Date().toISOString(), briefing: out, saved, dry });
  } catch (e) {
    console.error('[ad-candidate-scan] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
});
