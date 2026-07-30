/**
 * PAP Magazine — 파이프라인 감시 크론 (2026-07-21 신설)
 * Route: /api/cron/pipeline-watch   (vercel.json: 30분마다)
 *
 * 왜 만들었나 (2026-07-15~19 사고):
 * IG_QUALITY_GATE 가 켜진 채 5일간 인스타 기사가 전부 draft 로 쌓였고 아무도
 * 몰랐다. 웹사이트는 모든 채널의 소재 창고라서, 여기가 막히자 네이버 초안이
 * 하루 26건 → 1~6건으로 주저앉았고 스레드·틱톡·유튜브 자동게시도 함께 굶었다.
 * 도메니코가 우연히 발견하지 않았다면 더 갔다. 감시가 없었던 것이 진짜 문제다.
 *
 * 무엇을 보나 — 인스타에 올라간 게시물이 웹사이트에 발행됐는가.
 *   ① 미수집: IG 에는 있는데 articles 에 아예 없다 (sync-instagram 이 죽었다)
 *   ② draft 정체: 수집은 됐는데 published 가 아니다 (게이트·필터가 막고 있다)
 * GRACE_HOURS 보다 오래된 게시물만 본다 — 방금 올린 건 아직 정상 대기 중이다.
 *
 * 알림: 텔레그램(pushAlert). ops_alert_state 로 쿨다운 — 막힌 상태가 지속될 때
 * 30분마다 같은 알림이 오지 않게 한다. 복구되면 "정상화" 알림을 한 번 보낸다.
 *
 * 수동: ?dry=1 (알림 없이 진단만)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { pushAlert } = require('../_lib/pushAlert');
const { listRecentMedia, isLikelyEditorialCaption, _extractShortcode } = require('../_lib/instagramImport');
const { diagnoseBackfill, buildBackfillAlert } = require('../_lib/backfillHealth');

const ALERT_KEY = 'ig-to-site-pipeline';
/* 서술문 백필은 IG 파이프라인과 독립적인 문제라 알림 키를 분리한다 —
   한쪽 쿨다운이 다른 쪽 알림을 삼키면 안 된다. (2026-07-30) */
const BACKFILL_ALERT_KEY = 'editorial-backfill-health';
const SITE = 'https://www.pap-magazine.com';

/* 게시 후 이 시간이 지나도 발행되지 않으면 이상으로 본다.
   sync-instagram 은 10분마다 도므로 3시간이면 충분히 여유가 있다. */
const GRACE_HOURS = Number(process.env.PIPELINE_GRACE_HOURS || 3);
/* 같은 문제로 다시 알리기까지의 최소 간격. */
const COOLDOWN_HOURS = Number(process.env.PIPELINE_ALERT_COOLDOWN_H || 6);

/**
 * IG 게시물 목록 + DB 상태 → 진단 결과 (순수 함수, 테스트 대상).
 * media: [{ id, permalink, timestamp }]
 * rows:  [{ source_instagram_post_id, status }]
 */
function diagnose(media, rows, opts) {
  const now = (opts && opts.now) || Date.now();
  const graceMs = ((opts && opts.graceHours) || GRACE_HOURS) * 3600000;

  const byId = new Map();
  for (const r of rows || []) {
    if (r && r.source_instagram_post_id) byId.set(String(r.source_instagram_post_id), r.status);
  }

  const missing = [];   // IG 에는 있는데 DB 에 없음
  const stuck = [];     // DB 에 있는데 published 아님
  let checked = 0;

  for (const m of media || []) {
    if (!m || !m.id || !m.timestamp) continue;
    const ts = Date.parse(m.timestamp);
    if (isNaN(ts) || now - ts < graceMs) continue; // 아직 유예 중
    // 2026-07-26 — 에디토리얼(운영자 수동 업로드 대상)은 기사 자동수집 감시 대상이
    // 아니다. articles 에 없는 게 정상이라 '미수집' 오탐을 유발했다 → 제외한다.
    {
      const _edSet = (opts && opts.editorialShortcodes) || null;
      const _sc = _extractShortcode(m.permalink);
      if ((_edSet && _sc && _edSet.has(_sc)) || isLikelyEditorialCaption(m.caption)) continue;
    }
    checked++;
    const status = byId.get(String(m.id));
    const info = {
      id: String(m.id),
      permalink: m.permalink || null,
      age_hours: Math.round(((now - ts) / 3600000) * 10) / 10,
    };
    if (status === undefined) missing.push(info);
    else if (status !== 'published') stuck.push(Object.assign({ status }, info));
  }

  return { checked, missing, stuck, healthy: missing.length === 0 && stuck.length === 0 };
}

/** 알림 문구 — 원인 후보까지 같이 준다 (새벽에 받아도 바로 판단되게). */
function buildAlert(d) {
  const lines = [`유예 ${GRACE_HOURS}시간 넘은 IG 게시물 ${d.checked}건 점검`];
  if (d.stuck.length) {
    lines.push('', `⛔ draft 정체 ${d.stuck.length}건 — 수집은 됐으나 발행 안 됨`);
    lines.push('   원인 후보: IG_QUALITY_GATE / IG_WEEKLY_AUTO_LIMIT (Vercel env)');
    for (const s of d.stuck.slice(0, 3)) lines.push(`   · ${s.age_hours}h 경과 (${s.status})`);
  }
  if (d.missing.length) {
    lines.push('', `⛔ 미수집 ${d.missing.length}건 — articles 에 아예 없음`);
    lines.push('   원인 후보: sync-instagram 크론 실패 / IG 토큰 만료');
    for (const m of d.missing.slice(0, 3)) lines.push(`   · ${m.age_hours}h 경과`);
  }
  lines.push('', '웹사이트가 막히면 네이버·스레드·틱톡·유튜브가 함께 굶습니다.');
  return {
    title: `🚧 PAP 파이프라인 정체 — IG ${d.stuck.length + d.missing.length}건 미발행`,
    lines,
    url: `${SITE}/admin/news`,
    urlLabel: '어드민에서 확인',
  };
}

module.exports = withCronGuard('pipeline-watch', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }
  const dry = !!(req.query && req.query.dry === '1');

  const media = await listRecentMedia({ limit: 25 });
  const ids = (media || []).map(m => m && m.id).filter(Boolean).map(String);
  const { data: rows } = ids.length
    ? await supabaseAdmin.from('articles')
        .select('source_instagram_post_id, status')
        .in('source_instagram_post_id', ids)
    : { data: [] };

  // 에디토리얼 shortcode 집합 — 감시에서 에디토리얼 제외(미수집 오탐 방지, 2026-07-26).
  const { data: _eds } = await supabaseAdmin
    .from('editorials').select('source_instagram_url')
    .not('source_instagram_url', 'is', null).limit(5000);
  const editorialShortcodes = new Set(
    (_eds || []).map((e) => _extractShortcode(e.source_instagram_url)).filter(Boolean)
  );
  const d = diagnose(media, rows, { editorialShortcodes });
  if (dry) return res.status(200).json({ ok: true, dry: true, ...d });

  const { data: state } = await supabaseAdmin.from('ops_alert_state')
    .select('last_alert_at, last_payload').eq('key', ALERT_KEY).maybeSingle();
  const lastAt = state && state.last_alert_at ? Date.parse(state.last_alert_at) : 0;
  const wasBroken = !!(state && state.last_payload && state.last_payload.broken);

  let pushed = null;

  if (!d.healthy) {
    const cooled = Date.now() - lastAt > COOLDOWN_HOURS * 3600000;
    if (cooled) {
      pushed = await pushAlert({ ...buildAlert(d), personalOnly: true });
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: ALERT_KEY,
        last_alert_at: new Date().toISOString(),
        last_payload: { broken: true, stuck: d.stuck.length, missing: d.missing.length },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
  } else if (wasBroken) {
    // 복구 알림은 쿨다운과 무관하게 한 번 — "고쳐졌다"는 정보는 늦으면 의미가 없다.
    pushed = await pushAlert({
      personalOnly: true,
      title: '✅ PAP 파이프라인 정상화 — IG → 웹사이트 자동발행 복구',
      lines: [`유예 시간 지난 게시물 ${d.checked}건 모두 발행됨`],
      url: `${SITE}/articles`,
      urlLabel: '기사 목록',
    });
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: ALERT_KEY,
      last_alert_at: new Date().toISOString(),
      last_payload: { broken: false },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }

  /* ── 서술문 백필 건강도 (2026-07-30 추가) ──
   * IG 파이프라인과 같은 크론에 얹는다: 알림·쿨다운 기계가 이미 검증돼 있고
   * 크론 슬롯(32/40)도 아낀다. 판정은 별도 키로 독립 관리한다. */
  const backfill = await checkBackfill({ dry });

  return res.status(200).json({ ok: true, ...d, alerted: !!pushed, push: pushed, backfill });
});

/** 서술문 생산이 실제로 되고 있는지 보고, 이상하면 텔레그램으로 알린다. */
async function checkBackfill(opts) {
  const WINDOW_H = Number(process.env.BACKFILL_WINDOW_HOURS || 3);
  try {
    const { data, error } = await supabaseAdmin.rpc('backfill_health_stats', { window_hours: WINDOW_H });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { skipped: 'no stats' };

    const d = diagnoseBackfill({
      attempts: row.attempts,
      successes: row.successes,
      remaining: row.remaining,
      lastAttemptAgoMs: row.last_attempt_ago_seconds == null
        ? null : Number(row.last_attempt_ago_seconds) * 1000,
    });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', BACKFILL_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.BACKFILL_ALERT_COOLDOWN_H || 6);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildBackfillAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      // 복구는 쿨다운 무시 — "고쳐졌다"는 정보는 늦으면 쓸모가 없다.
      await pushAlert({
        personalOnly: true,
        title: '✅ 서술문 백필 정상화 — 성공률 ' + d.rate + '%',
        lines: [`최근 ${WINDOW_H}시간 ${d.attempts}건 중 ${d.successes}건 생성 · 남은 ${d.remaining}건`],
        url: `${SITE}/magazine`, urlLabel: '매거진',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: BACKFILL_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, rate: d.rate, remaining: d.remaining },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    // 감시가 죽어도 본 크론(IG 파이프라인 감시)은 계속 돌아야 한다.
    console.error('[pipeline-watch] backfill health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.diagnose = diagnose;
module.exports.buildAlert = buildAlert;
