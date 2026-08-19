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
const { judgeTranslateHealth, buildTranslateAlert } = require('../_lib/translateHealth');
const { judgeFaqHealth, buildFaqAlert, summarizeFaqRuns } = require('../_lib/faqHealth');
const { summarizeDurations, judgeCronDuration, buildCronDurationAlert } = require('../_lib/cronDurationHealth');

const ALERT_KEY = 'ig-to-site-pipeline';
/* 서술문 백필은 IG 파이프라인과 독립적인 문제라 알림 키를 분리한다 —
   한쪽 쿨다운이 다른 쪽 알림을 삼키면 안 된다. (2026-07-30) */
const BACKFILL_ALERT_KEY = 'editorial-backfill-health';
/* 번역도 같은 이유로 키를 분리한다 (2026-07-31). */
const TRANSLATE_ALERT_KEY = 'translate-backfill-health';
/* 릴스 mp4 수집 건강도 — 유튜브 쇼츠의 연료가 실제로 채워지는지 본다 (2026-08-04). */
const REEL_ALERT_KEY = 'reel-video-health';
/* FAQ 백필도 같은 이유로 키를 분리한다 (2026-08-04). */
const FAQ_ALERT_KEY = 'faq-backfill-health';
/* 크론 실행시간 — 함수 상한에 잘려 죽는 실행을 찾는다 (2026-08-04). */
const DURATION_ALERT_KEY = 'cron-duration-health';
/* 네이버 초안 — 상한·정지로 생성이 멎었는지 본다 (2026-08-07). */
const NAVER_ALERT_KEY = 'naver-draft-health';
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

  /* ── 번역 백필 정체 감시 (2026-07-31 추가) ──
   * es 는 7/24, ja 는 7/22 이후 한 건도 안 늘었는데 아무도 몰랐다. 크론은
   * 성실히 돌았고 전부 ok 였다 — 저장만 0건이었다. 서술문 백필에서 이미
   * 배운 교훈("돌았다 ≠ 생산했다")을 번역에는 안 붙여둔 상태였다. */
  const translate = await checkTranslate({ dry });

  /* ── 릴스 mp4 수집 감시 (2026-08-04 추가) ──
   * youtube-post 는 8일 동안 1,353회를 '성공'으로 돌면서 쇼츠를 거의
   * 못 올렸다. 매번 남긴 말이 "업로드할 릴스 기사 없음" 이었기 때문이다.
   * 후보가 없다는 건 두 가지 뜻이 될 수 있는데 —
   *   ① 정말 릴스를 안 올렸다 (정상)
   *   ② 릴스 기사는 들어왔는데 mp4 가 안 붙었다 (고장)
   * 크론은 둘을 구분하지 못하고 똑같이 ok=true 를 남겼다. 그 침묵이
   * 8일을 갔다. 여기서 그 둘을 갈라서, ②일 때만 울린다. */
  const reels = await checkReelVideos({ dry });

  /* ── FAQ 백필 감시 (2026-08-04 추가) ──
   * 서술문·번역에서 두 번 배운 "돌았다 ≠ 생산했다" 를 FAQ 에만 안 붙여둬서
   * 세 번째로 같은 침묵을 겪었다. 10분마다 성실히 돌면서 생산은 0건이었고,
   * 크론은 그걸 '완주' 라고 보고했다. 이제 잔여와 실제 생산량을 대조한다. */
  const faq = await checkFaq({ dry });

  /* ── 크론 실행시간 감시 (2026-08-04 추가) ──
   * 앞의 네 감시는 모두 '생산량' 을 본다. 그런데 번역 백필은 6시간 동안
   * 22번을 Vercel 120초 상한에 잘려 죽었는데, cron_runs 의 실패는 0건이었다 —
   * 도중에 죽은 함수는 자기 죽음을 기록할 수 없기 때문이다. 성공률만 보면
   * 평화롭다. 그래서 이건 성공/실패가 아니라 시간을 본다. */
  const duration = await checkDuration({ dry });

  /* ── 네이버 초안 생산 감시 (2026-08-07 추가) ──
   * 08-05 에 건 큐 상한이 08-05 17:01 부터 생성을 완전히 멈췄는데, 크론은
   * 4시간마다 ok=true 로 "큐 상한 도달" 만 남겼다. 이틀 뒤 사람이 눈으로
   * 발견했다. 더 나쁜 건 초안 후보가 '최근 3일 발행' 로 한정된다는 점이다 —
   * 3일 넘게 멎으면 그 구간 기사는 영영 초안이 만들어지지 않는다.
   * 그래서 여기서는 "막혔다" 를 3일이 되기 전에 잡는다. */
  const naver = await checkNaverDrafts({ dry });

  /* ── 틱톡 게시 감시 (2026-08-07 추가) ──
   * 틱톡은 21일 동안 0건이었는데 cron_runs 는 전부 ok 였다. 조기 반환에서
   * res.locals.cronNote 를 안 세운 탓에 기록이 통째로 비어 있었기 때문이다.
   * 이제 크론의 자기보고 대신 tiktok_posts 행 수를 직접 센다. */
  const tiktok = await checkTikTok({ dry });

  /* ── 죽은사람 스위치 (2026-08-07 추가) ──
   * 맥미니 영상 압축기는 서버 밖에서 돈다. 조용히 멈춰도 cron_runs 에
   * 흔적이 없다. 그래서 '기록이 안 오는 것' 자체를 신호로 읽는다. */
  const heartbeat = await checkHeartbeats({ dry });

  /* IG 토큰 생존 감시 (2026-08-19 추가).
   * 2026-07-26 에 IG 토큰 6개가 죽어 24시간 719회 실패했는데 아무 소리가 없었다.
   * 크론은 ok=true 로 '수집 0건'을 남기고 끝났기 때문이다. 0건은 조용한 실패의
   * 얼굴이다. 토큰은 60일마다 죽으므로 이 침묵은 반드시 반복된다.
   * 그래서 성공/실패가 아니라 '토큰이 살아 있는가'를 따로 묻는다. */
  const igToken = await checkIgToken({ dry });

  /* ── 유튜브 영상 생존 감시 (2026-08-07 추가) ──
   * 앞의 감시들이 '안 만들어지는 것'을 본다면, 이건 '만들어놓고 사라지는 것'을
   * 본다. 게시는 끝이 아니라 시작이다. */
  const ytVideos = await checkYouTubeVideos({ dry });
  const newsletter = await checkNewsletter({ dry });

  /* ── 시작만 하고 안 끝난 실행 감시 (2026-08-10 추가) ──
   * checkDuration 의 머리말은 "도중에 죽은 함수는 자기 죽음을 기록할 수 없다"
   * 고 적어 뒀다. 맞았다 — weekly-news 는 34일간 매주 120초 상한에 죽었는데
   * cron_runs 행이 **0건**이라 어떤 감시에도 안 잡혔다.
   * 이제 cronGuard 가 시작할 때 먼저 한 줄을 남기므로, 죽은 실행은
   * '안 끝난 줄'로 남는다. 그 줄을 여기서 읽는다. */
  const deadRuns = await checkDeadRuns({ dry });

  /* ── 연속 실패 감시 (2026-08-17 추가) ──
   * 위 감시들은 전부 '특정 파이프라인' 또는 '안 끝난 실행' 을 본다.
   * 그래서 drive-youtube-post 가 48회 연속 ok=false 로 **정상 종료**하는
   * 동안 아무 데도 안 걸렸다. 가장 단순한 신호를 아무도 안 듣고 있었다.
   * 이건 크론 이름을 가리지 않고 '연속으로 실패하는 것' 만 본다. */
  const failingCrons = await checkFailingCrons({ dry });

  return res.status(200).json({ ok: true, ...d, alerted: !!pushed, push: pushed, backfill, translate, reels, faq, duration, naver, tiktok, heartbeat, igToken, ytVideos, newsletter, deadRuns, failingCrons });
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
      // 2026-07-30: 실제 생산량 기준으로 판정한다(구 successes 는 과대평가했다).
      filled: row.filled,
      attemptsSinceStamp: row.attempts_since_stamp,
      everFilled: row.ever_filled,
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
        lines: [`최근 ${WINDOW_H}시간 ${d.attemptsSinceStamp || d.attempts}건 중 ${d.basis === 'filled' ? d.filled : d.successes}건 생성 · 남은 ${d.remaining}건`],
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

/**
 * 번역이 실제로 생산되고 있는지 본다. 판정 규칙은 _lib/translateHealth.js.
 *
 * 여기서 세는 것은 '크론이 돌았는가' 가 아니라 **'행이 실제로 채워졌는가'** 다.
 * seo_translations 의 최근 갱신분 중 내용 길이가 기준을 넘는 것만 센다 —
 * 빈 껍데기 행이 '완료'로 잡혀 2,450건이 방치됐던 전례가 있다.
 */
async function checkTranslate(opts) {
  const WINDOW_H = Number(process.env.TRANSLATE_WINDOW_HOURS || 3);
  try {
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();

    const { data, error } = await supabaseAdmin.rpc('translate_health_stats', { window_hours: WINDOW_H });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { skipped: 'no stats' };

    const { count: runs } = await supabaseAdmin
      .from('cron_runs').select('*', { count: 'exact', head: true })
      .eq('cron_name', 'backfill-translations').gte('ran_at', since);

    const d = judgeTranslateHealth({
      remaining: Number(row.remaining) || 0,
      producedInWindow: Number(row.produced) || 0,
      windowHours: WINDOW_H,
      runsInWindow: typeof runs === 'number' ? runs : null,
    });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', TRANSLATE_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.TRANSLATE_ALERT_COOLDOWN_H || 6);
    const broken = d.status === 'stalled';

    let alerted = false;
    if (broken && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildTranslateAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (!broken && wasBroken) {
      // 복구·완주는 쿨다운 무시 — 늦게 오면 쓸모가 없다.
      await pushAlert({
        personalOnly: true,
        title: d.status === 'done' ? '✅ 번역 백필 완주 — 9개 언어 100%' : '✅ 번역 백필 재개',
        lines: [d.reason],
        url: `${SITE}/magazine`, urlLabel: '매거진',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== broken) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: TRANSLATE_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken, status: d.status, remaining: d.remaining, perHour: d.perHour },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    // 감시가 죽어도 본 크론은 계속 돌아야 한다.
    console.error('[pipeline-watch] translate health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

/**
 * 릴스 → 쇼츠 연료 건강도 판정 (순수 함수, 테스트 대상).
 *
 * 핵심 아이디어: "후보 0건" 이라는 말 자체는 정보가 없다. 같은 문장이
 * 정상(릴스를 안 올린 날)일 수도, 고장(mp4 수집 실패)일 수도 있다.
 * 그래서 **기사 쪽 사실**과 대조한다 — 창 안에 릴스 기사가 있었는가,
 * 그중 mp4 가 붙은 게 하나라도 있는가.
 *
 * @param {object} x
 * @param {number} x.videoArticles   창 안 published 릴스(source_media_type='VIDEO') 기사 수
 * @param {number} x.withVideo       그중 videos 가 실제로 채워진 기사 수
 * @param {number} x.uploadsInWindow 창 안 유튜브 업로드 성공 수
 * @param {number} x.zeroRuns        창 안 youtube-post 실행 중 '후보 없음' 으로 끝난 횟수
 * @param {number} x.runsInWindow    창 안 youtube-post 총 실행 수
 * @param {number} x.windowHours
 * @returns {{healthy:boolean, cause:(string|null), reason:string, ...}}
 */
function judgeReelHealth(x) {
  const videoArticles = Number(x && x.videoArticles) || 0;
  const withVideo = Number(x && x.withVideo) || 0;
  const uploadsInWindow = Number(x && x.uploadsInWindow) || 0;
  const zeroRuns = Number(x && x.zeroRuns) || 0;
  const runsInWindow = Number(x && x.runsInWindow) || 0;
  const windowHours = Number(x && x.windowHours) || 72;
  const base = { videoArticles, withVideo, uploadsInWindow, zeroRuns, runsInWindow, windowHours };

  // 릴스 기사 자체가 없으면 판단하지 않는다. 릴스를 안 올린 주간에
  // "쇼츠가 0건"인 것은 고장이 아니다 — 여기서 울리면 그게 노이즈다.
  if (videoArticles === 0) {
    return { ...base, healthy: true, cause: null,
      reason: `최근 ${windowHours}시간 릴스 기사 0건 — 판단 보류(정상)` };
  }

  // ① 연료 자체가 안 채워진 경우. 기사는 릴스로 들어왔는데 mp4 가 단 하나도
  //    없다 = archiveVideosToStorage 가 빈손으로 끝났다는 뜻이다.
  if (withVideo === 0) {
    return { ...base, healthy: false, cause: 'mp4-missing',
      reason: `릴스 기사 ${videoArticles}건이 모두 mp4 없이 발행됨 (videos=[])` };
  }

  // ② 연료는 있는데 크론이 계속 "후보 없음" 만 말하는 경우. 실행이 충분히
  //    쌓였고(≥3), 그 전부가 후보 없음이고, 업로드도 0건일 때만 고장으로 본다.
  //    (일일 상한·공개 대기 모드는 다른 문구를 남기므로 여기 걸리지 않는다.)
  if (uploadsInWindow === 0 && runsInWindow >= 3 && zeroRuns >= runsInWindow) {
    return { ...base, healthy: false, cause: 'candidates-ignored',
      reason: `mp4 있는 릴스 기사 ${withVideo}건이 있는데 ${runsInWindow}회 실행 전부 '후보 없음'` };
  }

  return { ...base, healthy: true, cause: null,
    reason: `릴스 ${videoArticles}건 중 ${withVideo}건 mp4 보유 · 업로드 ${uploadsInWindow}건` };
}

/** 릴스 건강도 알림 문구 — 원인별로 다음 행동까지 적는다. */
function buildReelAlert(d, site) {
  const lines = [d.reason, ''];
  if (d.cause === 'mp4-missing') {
    lines.push('원인 후보: Graph API 가 VIDEO 에 media_url 을 주지 않음 (07-31 실측)');
    lines.push('           IG 토큰 만료 / 영상 60MB 초과 / Storage 업로드 실패');
    lines.push('');
    lines.push('조치: /api/cron/video-repair 가 자동 복구를 시도합니다.');
    lines.push('      Vercel 로그에서 [ig-video] 를 검색하면 실패 사유가 보입니다.');
  } else {
    lines.push('원인 후보: youtube-post 의 신선도 창(3일) 밖으로 밀림 /');
    lines.push('           youtube_posts 중복 판정 / YOUTUBE_PUBLIC 미설정');
  }
  lines.push('');
  lines.push('쇼츠가 멈추면 유튜브발 인스타 유입도 함께 멈춥니다.');
  return {
    title: '🎬 PAP 쇼츠 연료 이상 — 릴스 mp4 ' + (d.cause === 'mp4-missing' ? '수집 실패' : '적체'),
    lines,
    url: `${site || SITE}/admin/news`,
    urlLabel: '어드민에서 확인',
  };
}

/**
 * 릴스 mp4 가 실제로 채워지고 있는지 본다.
 *
 * "돌았다 ≠ 생산했다" 는 서술문·번역에서 이미 두 번 배운 교훈이다.
 * 유튜브만 그 교훈이 안 붙어 있어서 8일을 놓쳤다 — 세 번째로 같은 걸
 * 반복하지 않기 위해 여기 붙인다.
 */
async function checkReelVideos(opts) {
  const WINDOW_H = Number(process.env.REEL_WINDOW_HOURS || 72);
  try {
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();

    // youtube-post 의 후보 조건과 같은 창·같은 필터로 본다 — 감시가 대상과
    // 다른 걸 세면 "감시는 정상인데 크론은 굶는" 어긋남이 생긴다.
    const { data: arts } = await supabaseAdmin.from('articles')
      .select('id, videos')
      .eq('status', 'published')
      .eq('source_media_type', 'VIDEO')
      .gte('published_date', since)
      .limit(200);
    const videoArticles = (arts || []).length;
    const withVideo = (arts || []).filter(
      (a) => Array.isArray(a.videos) && a.videos.length && a.videos[0]).length;

    const { data: runs } = await supabaseAdmin.from('cron_runs')
      .select('note, ok').eq('cron_name', 'youtube-post').gte('ran_at', since).limit(2000);
    const runsInWindow = (runs || []).length;
    const zeroRuns = (runs || []).filter(
      (r) => r && typeof r.note === 'string' && r.note.indexOf('업로드할 릴스 기사 없음') === 0).length;

    const { count: uploads } = await supabaseAdmin.from('youtube_posts')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'failed').gte('created_at', since);

    const d = judgeReelHealth({
      videoArticles, withVideo, zeroRuns, runsInWindow,
      uploadsInWindow: typeof uploads === 'number' ? uploads : 0,
      windowHours: WINDOW_H,
    });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', REEL_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.REEL_ALERT_COOLDOWN_H || 12);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildReelAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      // 복구는 쿨다운 무시 — 다른 감시들과 같은 규칙.
      await pushAlert({
        personalOnly: true,
        title: '✅ PAP 쇼츠 연료 정상화 — 릴스 mp4 수집 복구',
        lines: [d.reason],
        url: `${SITE}/admin/news`, urlLabel: '어드민에서 확인',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: REEL_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, cause: d.cause, videoArticles: d.videoArticles, withVideo: d.withVideo },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    // 감시가 죽어도 본 크론은 계속 돌아야 한다.
    console.error('[pipeline-watch] reel video health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

/**
 * FAQ 백필이 실제로 생산하고 있는지 본다. 판정 규칙은 _lib/faqHealth.js.
 *
 * 생산량의 근거는 cron_runs.note 다 — 크론이 남기는 요약 한 줄. 별도 도장
 * 컬럼을 만들지 않은 이유는, 어차피 사람이 볼 기록이 그 한 줄이기 때문이다.
 * 요약과 감시가 같은 문장을 보면 둘이 어긋날 일이 없다.
 */
async function checkFaq(opts) {
  const WINDOW_H = Number(process.env.FAQ_WINDOW_HOURS || 3);
  try {
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();

    const { count: remaining } = await supabaseAdmin
      .from('articles').select('id', { count: 'exact', head: true })
      .eq('status', 'published').is('faq', null);

    const { data: runRows } = await supabaseAdmin
      .from('cron_runs').select('note')
      .eq('cron_name', 'backfill-faq').gte('ran_at', since)
      .order('ran_at', { ascending: false }).limit(200);

    const sum = summarizeFaqRuns((runRows || []).map(r => r && r.note));
    const d = judgeFaqHealth({
      remaining: typeof remaining === 'number' ? remaining : 0,
      producedInWindow: sum.produced,
      windowHours: WINDOW_H,
      runsInWindow: sum.total,
      parsedRuns: sum.parsed,
      wallRuns: sum.wall,
      doneRuns: sum.done,
    });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', FAQ_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.FAQ_ALERT_COOLDOWN_H || 6);
    const broken = d.status === 'stalled';

    let alerted = false;
    if (broken && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildFaqAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (!broken && wasBroken) {
      await pushAlert({
        personalOnly: true,
        title: d.status === 'done' ? '✅ FAQ 백필 완주 — 발행 기사 전부 보유' : '✅ FAQ 백필 재개',
        lines: [d.reason],
        url: `${SITE}/admin`, urlLabel: '어드민',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== broken) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: FAQ_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken, status: d.status, cause: d.cause, remaining: d.remaining, perHour: d.perHour },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    console.error('[pipeline-watch] faq health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

/**
 * 크론들의 실행시간을 보고, 함수 상한에 붙기 시작하면 알린다.
 * 판정 규칙은 _lib/cronDurationHealth.js (순수 함수).
 *
 * 상한에 걸려 강제종료된 실행은 이 표에 아예 남지 않는다. 그래서 남은
 * 기록만으로도 보이는 신호 — '상한에 거의 닿은 실행의 비율' — 을 본다.
 * 잘려 죽은 것들은 보이지 않으므로, 여기 보이는 숫자는 항상 과소평가다.
 */
async function checkDuration(opts) {
  const WINDOW_H = Number(process.env.CRON_DURATION_WINDOW_HOURS || 3);
  try {
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from('cron_runs').select('cron_name, duration_ms')
      .gte('ran_at', since).limit(5000);
    if (error) throw error;

    const summary = summarizeDurations(rows || []);
    const d = judgeCronDuration(summary, { windowHours: WINDOW_H });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', DURATION_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.CRON_DURATION_COOLDOWN_H || 6);
    const broken = !d.healthy;

    let alerted = false;
    if (broken && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildCronDurationAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (!broken && wasBroken) {
      await pushAlert({
        personalOnly: true,
        title: '✅ 크론 실행시간 정상화 — 예산 안으로 돌아옴',
        lines: [d.reason],
        url: `${SITE}/admin`, urlLabel: '어드민',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== broken) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: DURATION_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken, status: d.status, worst: d.worst || null, judged: d.judged },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    console.error('[pipeline-watch] cron duration health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.diagnose = diagnose;
module.exports.buildAlert = buildAlert;
module.exports.judgeReelHealth = judgeReelHealth;
module.exports.buildReelAlert = buildReelAlert;
module.exports.judgeFaqHealth = judgeFaqHealth;
module.exports.buildFaqAlert = buildFaqAlert;
module.exports.judgeCronDuration = judgeCronDuration;
module.exports.buildCronDurationAlert = buildCronDurationAlert;
module.exports.summarizeDurations = summarizeDurations;

/**
 * 네이버 초안 생산 건강도 판정 (순수 함수, 테스트 대상).
 *
 * "돌았다 ≠ 생산했다" 를 네 번째로 붙이는 자리다. 다만 여기엔 앞의 감시들에
 * 없던 함정이 하나 더 있다 — **초안 후보가 '최근 3일 발행 기사' 로 한정된다.**
 * 그래서 3일 넘게 멎으면 밀린 기사는 나중에 고쳐도 영영 못 만든다.
 * 정지를 '느리게' 잡으면 안 되는 이유가 이것이다.
 *
 * 오탐을 피하는 두 가지 전제:
 *   ① 만들 게 없으면 판단하지 않는다 — 미전환 기사 0건에 생산 0건은 정상이다.
 *   ② 실행 표본이 적으면 판단하지 않는다 — 크론이 4시간 간격이라 한두 번으로
 *      "생산 0" 을 고장이라 부르면 노이즈만 남는다.
 *
 * @param {object} x
 * @param {number} x.pendingSources   룩백 창 안 published 기사 중 초안이 없는 수
 * @param {number} x.producedInWindow 창 안 새로 만들어진 초안 수
 * @param {number} x.runsInWindow     창 안 naver-draft-sweep 실행 수
 * @param {number} x.queueSkipRuns    그중 '큐 상한 도달' 로 끝난 실행 수
 * @param {number} x.queueDraft       현재 대기(draft) 초안 수
 * @param {number} x.windowHours
 * @param {number} x.lookbackDays     초안 후보 신선도 창 (기본 3일)
 */
function judgeNaverDraftHealth(x) {
  const pendingSources = Number(x && x.pendingSources) || 0;
  const producedInWindow = Number(x && x.producedInWindow) || 0;
  const runsInWindow = Number(x && x.runsInWindow) || 0;
  const queueSkipRuns = Number(x && x.queueSkipRuns) || 0;
  const queueDraft = Number(x && x.queueDraft) || 0;
  const windowHours = Number(x && x.windowHours) || 24;
  const lookbackDays = Number(x && x.lookbackDays) || 3;
  const base = { pendingSources, producedInWindow, runsInWindow, queueSkipRuns,
    queueDraft, windowHours, lookbackDays };

  // ① 만들 게 없으면 정상이다. 기사가 없는 날 초안이 0건인 건 고장이 아니다.
  if (pendingSources === 0) {
    return { ...base, healthy: true, cause: null,
      reason: `최근 ${lookbackDays}일 미전환 기사 0건 — 판단 보류(정상)` };
  }

  // ② 하나라도 만들었으면 파이프는 살아 있다.
  if (producedInWindow > 0) {
    return { ...base, healthy: true, cause: null,
      reason: `${windowHours}시간 ${producedInWindow}건 생성 · 미전환 ${pendingSources}건 남음` };
  }

  // ③ 표본 부족 — 판단하지 않는다.
  if (runsInWindow < 2) {
    return { ...base, healthy: true, cause: null,
      reason: `실행 ${runsInWindow}회 — 표본 부족으로 판단 보류` };
  }

  // ④ 상한 때문에 스스로 멈춘 경우. 고장은 아니지만 방치하면 기사가 유실된다.
  if (queueSkipRuns >= runsInWindow) {
    return { ...base, healthy: false, cause: 'queue-full',
      reason: `큐 상한으로 ${runsInWindow}회 전부 생성 건너뜀 · 미전환 ${pendingSources}건이 ${lookbackDays}일 뒤 유실` };
  }

  // ⑤ 상한도 아닌데 생산이 0 — 진짜 정지다.
  return { ...base, healthy: false, cause: 'stalled',
    reason: `${runsInWindow}회 실행에 생성 0건 · 미전환 ${pendingSources}건 대기` };
}

/** 네이버 초안 알림 문구 — 원인별로 다음 행동까지 적는다. */
function buildNaverDraftAlert(d, site) {
  const lines = [d.reason, ''];
  if (d.cause === 'queue-full') {
    lines.push(`대기 초안 ${d.queueDraft}건이 상한에 걸려 생성이 멈춰 있습니다.`);
    lines.push('');
    lines.push('조치 ① 어드민에서 밀린 초안을 발행해 큐를 비우면 자동 재개');
    lines.push('조치 ② 급하면 Vercel env NAVER_DRAFT_QUEUE_MAX=0 (무제한)');
  } else {
    lines.push('원인 후보: NAVER_DRAFT_SWEEP_ENABLED=false / Claude API 키·한도');
    lines.push('           generateNext 예외 (Vercel 로그 [naver-draft-sweep])');
  }
  lines.push('');
  lines.push(`⚠️ 초안 후보는 '최근 ${d.lookbackDays}일 발행' 로 한정됩니다.`);
  lines.push(`   ${d.lookbackDays}일 안에 못 풀면 미전환 ${d.pendingSources}건은 영구 유실됩니다.`);
  return {
    title: `📝 네이버 초안 생성 정지 — 미전환 ${d.pendingSources}건`,
    lines,
    url: `${site || SITE}/naver-blog`,
    urlLabel: '초안 목록',
  };
}

/**
 * 네이버 초안이 실제로 만들어지고 있는지 본다.
 *
 * 생산량의 근거는 naver_blog_drafts 의 created_at 이다 — 크론 note 가 아니라
 * 표를 직접 센다. note 는 "큐 상한 도달" 처럼 성공을 말하면서 생산은 0인
 * 문장을 남길 수 있기 때문이다. 그 어긋남 자체가 이 감시의 대상이다.
 */
async function checkNaverDrafts(opts) {
  const WINDOW_H = Number(process.env.NAVER_DRAFT_WINDOW_HOURS || 24);
  const LOOKBACK_D = Math.max(1, parseInt(process.env.NAVER_DRAFT_LOOKBACK_DAYS || '3', 10) || 3);
  try {
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();
    const lookSince = new Date(Date.now() - LOOKBACK_D * 86400000).toISOString();

    // 후보 기사 — sweep 과 같은 창·같은 필터로 본다. 감시가 대상과 다른 걸
    // 세면 "감시는 평화로운데 크론은 굶는" 어긋남이 생긴다.
    const { data: arts } = await supabaseAdmin.from('articles')
      .select('slug').eq('status', 'published')
      .gte('published_date', lookSince).limit(500);
    const { data: made } = await supabaseAdmin.from('naver_blog_drafts')
      .select('source_slug').eq('brand', 'pap');
    const madeSet = new Set((made || []).map((m) => m && m.source_slug));
    const pendingSources = (arts || []).filter((a) => a && !madeSet.has(a.slug)).length;

    const { count: produced } = await supabaseAdmin.from('naver_blog_drafts')
      .select('*', { count: 'exact', head: true }).gte('created_at', since);
    const { count: queueDraft } = await supabaseAdmin.from('naver_blog_drafts')
      .select('*', { count: 'exact', head: true }).eq('status', 'draft');

    const { data: runs } = await supabaseAdmin.from('cron_runs')
      .select('note').eq('cron_name', 'naver-draft-sweep').gte('ran_at', since).limit(500);
    const runsInWindow = (runs || []).length;
    const queueSkipRuns = (runs || []).filter(
      (r) => r && typeof r.note === 'string' && r.note.indexOf('큐 상한 도달') !== -1).length;

    const d = judgeNaverDraftHealth({
      pendingSources,
      producedInWindow: typeof produced === 'number' ? produced : 0,
      queueDraft: typeof queueDraft === 'number' ? queueDraft : 0,
      runsInWindow, queueSkipRuns,
      windowHours: WINDOW_H, lookbackDays: LOOKBACK_D,
    });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', NAVER_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.NAVER_DRAFT_ALERT_COOLDOWN_H || 6);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildNaverDraftAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      // 복구는 쿨다운 무시 — 다른 감시들과 같은 규칙.
      await pushAlert({
        personalOnly: true,
        title: '✅ 네이버 초안 생성 재개',
        lines: [d.reason],
        url: `${SITE}/naver-blog`, urlLabel: '초안 목록',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: NAVER_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, cause: d.cause,
          pending: d.pendingSources, queueDraft: d.queueDraft },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    // 감시가 죽어도 본 크론은 계속 돌아야 한다.
    console.error('[pipeline-watch] naver draft health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.judgeNaverDraftHealth = judgeNaverDraftHealth;
module.exports.buildNaverDraftAlert = buildNaverDraftAlert;

/* ── 틱톡 게시 감시 (2026-08-07 추가) ───────────────────────────
 * 틱톡은 21일 동안 한 건도 안 올라갔는데 cron_runs 는 전부 ok=true 였다.
 * 원인은 코드 한 줄이다 — 조기 반환에서 note 를 JSON 으로만 돌려주고
 * res.locals.cronNote 에 안 넣어서, 기록에는 '성공·메모 없음'만 남았다.
 * 대시보드에서 보면 완벽하게 평화로웠다.
 *
 * 그래서 이 감시는 크론의 자기보고(note)를 믿지 않는다. tiktok_posts
 * 테이블에 실제로 행이 늘었는지를 센다. 그리고 "후보가 있는데 생산이 0"
 * 일 때만 운다 — 올릴 게 없어서 조용한 것과 고장 나서 조용한 것을 가른다.
 *
 * 창은 30시간이다. 에디토리얼 크론은 하루 1회(02:00 UTC)뿐이라 24시간
 * 창은 실행 경계에서 표본 0이 되는 순간이 생긴다. 6시간 여유를 준다. */
const TIKTOK_ALERT_KEY = 'tiktok-post-health';

/**
 * 틱톡 게시 건강도 판정 (순수 함수, 테스트 대상).
 * @param {object} x
 * @param {number} x.candidates       아직 안 올린 게시 가능 콘텐츠 수
 * @param {number} x.producedInWindow 창 안에 실제로 생긴 tiktok_posts 성공 행 수
 * @param {number} x.failedInWindow   창 안 실패 행 수
 * @param {number} x.runsInWindow     창 안 tiktok-post 크론 실행 수
 * @param {number} x.unconfiguredRuns 그중 'BUFFER_API_KEY 미설정' 으로 건너뛴 수
 * @param {number} x.windowHours
 */
function judgeTikTokHealth(x) {
  const o = x || {};
  const cand = Number(o.candidates || 0);
  const made = Number(o.producedInWindow || 0);
  const failed = Number(o.failedInWindow || 0);
  const runs = Number(o.runsInWindow || 0);
  const unconf = Number(o.unconfiguredRuns || 0);
  const win = Number(o.windowHours || 30);
  const base = { candidates: cand, producedInWindow: made, failedInWindow: failed,
    runsInWindow: runs, unconfiguredRuns: unconf, windowHours: win };

  // ① 크론이 아예 안 돌았다 — vercel.json 에 등록돼 있는데 실행 0이면 배포·스케줄 문제.
  if (runs === 0) {
    return { ...base, healthy: false, cause: 'no-runs',
      reason: `최근 ${win}시간 tiktok-post 실행 0회 — 크론이 등록됐는데 안 돌고 있다` };
  }
  // ② 키가 없어서 매번 건너뛴다 — 이게 21일 침묵의 정확한 모양이다.
  if (unconf >= runs) {
    return { ...base, healthy: false, cause: 'not-configured',
      reason: `${runs}회 전부 BUFFER_API_KEY 미설정으로 건너뜀 — Vercel 환경변수 확인` };
  }
  // ③ 실패가 쌓인다 — Buffer 거부·채널 해제·키 만료.
  if (failed > 0) {
    return { ...base, healthy: false, cause: 'failing',
      reason: `최근 ${win}시간 게시 실패 ${failed}건 (성공 ${made}건) — tiktok_posts.detail 확인` };
  }
  // ④ 올릴 게 없다 — 정상. 여기서 고장을 논하면 오경보가 된다.
  if (cand === 0) {
    return { ...base, healthy: true, cause: null,
      reason: `미게시 후보 0건 — 올릴 게 없어서 조용한 것 (정상)` };
  }
  // ⑤ 실제로 생산했다 — 정상.
  if (made > 0) {
    return { ...base, healthy: true, cause: null,
      reason: `최근 ${win}시간 ${made}건 게시 — 정상` };
  }
  // ⑥ 표본이 너무 적다 — 판단 보류 (배포 직후 등).
  if (runs < 2) {
    return { ...base, healthy: true, cause: null,
      reason: `실행 ${runs}회뿐 — 표본 부족으로 판단 보류` };
  }
  // ⑦ 후보가 있는데 아무것도 안 나왔다 — 이게 진짜 고장이다.
  return { ...base, healthy: false, cause: 'stalled',
    reason: `후보 ${cand}건이 있는데 ${win}시간 게시 0건 (실행 ${runs}회) — 조용히 멎었다` };
}

function buildTikTokAlert(d, site) {
  const map = {
    'no-runs': '크론 미실행',
    'not-configured': 'BUFFER_API_KEY 미설정',
    'failing': 'Buffer 게시 실패',
    'stalled': '생산 정지',
  };
  return {
    title: '🚨 틱톡 게시 이상 — ' + (map[d.cause] || d.cause),
    lines: [
      d.reason,
      `후보 ${d.candidates}건 · 게시 ${d.producedInWindow}건 · 실패 ${d.failedInWindow}건 · 실행 ${d.runsInWindow}회`,
      '진단: /api/cron/tiktok-post?channels=1 (Buffer 채널 확인) · ?dry=1 (후보 확인)',
    ],
    url: `${site}/admin/crons`,
    urlLabel: '크론 상태',
  };
}

async function checkTikTok(opts) {
  try {
    const WINDOW_H = Number(process.env.TIKTOK_WATCH_WINDOW_HOURS || 30);
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();

    // 실제 생산량 — 크론의 자기보고가 아니라 테이블 행을 센다.
    const { data: recent } = await supabaseAdmin.from('tiktok_posts')
      .select('status, created_at').gte('created_at', since).limit(500);
    const rows = recent || [];
    const producedInWindow = rows.filter((r) => r && r.status !== 'failed').length;
    const failedInWindow = rows.filter((r) => r && r.status === 'failed').length;

    // 후보 — 크론과 같은 기준(발행·갤러리 2장 이상·미게시)으로 센다.
    // 감시가 대상과 다른 걸 세면 어긋난다.
    const { data: postedAll } = await supabaseAdmin.from('tiktok_posts')
      .select('editorial_id, status').limit(5000);
    const doneIds = new Set((postedAll || [])
      .filter((p) => p && p.status !== 'failed').map((p) => p.editorial_id).filter(Boolean));
    const { data: eds } = await supabaseAdmin.from('editorials')
      .select('id, gallery').eq('status', 'published')
      .order('published_date', { ascending: false }).limit(400);
    const candidates = (eds || []).filter(
      (e) => e && !doneIds.has(e.id) && Array.isArray(e.gallery) && e.gallery.length >= 2).length;

    const { data: runs } = await supabaseAdmin.from('cron_runs')
      .select('note').eq('cron_name', 'tiktok-post').gte('ran_at', since).limit(500);
    const runsInWindow = (runs || []).length;
    const unconfiguredRuns = (runs || []).filter(
      (r) => r && typeof r.note === 'string' && r.note.indexOf('BUFFER_API_KEY 미설정') !== -1).length;

    const d = judgeTikTokHealth({
      candidates, producedInWindow, failedInWindow,
      runsInWindow, unconfiguredRuns, windowHours: WINDOW_H,
    });
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', TIKTOK_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.TIKTOK_ALERT_COOLDOWN_H || 12);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildTikTokAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      await pushAlert({
        personalOnly: true,
        title: '✅ 틱톡 게시 재개',
        lines: [d.reason],
        url: `${SITE}/admin/crons`, urlLabel: '크론 상태',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: TIKTOK_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, cause: d.cause,
          candidates: d.candidates, produced: d.producedInWindow },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    console.error('[pipeline-watch] tiktok health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.judgeTikTokHealth = judgeTikTokHealth;
module.exports.buildTikTokAlert = buildTikTokAlert;

/* ── 죽은사람 스위치: 서버 밖 작업 감시 (2026-08-07 추가) ──────────
 * 맥미니 영상 압축기는 우리 서버 밖에서 돈다. 맥이 꺼지거나, macOS 권한이
 * 풀리거나, 드라이브 동기화가 끊기거나, ffmpeg 이 깨져도 cron_runs 에는
 * 아무 흔적이 안 남는다. 대시보드는 평화롭고 유튜브만 조용히 마른다.
 *
 * 앞의 감시들은 전부 '우리가 남긴 기록'을 읽는다. 이건 반대다 —
 * **기록이 안 오는 것 자체를 신호로 읽는다.** 살아 있으면 신호를 보내고,
 * 신호가 끊기면 그게 경보다.
 *
 * 창이 24시간이 아니라 30시간인 이유: 압축기는 5분마다 돌지만 맥미니를
 * 하룻밤 끄는 건 흔한 일이다. 24시간이면 주말마다 울린다. 울리는 감시는
 * 곧 무시되는 감시가 된다. */
const HEARTBEAT_ALERT_KEY = 'heartbeat-health';

/* 감시 대상 — 이름, 사람이 읽을 이름, 침묵 허용 시간(시간). */
/* ── IG 토큰 생존 감시 ───────────────────────────────────────────
 * 값은 절대 읽지 않는다. 살아 있는지만 묻는다.
 * 만료 시각은 app_secret 없이 알 수 없으므로 '죽었는가'로 대신한다.
 * 죽고 나서 아는 건 늦지만, 24시간 뒤에 아는 것보다는 훨씬 낫다. */
const IG_TOKEN_ALERT_KEY = 'ig-token-health';

async function checkIgToken(opts) {
  const token = String(process.env.IG_ACCESS_TOKEN || '').replace(/[\s"'`]/g, '');
  const userId = String(process.env.IG_USER_ID || '').replace(/[\s"'`]/g, '');
  if (!token || !userId) return { skipped: 'IG env 미설정' };

  let alive = false; let why = '';
  try {
    const r = await fetch(
      'https://graph.facebook.com/v21.0/' + userId + '?fields=id&access_token=' + encodeURIComponent(token),
      { signal: AbortSignal.timeout(12000) });
    const j = await r.json().catch(() => ({}));
    alive = !!(r.ok && j && j.id);
    if (!alive) {
      const e = (j && j.error) || {};
      why = 'code=' + e.code + ' ' + String(e.message || '').split(token).join('[TOKEN]').slice(0, 160);
    }
  } catch (e) {
    why = String((e && e.message) || e).slice(0, 160);
  }

  if (opts && opts.dry) return { dry: true, alive, why };

  const { data: st } = await supabaseAdmin.from('ops_alert_state')
    .select('last_alert_at, last_payload').eq('key', IG_TOKEN_ALERT_KEY).maybeSingle();
  const wasDead = !!(st && st.last_payload && st.last_payload.dead);
  const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
  const COOLDOWN_H = Number(process.env.IG_TOKEN_ALERT_COOLDOWN_H || 6);

  let alerted = false;
  if (!alive && Date.now() - lastAt > COOLDOWN_H * 3600000) {
    await pushAlert({
      personalOnly: true,
      title: '⛔ 인스타그램 토큰이 죽었습니다',
      lines: [
        'IG API 가 응답하지 않습니다: ' + why,
        '',
        '지금 멈춘 것: 기사 수집 · 스레드/X 발행 · 스팸 댓글 감시 · 하위 5계정 백필',
        '',
        '복구: 그래프 API 탐색기에서 토큰 재발급 → 액세스 토큰 확장(60일)',
        '→ Vercel env 6개(IG_ACCESS_TOKEN + 하위 5개) 전부 같은 값으로 → Redeploy',
      ],
      url: 'https://developers.facebook.com/tools/explorer/',
      urlLabel: '그래프 API 탐색기',
    });
    alerted = true;
  } else if (alive && wasDead) {
    await pushAlert({
      personalOnly: true,
      title: '✅ 인스타그램 토큰 복구됨',
      lines: ['IG API 응답 정상. 멈췄던 크론들이 다시 돕니다.'],
    });
    alerted = true;
  }
  if (alerted || wasDead !== !alive) {
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: IG_TOKEN_ALERT_KEY,
      last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
      last_payload: { dead: !alive, why: why || null },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }
  return { alive, why: why || null, alerted };
}

const HEARTBEATS = [
  { source: 'video-compress', label: '맥미니 영상 압축기', maxSilentH: 30 },
];

/**
 * 하트비트 침묵 판정 (순수 함수, 테스트 대상).
 * @param {Array} beats [{source,label,maxSilentH,lastAt(ms|null),ok,note,failed}]
 * @param {number} now
 */
function judgeHeartbeats(beats, now) {
  const t = now || Date.now();
  const rows = (beats || []).map((b) => {
    const silentH = b.lastAt ? (t - b.lastAt) / 3600000 : null;
    let state = 'ok';
    let reason = '';
    if (b.lastAt === null || b.lastAt === undefined) {
      // 한 번도 신호가 없다 = 아직 설치를 안 했다. 고장이 아니라 '미설치'다.
      // 여기서 울리면 설치 전까지 매번 울린다 — 그건 소음이다.
      state = 'never';
      reason = `${b.label}: 아직 한 번도 신호 없음 (미설치)`;
    } else if (silentH > b.maxSilentH) {
      state = 'silent';
      reason = `${b.label}: ${Math.floor(silentH)}시간째 신호 없음 (허용 ${b.maxSilentH}시간)`;
    } else if (b.ok === false) {
      state = 'failing';
      reason = `${b.label}: 마지막 신호가 실패 — ${b.note || '사유 없음'}`;
    } else if (b.failed > 0) {
      state = 'failing';
      reason = `${b.label}: 마지막 회차에 실패 ${b.failed}건 — ${b.note || ''}`;
    } else {
      reason = `${b.label}: ${silentH < 1 ? '방금' : Math.floor(silentH) + '시간 전'} 신호 정상`;
    }
    return { ...b, silentH, state, reason };
  });
  const broken = rows.filter((r) => r.state === 'silent' || r.state === 'failing');
  return {
    healthy: broken.length === 0,
    rows,
    broken,
    // 'never' 는 고장이 아니지만 응답에는 남겨서 설치 여부를 눈으로 볼 수 있게 한다.
    pending: rows.filter((r) => r.state === 'never').map((r) => r.source),
  };
}

function buildHeartbeatAlert(d, site) {
  const first = d.broken[0] || {};
  return {
    title: '🚨 ' + (first.state === 'silent' ? '외부 작업 신호 끊김' : '외부 작업 실패'),
    lines: d.broken.map((b) => b.reason).concat([
      first.state === 'silent'
        ? '확인: 맥미니가 켜져 있는지 · 시스템설정 → 개인정보보호 → 폴더 접근 허용 여부 · 구글 드라이브 동기화'
        : '확인: 맥미니에서 tail -30 ~/Library/Logs/pap-video-compress.log',
    ]),
    url: `${site}/admin/crons`,
    urlLabel: '크론 상태',
  };
}

async function checkHeartbeats(opts) {
  try {
    const keys = HEARTBEATS.map((h) => 'hb:' + h.source);
    const { data } = await supabaseAdmin.from('ops_alert_state')
      .select('key, last_payload, updated_at').in('key', keys);
    const byKey = new Map((data || []).map((r) => [r.key, r]));

    const beats = HEARTBEATS.map((h) => {
      const row = byKey.get('hb:' + h.source);
      const p = (row && row.last_payload) || null;
      const stamp = (p && p.beat_at) || (row && row.updated_at) || null;
      return {
        source: h.source, label: h.label, maxSilentH: h.maxSilentH,
        lastAt: stamp ? Date.parse(stamp) : null,
        ok: p ? p.ok !== false : undefined,
        note: (p && p.note) || '',
        failed: (p && p.failed) || 0,
      };
    });

    const d = judgeHeartbeats(beats, Date.now());
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', HEARTBEAT_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.HEARTBEAT_ALERT_COOLDOWN_H || 12);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildHeartbeatAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      await pushAlert({
        personalOnly: true,
        title: '✅ 외부 작업 신호 복구',
        lines: d.rows.map((r) => r.reason),
        url: `${SITE}/admin/crons`, urlLabel: '크론 상태',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: HEARTBEAT_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, sources: d.broken.map((b) => b.source) },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { healthy: d.healthy, rows: d.rows.map((r) => r.reason), pending: d.pending, alerted };
  } catch (e) {
    console.error('[pipeline-watch] heartbeat 감시 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.judgeHeartbeats = judgeHeartbeats;
module.exports.buildHeartbeatAlert = buildHeartbeatAlert;
module.exports.HEARTBEATS = HEARTBEATS;

/* ── 유튜브 영상 생존 감시 (2026-08-07 추가) ─────────────────────
 * 우리는 영상을 올려놓고 그 뒤를 한 번도 안 봤다. 2026-08-07 에 올린 영상
 * 하나가 사라진 것을 사람이 눈으로 발견했다(중복 업로드분을 지운 것이라
 * 결과적으로는 정상이었지만, 저작권 삭제였어도 똑같이 몰랐을 것이다).
 *
 * 앞의 감시들이 '안 만들어지는 것'을 본다면 이건 '만들어놓고 사라지는 것'을 본다.
 * 게시는 끝이 아니라 시작이다 — 올라간 뒤에 조용히 내려가는 일이 실제로 있다.
 *
 * 판정 대상:
 *   gone     : videos.list 응답에 없음 = 삭제됐거나 접근 불가
 *   private  : public 로 올렸는데 지금 public 이 아님
 *   rejected : 저작권·정책 등으로 거부됨 (rejectionReason)
 *   failed   : 처리 실패 (failureReason)
 * 최근 14일분만 본다 — 오래된 영상은 사람이 의도적으로 내렸을 수 있다. */
const YT_VIDEO_ALERT_KEY = 'youtube-video-health';

/* ── 뉴스레터 감시 (2026-08-07 신설) ────────────────────────────────
 *
 * 왜 필요했나 — 뉴스레터가 **한 달간 한 통도 안 나갔는데 아무도 몰랐다.**
 *   마지막 발송      2026-07-06 · 11통
 *   그 이후          0통
 *   캠페인 생성      5/12 · 5/26 · 6/02 · 6/29 · 7/06 · 7/19 → 그 뒤 없음
 *   draft 로 방치    5건
 *
 * 주간 크론은 일요일에 한 번 돈다. 한 번 실패하면 다음 기회가 일주일 뒤다.
 * 그래서 '며칠 조용하면 이상하다' 는 판단이 특히 잘 맞는 채널이다.
 *
 * 세 가지를 본다:
 *   ① 캠페인이 안 만들어진다        (생성 정체)
 *   ② 만들어졌는데 draft 로 멈췄다  (발송 크론이 안 집는다)
 *   ③ 보냈다는데 실제 발송이 0이다  ('돌았다 ≠ 했다')
 */
const NEWSLETTER_ALERT_KEY = 'nl:weekly';

function judgeNewsletter(rows, nowMs) {
  const list = (rows || []).slice();
  if (!list.length) {
    return { healthy: true, cause: null, reason: '캠페인 기록 없음 — 판단 보류' };
  }
  const ms = (r) => Date.parse(r.created_at || 0) || 0;
  list.sort((a, b) => ms(b) - ms(a));
  const newest = list[0];
  const daysSince = Math.floor((nowMs - ms(newest)) / 86400000);

  /* ③ 보냈다는데 0통 — 가장 나쁘다. 겉으로는 완료로 보이기 때문이다. */
  const zeroSent = list.filter((r) => r.status === 'sent' && Number(r.recipient_count) > 0
    && Number(r.sent_count) === 0);
  if (zeroSent.length) {
    return { healthy: false, cause: 'zero-sent', daysSince,
      reason: "'발송 완료' 인데 실제로 나간 게 0통인 캠페인 " + zeroSent.length + '건 — SMTP 설정을 의심할 것' };
  }

  /* ② draft 정체 — 크론이 만들었는데 status 가 draft 면 영원히 안 나간다. */
  const staleDrafts = list.filter((r) => r.status === 'draft' && (nowMs - ms(r)) > 3 * 86400000);
  if (staleDrafts.length) {
    return { healthy: false, cause: 'stuck-draft', daysSince, drafts: staleDrafts.length,
      reason: 'draft 로 3일 넘게 멈춘 캠페인 ' + staleDrafts.length + '건 — 예약해야 발송된다' };
  }

  /* ① 생성 정체 — 주간이니 10일이면 두 번 놓친 것이다. */
  if (daysSince >= 10) {
    return { healthy: false, cause: 'no-new', daysSince,
      reason: '마지막 캠페인 생성이 ' + daysSince + '일 전 — 주간 크론이 두 번 이상 걸렀다' };
  }

  return { healthy: true, cause: null, daysSince,
    reason: '최근 캠페인 ' + daysSince + '일 전 · draft 정체 없음' };
}

function buildNewsletterAlert(d, site) {
  const map = { 'zero-sent': '보냈다는데 0통', 'stuck-draft': 'draft 로 멈춤', 'no-new': '생성이 멈춤' };
  return {
    title: '🚨 뉴스레터 — ' + (map[d.cause] || d.cause),
    lines: [d.reason, '마지막 캠페인 ' + (d.daysSince == null ? '?' : d.daysSince) + '일 전'],
    url: site + '/admin/crons', urlLabel: '크론 상태',
  };
}

async function checkNewsletter(opts) {
  try {
    const { data, error } = await supabaseAdmin.from('email_campaigns')
      .select('id, name, status, created_at, recipient_count, sent_count')
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw error;

    const d = judgeNewsletter(data, Date.now());
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', NEWSLETTER_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.NEWSLETTER_ALERT_COOLDOWN_H || 24);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildNewsletterAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      await pushAlert({ personalOnly: true, title: '✅ 뉴스레터 정상',
        lines: [d.reason], url: SITE + '/admin/crons', urlLabel: '크론 상태' });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: NEWSLETTER_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, cause: d.cause || null },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    console.error('[pipeline-watch] 뉴스레터 감시 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

/* 유튜브가 인정하는 나라 수는 250 남짓이다. 이 이상 막혔으면 '일부 지역'이
   아니라 사실상 전 세계 차단 — 알림 문구를 다르게 써야 사람이 안 헷갈린다. */
const BLOCK_WORLDWIDE = Number(process.env.YT_BLOCK_WORLDWIDE_MIN || 200);
const BAD_RANK = ['blocked', 'rejected', 'failed', 'private', 'gone'];

function judgeVideoStates(rows, states) {
  const bad = [];
  const seen = [];
  for (const r of (rows || [])) {
    if (!r || !r.video_id) continue;
    const st = states && states.get ? states.get(r.video_id) : null;
    if (!st) {
      bad.push({ video_id: r.video_id, cause: 'gone', why: '유튜브에 없음 (삭제됐거나 접근 불가)' });
      continue;
    }
    if (st.rejectionReason) {
      bad.push({ video_id: r.video_id, cause: 'rejected', why: '거부됨: ' + st.rejectionReason });
      continue;
    }
    if (st.failureReason) {
      bad.push({ video_id: r.video_id, cause: 'failed', why: '처리 실패: ' + st.failureReason });
      continue;
    }
    /* Content ID 차단. 이게 privacyStatus 검사보다 먼저 와야 한다 —
       차단된 영상은 여전히 public/processed 이고 거절 사유도 없다.
       (2026-08-07 eBKJKbk4SjE: public·processed·거절없음인데 249개국 차단) */
    if (st.blockedRegions > 0) {
      const all = st.blockedRegions >= BLOCK_WORLDWIDE;
      bad.push({
        video_id: r.video_id,
        cause: 'blocked',
        why: all
          ? '사실상 전 세계 차단 (' + st.blockedRegions + '개국) — 음원 저작권 주장 가능성'
          : st.blockedRegions + '개국에서 차단됨 — 음원 저작권 주장 가능성',
        blocked_regions: st.blockedRegions,
      });
      continue;
    }
    if (st.privacyStatus && st.privacyStatus !== 'public') {
      bad.push({ video_id: r.video_id, cause: 'private', why: '공개가 아님: ' + st.privacyStatus });
      continue;
    }
    seen.push(r.video_id);
  }
  return {
    healthy: bad.length === 0,
    checked: (rows || []).filter((r) => r && r.video_id).length,
    ok: seen.length,
    /* 알림은 앞의 5건만 보여준다. 그래서 '지금 손쓸 수 있는 것'이 앞에 와야 한다.
       사라진 영상은 이미 끝난 일이고, 차단·거절은 아직 되돌릴 수 있다. */
    bad: bad.slice().sort((a, b) => BAD_RANK.indexOf(a.cause) - BAD_RANK.indexOf(b.cause)),
  };
}

function buildVideoStateAlert(d, site) {
  const map = {
    gone: '영상이 사라짐', rejected: '영상이 거부됨', failed: '처리 실패',
    private: '비공개로 전환됨', blocked: '저작권으로 차단됨',
  };
  const first = d.bad[0] || {};
  return {
    title: '🚨 유튜브 — ' + (map[first.cause] || first.cause),
    lines: d.bad.slice(0, 5).map((b) => b.video_id + ' : ' + b.why).concat([
      `최근 14일 ${d.checked}건 중 ${d.bad.length}건 이상 · 정상 ${d.ok}건`,
      '확인: YouTube Studio → 콘텐츠 (저작권 신고 여부)',
    ]),
    url: `${site}/admin/crons`,
    urlLabel: '크론 상태',
  };
}

async function checkYouTubeVideos(opts) {
  try {
    const DAYS = Number(process.env.YT_VIDEO_WATCH_DAYS || 14);
    const since = new Date(Date.now() - DAYS * 86400000).toISOString();
    const { data: rows } = await supabaseAdmin.from('youtube_posts')
      .select('video_id, status, created_at')
      .eq('status', 'submitted').not('video_id', 'is', null)
      .gte('created_at', since).limit(200);
    const list = rows || [];
    if (!list.length) {
      const none = { healthy: true, checked: 0, ok: 0, bad: [], reason: '최근 ' + DAYS + '일 업로드 없음 — 판단 보류' };
      return (opts && opts.dry) ? { dry: true, ...none } : none;
    }

    const { fetchVideoStates } = require('../_lib/youtube');
    let states;
    try {
      states = await fetchVideoStates(list.map((r) => r.video_id));
    } catch (e) {
      // 스코프가 아직 없으면 감시를 '고장'으로 울리지 않는다 — 재인증 안내만 남긴다.
      return { skipped: true, reason: (e && e.message) || 'videos.list 실패' };
    }

    const d = judgeVideoStates(list, states);
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', YT_VIDEO_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.YT_VIDEO_ALERT_COOLDOWN_H || 12);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildVideoStateAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      await pushAlert({
        personalOnly: true, title: '✅ 유튜브 영상 상태 정상',
        lines: [`최근 업로드 ${d.ok}건 전부 공개 상태`],
        url: `${SITE}/admin/crons`, urlLabel: '크론 상태',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: YT_VIDEO_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, bad: d.bad.slice(0, 5) },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    console.error('[pipeline-watch] youtube video health 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.judgeVideoStates = judgeVideoStates;
module.exports.judgeNewsletter = judgeNewsletter;
module.exports.buildNewsletterAlert = buildNewsletterAlert;
module.exports.buildVideoStateAlert = buildVideoStateAlert;

/* ─── 시작만 하고 안 끝난 실행 (2026-08-10 신설) ──────────────────────
 *
 * 실측 사고: weekly-news 는 2026-07-06 등록 후 **34일간 cron_runs 기록 0건**.
 * 안 돈 게 아니라 매번 죽었다 —
 *     GET /api/cron/weekly-news 504
 *     Vercel Runtime Timeout Error: Task timed out after 120 seconds
 * 기록이 finally 의 INSERT 하나뿐이라 함수가 상한에서 잘리면 그 INSERT 도
 * 실행되지 않는다. trend-scout(월·목)도 같았다.
 *
 * cronGuard 가 시작 시점에 먼저 한 줄(ok=false · duration_ms=null)을 남기도록
 * 바꿨으므로, 죽은 실행은 **끝나지 않은 줄**로 남는다. 여기서 그걸 읽는다.
 *
 * 판정: ran_at 이 GRACE_MIN 보다 오래됐는데 duration_ms 가 여전히 null.
 * GRACE_MIN 은 함수 상한(120초)보다 넉넉히 크게 둔다 — 정상적으로 오래 도는
 * 실행을 죽었다고 부르면 안 된다. 5분이면 상한의 2.5배다.
 */
const DEAD_RUN_ALERT_KEY = 'cron-dead-runs';
const DEAD_RUN_GRACE_MIN = Number(process.env.CRON_DEAD_GRACE_MIN || 5);

/* ─── 개수가 아니라 '비율' 로 판정한다 (2026-08-10 개정) ──────────────
 *
 * 첫 실물 포착에서 바로 드러난 문제다. 실측:
 *     sync-instagram  24시간 311회 실행 · 죽음 1회 · 사망률 0.32%
 *                     → 다음 회차(5분 뒤)가 정상 처리, 유입 끊김 없음
 *     weekly-news     주 1회 실행 · 죽음 1회 · 사망률 100%
 *                     → 34일간 단 한 번도 성공 못 함
 * **개수로는 둘 다 '1건'이라 구분이 안 된다.**
 *
 * 첫 판이 개수 기준이라, 300번에 한 번 늦는 인스타 API 때문에 🚨 가 떴다.
 * 그런 알림이 반복되면 사람은 이 경보를 무시하게 되고, 그러면 weekly-news
 * 같은 진짜 고장을 놓친다 — 오늘 하루 종일 고친 그 함정에 새 감시가
 * 그대로 빠졌다. 그래서 기준을 바꾼다:
 *
 *   울린다  — 창 안에 **성공이 0회** (그 크론은 지금 아예 못 끝내고 있다)
 *           — 또는 같은 크론이 창 안에 **2회 이상** 죽음 (악화 중)
 *   조용히  — 성공이 있고 죽음이 1회 (일시적 지연). 기록·응답에는 남는다.
 *
 * 조용한 쪽도 버리지 않는다. cron_runs 에 줄이 남아 있고 이 함수의 반환에도
 * 실려서 필요할 때 볼 수 있다 — '안 울림' 과 '안 보임' 은 다르다. */

/**
 * 순수 판정 (테스트 대상).
 * @param {Array}  deadRows [{cron_name, ran_at}] — 안 끝난 실행만 걸러진 것
 * @param {Object} okCounts { 크론이름: 같은 창 안의 성공 횟수 }
 */
function judgeDeadRuns(deadRows, okCounts) {
  const ok = okCounts || {};
  const byCron = new Map();
  for (const r of deadRows || []) {
    const k = r && r.cron_name;
    if (!k) continue;
    if (!byCron.has(k)) byCron.set(k, { cron: k, count: 0, lastAt: null, okRuns: 0 });
    const e = byCron.get(k);
    e.count++;
    const t = r.ran_at ? Date.parse(r.ran_at) : null;
    if (t && (!e.lastAt || t > e.lastAt)) e.lastAt = t;
  }
  for (const e of byCron.values()) e.okRuns = Number(ok[e.cron]) || 0;

  const list = Array.from(byCron.values()).sort((a, b) => b.count - a.count);
  /* 울릴 것 — 성공 0회(아예 못 끝냄) 또는 2회 이상 죽음(악화) */
  const alarming = list.filter((x) => x.okRuns === 0 || x.count >= 2);
  /* 조용히 넘길 것 — 성공이 있고 1회만 죽음 */
  const transient = list.filter((x) => x.okRuns > 0 && x.count < 2);
  const total = list.reduce((n, x) => n + x.count, 0);
  const alarmTotal = alarming.reduce((n, x) => n + x.count, 0);

  const rate = (x) => (x.okRuns + x.count) > 0
    ? Math.round((x.count / (x.okRuns + x.count)) * 1000) / 10 : 100;

  return {
    status: alarming.length ? 'dead' : (total ? 'transient' : 'ok'),
    healthy: alarming.length === 0,
    total, alarmTotal,
    crons: list,
    alarming, transient,
    reason: alarming.length
      ? alarmTotal + '건이 시작만 하고 안 끝났다 — '
        + alarming.slice(0, 4).map((x) => x.cron + ' ' + x.count + '회'
            + (x.okRuns === 0 ? '(창 안 성공 0)' : '(사망률 ' + rate(x) + '%)')).join(' · ')
      : (total
        ? '일시적 지연 ' + total + '건 — '
          + transient.slice(0, 3).map((x) => x.cron + ' 사망률 ' + rate(x) + '%').join(' · ')
          + ' (다른 회차는 정상이라 알리지 않는다)'
        : '끝나지 않은 실행 없음.'),
  };
}

function buildDeadRunAlert(d, site) {
  return {
    title: '🚨 크론이 도중에 죽는다 — 끝나지 않은 실행 ' + d.total + '건',
    lines: [
      d.reason,
      '',
      '이 크론들은 창(24시간) 안에 성공이 0회이거나 2회 이상 죽었다.',
      '(성공이 있고 1회만 죽은 일시적 지연은 알리지 않는다 — 기록에는 남는다)',
      '',
      '무슨 뜻인가: 크론이 시작 기록은 남겼는데 종료 기록을 못 남겼다.',
      '거의 언제나 Vercel 함수 상한(120초) 초과다. 그 경우 함수가 통째로',
      '잘려나가므로 핸들러의 어떤 코드도 마무리를 못 한다.',
      '',
      '볼 곳: Vercel → Logs → 해당 경로, statusCode 504',
      '고칠 방향: 그 크론에 시간 예산(BUDGET_MS)과 개별 fetch 타임아웃을 주고,',
      '못 끝낸 몫은 다음 실행이 이어받게 한다 (backfill-translations 가 그 형태).',
    ],
    url: (site || '') + '/admin/crons',
    urlLabel: '크론 상태',
  };
}

async function checkDeadRuns(opts) {
  try {
    const cutoff = new Date(Date.now() - DEAD_RUN_GRACE_MIN * 60000).toISOString();
    /* 창을 24시간으로 둔다 — 더 넓히면 옛 사고가 계속 울린다. */
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from('cron_runs')
      .select('cron_name, ran_at')
      .is('duration_ms', null)
      .lt('ran_at', cutoff)
      .gte('ran_at', since)
      .limit(500);
    if (error) throw error;

    /* 죽은 크론들의 **같은 창 안 성공 횟수**를 센다. 죽음이 있는 크론만
       조회하므로 보통 0~2회의 가벼운 count 쿼리다. */
    const okCounts = {};
    for (const name of Array.from(new Set((rows || []).map((r) => r && r.cron_name).filter(Boolean)))) {
      const { count } = await supabaseAdmin.from('cron_runs')
        .select('*', { count: 'exact', head: true })
        .eq('cron_name', name).eq('ok', true).gte('ran_at', since);
      okCounts[name] = typeof count === 'number' ? count : 0;
    }

    const d = judgeDeadRuns(rows || [], okCounts);
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', DEAD_RUN_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.CRON_DEAD_COOLDOWN_H || 6);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildDeadRunAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      await pushAlert({
        personalOnly: true,
        title: '✅ 크론 정상화 — 끝나지 않은 실행 0건',
        lines: [d.reason],
        url: `${SITE}/admin/crons`, urlLabel: '크론 상태',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: DEAD_RUN_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, total: d.total, alarmTotal: d.alarmTotal,
          crons: d.alarming.slice(0, 6).map(x => x.cron + ':' + x.count + '/ok' + x.okRuns) },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { ...d, alerted };
  } catch (e) {
    console.error('[pipeline-watch] dead-run 감시 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.judgeDeadRuns = judgeDeadRuns;
module.exports.buildDeadRunAlert = buildDeadRunAlert;

/* ═══════════════════════════════════════════════════════════════
 * 크론 연속 실패 감시 (2026-08-17 추가)
 *
 * 왜 필요한가:
 *   drive-youtube-post 가 08-09 부터 08-17 까지 **48회 연속** ok=false 로
 *   끝났다. 매번 같은 note 를 남겼다:
 *     "DB 기록 실패 — 같은 영상이 반복 업로드될 수 있음! video_id=… "
 *   그 사이 같은 쇼츠가 공개 채널에 48번 올라갔다.
 *   8일 동안 어떤 감시에도 안 걸렸고, 도메니코가 눈으로 보고 알려줬다.
 *
 *   기존 감시가 전부 못 본 이유는 이렇다:
 *     · checkDeadRuns   duration_ms IS NULL(안 끝난 것)만 본다.
 *                       이 크론은 **끝났다**. 500 을 반환하며 정상 종료했다.
 *     · checkDuration   시간만 본다. 이 크론은 빨랐다.
 *     · 나머지 감시     전부 특정 파이프라인 전용이다. 이 크론은 대상이 아니었다.
 *   즉 우리 감시망에는 "그냥 실패했다" 를 보는 눈이 하나도 없었다.
 *   가장 흔하고 가장 시끄러운 신호인데 아무도 안 듣고 있었다.
 *
 * 무엇을 울리나 — 연속 실패다, 실패율이 아니다:
 *   가끔 실패하고 다음 회차에 회복되는 크론은 흔하고, 그걸로 울리면 소음이다.
 *   연속으로 실패한다는 건 스스로 못 빠져나온다는 뜻이고, 그게 사람이 필요한
 *   순간이다. 48회 연속은 3회째에 알렸어야 했다.
 * ══════════════════════════════════════════════════════════════ */
const FAILING_CRON_ALERT_KEY = 'cron-failing-streak';
/* 몇 번 연속 실패하면 울릴지. 1~2 는 일시적 오류가 많아 소음이 된다. */
const FAIL_STREAK_MIN = Number(process.env.CRON_FAIL_STREAK_MIN || 3);

/**
 * 순수 판정 (테스트 대상).
 * @param {Array} rows [{cron_name, ok, ran_at, note}] — 창 안의 실행 전부.
 *                     **최신이 먼저** 오는 순서를 기대한다.
 * @param {number} streakMin 연속 실패 몇 회부터 울릴지
 */
function judgeFailingCrons(rows, streakMin) {
  const need = Number(streakMin) || FAIL_STREAK_MIN;
  const byCron = new Map();

  for (const r of rows || []) {
    const k = r && r.cron_name;
    if (!k) continue;
    if (!byCron.has(k)) {
      byCron.set(k, { cron: k, runs: 0, fails: 0, streak: 0, streakOpen: true, lastFailAt: null, lastNote: '' });
    }
    const e = byCron.get(k);
    e.runs++;
    const failed = r.ok === false;
    if (failed) {
      e.fails++;
      /* 최신부터 훑으므로, 성공을 만나기 전까지의 실패만 '지금도 진행 중인
       * 연속 실패' 다. 성공이 하나라도 끼면 그 크론은 회복된 적이 있다. */
      if (e.streakOpen) {
        e.streak++;
        const t = r.ran_at ? Date.parse(r.ran_at) : null;
        if (t && (!e.lastFailAt || t > e.lastFailAt)) e.lastFailAt = t;
        if (!e.lastNote) e.lastNote = String(r.note || '').slice(0, 160);
      }
    } else {
      e.streakOpen = false;
    }
  }

  const list = Array.from(byCron.values())
    .map((e) => { delete e.streakOpen; return e; })
    .sort((a, b) => b.streak - a.streak);
  const alarming = list.filter((x) => x.streak >= need);

  return {
    healthy: alarming.length === 0,
    checked: list.length,
    crons: list,
    alarming,
    reason: alarming.length
      ? alarming.slice(0, 4).map((x) => x.cron + ' ' + x.streak + '회 연속 실패'
          + (x.lastNote ? ' — ' + x.lastNote : '')).join(' · ')
      : '연속 ' + need + '회 이상 실패한 크론 없음.',
  };
}

function buildFailingCronAlert(d, site) {
  const first = d.alarming[0] || {};
  return {
    title: '🚨 크론이 계속 실패한다 — ' + (first.cron || '') + ' ' + (first.streak || 0) + '회 연속',
    lines: d.alarming.slice(0, 5).map((x) =>
      x.cron + ': 최근 ' + x.runs + '회 중 ' + x.fails + '회 실패, 지금 ' + x.streak + '회 연속'
      + (x.lastNote ? '\n  ↳ ' + x.lastNote : '')
    ).concat([
      '',
      '연속 실패는 스스로 못 빠져나온다는 뜻이다. 회차를 더 기다려도 안 낫는다.',
      '2026-08-09~17: drive-youtube-post 가 이 모양으로 48회 연속 실패하는 동안',
      '같은 쇼츠가 공개 채널에 48번 올라갔다. 그때 이 감시가 없었다.',
      '',
      '볼 곳: /admin/crons 의 해당 크론 · Vercel Logs',
    ]),
    url: (site || '') + '/admin/crons',
    urlLabel: '크론 상태',
  };
}

async function checkFailingCrons(opts) {
  try {
    const WINDOW_H = Number(process.env.CRON_FAIL_WINDOW_H || 24);
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from('cron_runs')
      .select('cron_name, ok, ran_at, note')
      .not('duration_ms', 'is', null)   // 안 끝난 실행은 checkDeadRuns 담당이다
      .gte('ran_at', since)
      .order('ran_at', { ascending: false })
      .limit(1000);
    if (error) throw error;

    const d = judgeFailingCrons(rows || [], FAIL_STREAK_MIN);
    if (opts && opts.dry) return { dry: true, ...d };

    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at, last_payload').eq('key', FAILING_CRON_ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    const wasBroken = !!(st && st.last_payload && st.last_payload.broken);
    const COOLDOWN_H = Number(process.env.CRON_FAIL_COOLDOWN_H || 6);

    let alerted = false;
    if (!d.healthy && Date.now() - lastAt > COOLDOWN_H * 3600000) {
      await pushAlert({ ...buildFailingCronAlert(d, SITE), personalOnly: true });
      alerted = true;
    } else if (d.healthy && wasBroken) {
      await pushAlert({
        personalOnly: true,
        title: '✅ 크론 연속 실패 해소',
        lines: [d.reason],
        url: `${SITE}/admin/crons`, urlLabel: '크론 상태',
      });
      alerted = true;
    }
    if (alerted || wasBroken !== !d.healthy) {
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: FAILING_CRON_ALERT_KEY,
        last_alert_at: alerted ? new Date().toISOString() : (st && st.last_alert_at) || null,
        last_payload: { broken: !d.healthy, crons: d.alarming.slice(0, 6).map((x) => x.cron + ':' + x.streak) },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    }
    return { healthy: d.healthy, checked: d.checked, alarming: d.alarming, reason: d.reason, alerted };
  } catch (e) {
    console.error('[pipeline-watch] 연속 실패 감시 실패', e && e.message);
    return { error: (e && e.message) || 'unknown' };
  }
}

module.exports.judgeFailingCrons = judgeFailingCrons;
module.exports.buildFailingCronAlert = buildFailingCronAlert;
