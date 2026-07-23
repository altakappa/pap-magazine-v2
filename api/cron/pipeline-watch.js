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
const { listRecentMedia } = require('../_lib/instagramImport');

const ALERT_KEY = 'ig-to-site-pipeline';
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

  const d = diagnose(media, rows);
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

  return res.status(200).json({ ok: true, ...d, alerted: !!pushed, push: pushed });
});

module.exports.diagnose = diagnose;
module.exports.buildAlert = buildAlert;
