/**
 * 알고리즘 조기경보 코치 — /api/cron/algo-coach (2026-08-09 신설)
 *
 * 왜 ────────────────────────────────────────────────────────────────
 * 도메니코: "인스타 알고리즘에 유리하게 작용하도록 코드를 걸어줘."
 * IG 알고리즘의 증폭 결정은 게시 초기 신호로 이뤄진다. PAP 실측:
 *   - 캐러셀 첫 3시간 좋아요 ↔ 최종 도달 corr 0.94
 *   - 3시간령 분포 (83개): P25=98 · P50=193 · P75=358 · P90=500
 * 즉 게시 3시간이면 이 게시물이 뜰지 이미 안다. 그 순간 사람이 할 수 있는
 * 최고의 액션(스토리 리샤어·공동게시 초대·댓글 답글)을 하라고 알려주는
 * 것이 이 크론이다 — 뜨는 불에 부채질은 광고비 없이 되는 유일한 증폭.
 *
 * 매시 :10 실행 (ig-snapshot 이 :01 에 지표를 찍는다).
 * 판정: 3시간령 좋아요가 역사 분포의 P75 이상 → 'hot' 텔레그램 알림.
 *       P25 이하 → 'cold' 조용히 기록 (푸시 스팸 금지 — 주간 코칭 자료).
 * 게시물당 1회 (algo_coach PK claim-first — 틱톡 이중게시 교훈).
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { requireAdmin } = require('../_lib/auth');
const { sendTextToTelegramPersonalSafe } = require('../_lib/telegram');

/* 게시물별로 3시간에 가장 가까운 스냅샷 하나만 남긴다. */
function pickClosest3h(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.post_id) continue;
    const d = Math.abs(Number(r.age_hours) - 3);
    const cur = by.get(r.post_id);
    if (!cur || d < cur._d) by.set(r.post_id, { ...r, _d: d });
  }
  return [...by.values()];
}

/* 배열에서 p 분위값 (선형 보간 없이 근사 — 코칭 임계값 용도로 충분) */
function percentileOf(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((sortedAsc.length - 1) * p)));
  return sortedAsc[i];
}

async function handler(req, res) {
  res.locals = res.locals || {};
  const note = (msg) => { res.locals.cronNote = msg; };

  /* Bearer CRON_SECRET — x-vercel-cron 헤더는 오지 않는다 (celeb-classify 사고) */
  const auth = (req.headers && req.headers.authorization) || '';
  const isCron = !!process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!isCron) {
    const user = await requireAdmin(req, res);
    if (!user) { note('인증 거부 — 크론이면 CRON_SECRET 확인'); return; }
  }

  try {
    /* 1) 3시간령 후보: 최근 6시간 내 게시 + 2~4시간령 스냅샷 보유 */
    const sixHrsAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: recentRows, error: e1 } = await supabaseAdmin
      .from('ig_post_metric')
      .select('post_id, permalink, media_type, posted_at, like_count, age_hours')
      .gte('posted_at', sixHrsAgo).gte('age_hours', 2).lte('age_hours', 4)
      .limit(500);
    if (e1) throw e1;
    const candidates = pickClosest3h(recentRows);
    if (!candidates.length) {
      note('3시간령 게시물 없음 — 대기');
      return res.status(200).json({ ok: true, candidates: 0 });
    }

    /* 2) 역사 분포 (후보 제외) — 임계값 */
    const { data: histRows, error: e2 } = await supabaseAdmin
      .from('ig_post_metric')
      .select('post_id, like_count, age_hours')
      .lt('posted_at', sixHrsAgo).gte('age_hours', 2).lte('age_hours', 4)
      .limit(5000);
    if (e2) throw e2;
    const hist = pickClosest3h(histRows).map((r) => Number(r.like_count) || 0).sort((a, b) => a - b);
    if (hist.length < 20) {
      note('역사 표본 부족 (' + hist.length + ') — 판정 보류');
      return res.status(200).json({ ok: true, hist: hist.length });
    }
    const p25 = percentileOf(hist, 0.25);
    const p50 = percentileOf(hist, 0.50);
    const p75 = percentileOf(hist, 0.75);

    let hot = 0, mid = 0, cold = 0, dup = 0;
    for (const c of candidates) {
      /* 게시물당 1회 — 선점 INSERT (23505 = 이미 코칭됨) */
      const { error: claimErr } = await supabaseAdmin.from('algo_coach')
        .insert({ post_id: String(c.post_id) });
      if (claimErr) {
        if (claimErr.code === '23505') { dup++; continue; }
        throw claimErr;
      }
      const likes = Number(c.like_count) || 0;
      const verdict = likes >= p75 ? 'hot' : (likes <= p25 ? 'cold' : 'mid');
      if (verdict === 'hot') hot++; else if (verdict === 'cold') cold++; else mid++;

      await supabaseAdmin.from('algo_coach')
        .update({ verdict, likes_3h: likes, p50, p75 }).eq('post_id', String(c.post_id));

      if (verdict === 'hot') {
        /* 알림 실패는 삼킨다 — 판정 기록(핵심)은 이미 끝났다 */
        try {
          await sendTextToTelegramPersonalSafe(
            '🔥 [PAP] 게시물 떡상 조짐 — 지금이 골든타임\n\n'
            + (c.permalink || c.post_id) + '\n'
            + '3시간 좋아요 ' + likes + ' (평소 중앙값 ' + p50 + ' · 상위 25% 기준 ' + p75 + ')\n\n'
            + '지금 하면 알고리즘 증폭이 커지는 것:\n'
            + '1. 본계정 스토리로 리샤어\n'
            + '2. 크레딧된 팀에게 공동 게시(Collab) 초대\n'
            + '3. 달린 댓글에 전부 답글 (대화 신호)'
          );
        } catch (e) { console.warn('[algo-coach] 알림 실패:', (e && e.message) || e); }
      }
    }

    note('판정 ' + (hot + mid + cold) + '건 (🔥' + hot + ' · 보통 ' + mid + ' · 저조 ' + cold + ')'
      + (dup ? ' · 기판정 ' + dup : '') + ' — 기준 P75=' + p75);
    return res.status(200).json({ ok: true, hot, mid, cold, dup, p25, p50, p75 });
  } catch (err) {
    console.error('[algo-coach] error:', err);
    note('실패: ' + String((err && err.message) || err).slice(0, 150));
    return res.status(500).json({ error: 'algo-coach failed' });
  }
}

module.exports = withCronGuard('algo-coach', handler);
module.exports.pickClosest3h = pickClosest3h;
module.exports.percentileOf = percentileOf;
