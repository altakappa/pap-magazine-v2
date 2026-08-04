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

  return res.status(200).json({ ok: true, ...d, alerted: !!pushed, push: pushed, backfill, translate, reels, faq });
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

module.exports.diagnose = diagnose;
module.exports.buildAlert = buildAlert;
module.exports.judgeReelHealth = judgeReelHealth;
module.exports.buildReelAlert = buildReelAlert;
module.exports.judgeFaqHealth = judgeFaqHealth;
module.exports.buildFaqAlert = buildFaqAlert;
