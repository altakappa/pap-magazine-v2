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

/* 게시물별로 목표 나이에 가장 가까운 스냅샷 하나만 남긴다. */
function pickClosestAge(rows, targetH) {
  const target = Number(targetH);
  const t = isNaN(target) ? 3 : target;
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.post_id) continue;
    const d = Math.abs(Number(r.age_hours) - t);
    const cur = by.get(r.post_id);
    if (!cur || d < cur._d) by.set(r.post_id, { ...r, _d: d });
  }
  return [...by.values()];
}

/* 3시간령 (기존 이름 유지 — 호출부·테스트 계약) */
function pickClosest3h(rows) { return pickClosestAge(rows, 3); }

/* 배열에서 p 분위값 (선형 보간 없이 근사 — 코칭 임계값 용도로 충분) */
function percentileOf(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((sortedAsc.length - 1) * p)));
  return sortedAsc[i];
}

/* ── 1시간령 조기 알림 (2026-08-12 신설) ───────────────────────────
 * 왜: 3시간 판정은 이미 승부가 난 뒤다. IG 증폭은 초기 60분 신호로 갈린다.
 * 그래서 같은 논리를 1시간령에 한 번 더 돌린다 — 개입할 시간이 남아 있는
 * 유일한 시점이다. (2026-08-12 실측: 3시간령 도달과 최종 도달 corr 0.94 인데,
 * 그때 알림을 받아도 스토리 리샤어로 되돌릴 여지가 거의 없었다.)
 *
 * 스키마를 늘리지 않는다: algo_coach 는 3시간 판정 전용으로 두고, 1시간
 * 알림 선점은 ops_alert_state(key PK)로 한다. 마이그레이션 없이 게시물당
 * 정확히 1회를 보장한다 — 선점 INSERT 후 23505 판단 (틱톡 이중게시 교훈).
 *
 * 임계 미달은 아무것도 하지 않는다. 1시간짜리 표본으로 "저조" 판정을
 * 내려 알림을 보내면 그건 소음이고, 신뢰 자산을 태운다.
 */
const EARLY_TARGET_H = 1;
const EARLY_MIN_AGE = 0.6;
const EARLY_MAX_AGE = 1.6;
const EARLY_LOOKBACK_MS = 2.5 * 3600 * 1000;

function earlyAlertKey(postId) { return 'algo_coach_1h:' + String(postId); }

async function runEarlyPass() {
  const out = { candidates: 0, fast: 0, dup: 0, hist: 0, skipped: null };
  const since = new Date(Date.now() - EARLY_LOOKBACK_MS).toISOString();

  const { data: freshRows, error: eA } = await supabaseAdmin
    .from('ig_post_metric')
    .select('post_id, permalink, media_type, posted_at, like_count, age_hours')
    .gte('posted_at', since).gte('age_hours', EARLY_MIN_AGE).lte('age_hours', EARLY_MAX_AGE)
    .limit(500);
  if (eA) throw eA;
  const cands = pickClosestAge(freshRows, EARLY_TARGET_H);
  out.candidates = cands.length;
  if (!cands.length) { out.skipped = '1시간령 없음'; return out; }

  const { data: histRows, error: eB } = await supabaseAdmin
    .from('ig_post_metric')
    .select('post_id, like_count, age_hours')
    .lt('posted_at', since).gte('age_hours', EARLY_MIN_AGE).lte('age_hours', EARLY_MAX_AGE)
    .limit(5000);
  if (eB) throw eB;
  const hist = pickClosestAge(histRows, EARLY_TARGET_H)
    .map((r) => Number(r.like_count) || 0).sort((a, b) => a - b);
  out.hist = hist.length;
  if (hist.length < 20) { out.skipped = '1시간 표본 부족(' + hist.length + ')'; return out; }
  const p50 = percentileOf(hist, 0.50);
  const p75 = percentileOf(hist, 0.75);

  for (const c of cands) {
    const likes = Number(c.like_count) || 0;
    if (likes < p75) continue;   // 미달은 침묵 — 판정도 알림도 하지 않는다

    /* 선점 후 알림 (확인 후 알림은 매시 크론에서 두 번 쏜다) */
    const { error: claimEarlyErr } = await supabaseAdmin.from('ops_alert_state').insert({
      key: earlyAlertKey(c.post_id),
      last_alert_at: new Date().toISOString(),
      last_payload: { kind: 'algo_coach_1h', likes_1h: likes, p50: p50, p75: p75,
        permalink: String(c.permalink || '').slice(0, 200) },
      updated_at: new Date().toISOString(),
    });
    if (claimEarlyErr) {
      if (claimEarlyErr.code === '23505') { out.dup++; continue; }
      throw claimEarlyErr;
    }
    out.fast++;

    try {
      await sendTextToTelegramPersonalSafe(
        '⚡ [PAP] 게시 1시간 — 초반 속도가 빠릅니다 (지금이 개입 시점)\n\n'
        + (c.permalink || c.post_id) + '\n'
        + '1시간 좋아요 ' + likes + ' (평소 중앙값 ' + p50 + ' · 상위 25% 기준 ' + p75 + ')\n\n'
        + '앞으로 60분 안에 하면 증폭이 커지는 것:\n'
        + '1. 본계정 스토리로 리샤어\n'
        + '2. 크레딧된 팀에게 공동 게시(Collab) 초대\n'
        + '3. 달린 댓글에 전부 답글 (대화 신호)'
      );
    } catch (e) { console.warn('[algo-coach] 1시간 알림 실패:', (e && e.message) || e); }
  }
  return out;
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
    /* 0) 1시간령 조기 알림 — 실패해도 3시간 판정을 막지 않는다 */
    let early = { candidates: 0, fast: 0, dup: 0, skipped: 'error' };
    try { early = await runEarlyPass(); }
    catch (e) { console.error('[algo-coach] 1시간 패스 실패:', (e && e.message) || e); }

    /* 1) 3시간령 후보: 최근 6시간 내 게시 + 2~4시간령 스냅샷 보유 */
    const sixHrsAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: recentRows, error: e1 } = await supabaseAdmin
      .from('ig_post_metric')
      .select('post_id, permalink, media_type, posted_at, like_count, age_hours')
      .gte('posted_at', sixHrsAgo).gte('age_hours', 2).lte('age_hours', 4)
      .limit(500);
    if (e1) throw e1;
    const candidates = pickClosest3h(recentRows);
    const earlyNote = '1시간 ⚡' + (early.fast || 0)
      + (early.skipped ? ' (' + early.skipped + ')' : '');
    if (!candidates.length) {
      note('3시간령 게시물 없음 — 대기 · ' + earlyNote);
      return res.status(200).json({ ok: true, candidates: 0, early: early });
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
      note('역사 표본 부족 (' + hist.length + ') — 판정 보류 · ' + earlyNote);
      return res.status(200).json({ ok: true, hist: hist.length, early: early });
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
      + (dup ? ' · 기판정 ' + dup : '') + ' — 기준 P75=' + p75 + ' · ' + earlyNote);
    return res.status(200).json({ ok: true, hot, mid, cold, dup, p25, p50, p75, early: early });
  } catch (err) {
    console.error('[algo-coach] error:', err);
    note('실패: ' + String((err && err.message) || err).slice(0, 150));
    return res.status(500).json({ error: 'algo-coach failed' });
  }
}

module.exports = withCronGuard('algo-coach', handler);
module.exports.pickClosest3h = pickClosest3h;
module.exports.pickClosestAge = pickClosestAge;
module.exports.percentileOf = percentileOf;
module.exports.earlyAlertKey = earlyAlertKey;
