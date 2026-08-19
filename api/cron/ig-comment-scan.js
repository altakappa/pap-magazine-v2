/**
 * GET /api/cron/ig-comment-scan — IG 스팸 댓글 수집 → 승인 큐
 *
 * 배경 (2026-08-19):
 *   커버낫 릴스 하나에 20분 만에 성인사이트 유인 스팸이 수십 건 붙었다.
 *   댓글 37건 중 35건이 스팸이었고, 도메니코가 손으로 지웠다.
 *   같은 일이 조회수 터진 글마다 반복된다 — 스패머는 노출 좋은 글을 고른다.
 *
 * 이 크론이 하는 일: 후보를 모아 큐에 쌓고, 사람에게 알린다.
 * 하지 않는 일: 스스로 숨기거나 지우는 것. 승인은 사람 몫이다.
 *
 *   왜 자동 숨김을 안 넣나 — 오늘 하루에 오탐을 두 번 냈다.
 *   ① 이모지 댓글 20건이 빈 지문으로 묶여 '살포'로 오인 (b677f8f)
 *   ② '@pap_magazine 🤍' 4건이 같은 지문으로 묶여 오인 (6c37aa7)
 *   둘 다 실제 데이터로 재보고 나서야 알았다. 판정기를 만든 사람이
 *   판정기를 전적으로 믿으면 안 된다.
 *
 * 인증: CRON_SECRET 또는 관리자.
 */

const { withCronGuard } = require('../_lib/cronGuard');
const { requireAdmin } = require('../_lib/auth');
const { supabaseAdmin } = require('../_lib/supabase');
const { pushAlert } = require('../_lib/pushAlert');
const ig = require('../_lib/igComments');
const spam = require('../_lib/igCommentSpam');

const SITE = process.env.SITE_URL || 'https://www.pap-magazine.com';
const THRESHOLD = Number(process.env.IG_SPAM_THRESHOLD || 60);
const MEDIA_LIMIT = Number(process.env.IG_SPAM_MEDIA_LIMIT || 12);
const ALERT_KEY = 'ig-comment-spam';
const COOLDOWN_H = Number(process.env.IG_SPAM_ALERT_COOLDOWN_H || 6);

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

module.exports = withCronGuard('ig-comment-scan', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = req.query && req.query.dry === '1';

  // ── 1. 최근 게시물 ──────────────────────────────────────
  let media;
  try {
    media = await ig.listRecentMedia(MEDIA_LIMIT);
  } catch (e) {
    const msg = String((e && e.message) || e);
    note(res, 'IG 미디어 조회 실패: ' + msg.slice(0, 200));
    return res.status(502).json({ ok: false, error: 'media list failed', detail: msg.slice(0, 400) });
  }
  const targets = media.filter((m) => (m.comments_count || 0) > 0);

  // ── 2. 댓글 수집 + 판정 ─────────────────────────────────
  const rows = [];
  const fpCount = new Map();
  let scanned = 0;
  let readFail = null;

  for (const m of targets) {
    let comments;
    try {
      comments = await ig.listComments(m.id);
    } catch (e) {
      // 권한 문제면 더 돌아봐야 소용없다. 즉시 멈추고 사유를 남긴다.
      readFail = { permission: !!e.permission, message: String((e && e.message) || e) };
      break;
    }
    for (const c of comments) {
      scanned++;
      if (c.hidden) continue;                       // 이미 숨겨진 것은 후보가 아니다
      const sc = spam.score(c.text || '');
      const fp = spam.fingerprint(c.text || '');
      if (fp) fpCount.set(fp, (fpCount.get(fp) || 0) + 1);
      rows.push({
        comment_id: c.id, media_id: m.id, permalink: m.permalink || null,
        text: String(c.text || '').slice(0, 900),
        username: c.username || null,
        score: sc.total, signals: sc.signals, fingerprint: fp,
        is_reply: !!c.isReply, posted_at: c.timestamp || null,
      });
    }
  }

  if (readFail) {
    const why = readFail.permission
      ? 'instagram_manage_comments 권한 없음 — 토큰 재인증 필요'
      : readFail.message.slice(0, 180);
    note(res, '댓글 조회 실패: ' + why);
    return res.status(502).json({ ok: false, error: 'comment read failed', detail: why });
  }

  /* 살포 가산 — 자기 신호가 0점인 댓글에는 주지 않는다.
   * '남들도 똑같이 썼다'는 사실만으로는 스팸이 아니다 (6c37aa7 교훈). */
  for (const r of rows) {
    if (!r.fingerprint || r.score <= 0) continue;
    const n = fpCount.get(r.fingerprint) || 0;
    if (n >= 3) { r.score += 60; r.signals = [...r.signals, 'burst:' + n + '건']; }
  }

  const candidates = rows.filter((r) => r.score >= THRESHOLD);

  if (dry) {
    return res.status(200).json({
      ok: true, dry: true,
      note: note(res, 'dry: 게시물 ' + targets.length + '개 · 댓글 ' + scanned + '건 · 후보 ' + candidates.length + '건'),
      기준점: THRESHOLD,
      후보: candidates.slice(0, 20).map((c) => ({ id: c.comment_id, 점수: c.score, 신호: c.signals, 글: c.text.slice(0, 60) })),
    });
  }

  // ── 3. 큐에 쌓는다 ──────────────────────────────────────
  // 이미 사람이 판단한 건(hidden/dismissed)은 건드리지 않는다.
  // '스팸 아님'으로 넘긴 댓글이 다음 회차에 다시 올라오면 그 판단이 무의미해진다.
  let newCount = 0;
  const errors = [];
  if (candidates.length) {
    const ids = candidates.map((c) => c.comment_id);
    const { data: known } = await supabaseAdmin.from('ig_comment_queue')
      .select('comment_id').in('comment_id', ids);
    const seen = new Set((known || []).map((k) => k.comment_id));
    const fresh = candidates.filter((c) => !seen.has(c.comment_id));
    newCount = fresh.length;
    if (fresh.length) {
      const { error } = await supabaseAdmin.from('ig_comment_queue').insert(fresh);
      if (error) errors.push('큐 저장 실패: ' + String(error.message).slice(0, 150));
    }
  }

  // ── 4. 알림 (쿨다운) ────────────────────────────────────
  const { count: pendingCount } = await supabaseAdmin.from('ig_comment_queue')
    .select('comment_id', { count: 'exact', head: true }).eq('status', 'pending');

  let alerted = false;
  if (newCount > 0) {
    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at').eq('key', ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    if (Date.now() - lastAt > COOLDOWN_H * 3600000) {
      const top = candidates.slice().sort((a, b) => b.score - a.score).slice(0, 3);
      await pushAlert({
        personalOnly: true,
        title: `🧹 IG 스팸 댓글 ${newCount}건 발견 (대기 ${pendingCount || 0}건)`,
        lines: [
          `최근 게시물 ${targets.length}개 · 댓글 ${scanned}건 중 ${candidates.length}건이 스팸 판정`,
          '',
          ...top.map((t) => `· ${t.score}점 ${String(t.text).slice(0, 40)}`),
          '',
          '숨기려면 아래에서 확인하고 승인하세요. 삭제가 아니라 숨김이라 되돌릴 수 있습니다.',
        ],
        url: `${SITE}/api/ops/ig-comment-queue`,
        urlLabel: '승인 대기 목록',
      }).catch((e) => errors.push('알림 실패: ' + String(e && e.message).slice(0, 100)));
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: ALERT_KEY, last_alert_at: new Date().toISOString(),
        last_payload: { new: newCount, pending: pendingCount || 0 },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      alerted = true;
    }
  }

  return res.status(200).json({
    ok: true,
    note: note(res, `게시물 ${targets.length}개 · 댓글 ${scanned}건 · 스팸 ${candidates.length}건`
      + ` · 신규 ${newCount}건 · 대기 ${pendingCount || 0}건`
      + (alerted ? ' · 알림발송' : '')
      + (errors.length ? ' · ⚠️ ' + errors.join(' / ') : '')),
    게시물: targets.length, 댓글: scanned, 스팸: candidates.length,
    신규: newCount, 대기: pendingCount || 0, 알림: alerted, 오류: errors,
  });
});
