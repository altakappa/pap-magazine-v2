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

const { bearerOk } = require('../_lib/secretCompare');
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
const AUTO_HIDE = process.env.IG_SPAM_AUTO_HIDE !== '0';   // 기본 켜짐, env 로 끌 수 있다
const AUTO_MIN = Number(process.env.IG_SPAM_AUTO_MIN_SCORE || spam.AUTO_MIN_SCORE);
const AUTO_MAX_PER_RUN = Number(process.env.IG_SPAM_AUTO_MAX || 120);
const AUTO_CONCURRENCY = Number(process.env.IG_SPAM_AUTO_CONCURRENCY || 4);
/* 시간 예산 — 함수가 죽기 전에 스스로 멈춘다.
 * 2026-08-20: 첫 실전 자동 숨김에서 38건 처리하고 120초 제한에 걸려 죽었다.
 * 죽으면 알림도 안 간다. 조용히 죽는 자동화가 제일 나쁘다. */
const BUDGET_MS = Number(process.env.IG_SPAM_BUDGET_MS || 200000);
const COOLDOWN_H = Number(process.env.IG_SPAM_ALERT_COOLDOWN_H || 6);

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

module.exports = withCronGuard('ig-comment-scan', async function handler(req, res) {
  const startedAt = Date.now();
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
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
    if (n >= spam.BURST_MIN_COUNT) { r.score += spam.BURST_BONUS; r.signals = [...r.signals, 'burst:' + n + '건']; }
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

  /* ── 4. 자동 숨김 ────────────────────────────────────────
   * 확실한 것만 사람 손 없이 처리한다. 근거는 autoHidable() 주석에 있다.
   * 여기서 처리하지 못한 것(애매한 것)만 사람에게 남는다.
   *
   * 조용히 하지 않는다 — 무엇을 왜 숨겼는지 전부 기록하고 알림에 싣는다.
   * 자동으로 뭔가를 지우는 시스템이 조용하면 그건 사고가 난 뒤에야 보인다.
   *
   * 2026-08-20 실전 1회차에서 배운 것:
   *   1건에 API 3번(재조회·숨김·확인) → 2.5초. 38건에서 120초 제한에 걸려 죽었다.
   *   죽으면 알림 단계까지 못 간다. 그래서 ① 4건씩 동시에 처리하고
   *   ② 예산을 넘기면 스스로 멈추고 ③ 남은 건수를 알림에 싣는다.
   */
  const autoHidden = [];
  const autoFailed = [];
  let autoLeft = 0;                    // 시간이 모자라 이번에 못 한 건수
  if (AUTO_HIDE) {
    /* 대기 중인 것 전부 + 지난 회차에 '실패'로 남은 것도 다시 본다.
     * 인스타 쪽 반영 지연 같은 일시적 실패는 다음 회차에 저절로 풀린다. */
    const { data: pend } = await supabaseAdmin.from('ig_comment_queue')
      .select('comment_id, score, signals, text, status')
      .in('status', ['pending', 'failed'])
      .order('score', { ascending: false })
      .limit(300);

    const autoTargets = (pend || [])
      .filter((r) => spam.autoHidable(r.score, r.signals, { minScore: AUTO_MIN }).auto)
      .slice(0, AUTO_MAX_PER_RUN);

    const hideOne = async (t) => {
      try {
        // 숨기기 직전 재판정 — 큐에 담긴 뒤 판정기가 바뀌었을 수 있다
        const cur = await ig.getComment(t.comment_id);
        const sc = spam.score(cur.text || '');
        /* 큐에 담을 때 점수에는 살포 가산이 들어 있는데 여기서 다시 매긴 점수에는 없다.
         * 같은 잣대로 봐야 한다 — 글이 그대로면 그때 잰 살포 증거도 그대로다.
         * 글이 바뀌었으면 이어받지 않는다. 그건 다른 글이다. */
        const burst = (t.signals || []).map(String).find((x) => x.startsWith('burst:'));
        let total = sc.total;
        let signals = sc.signals;
        if (burst && sc.total > 0 && spam.squash(cur.text || '') === spam.squash(t.text || '')) {
          total += spam.BURST_BONUS;
          signals = [...signals, burst];
        }
        const again = spam.autoHidable(total, signals, { minScore: AUTO_MIN });
        if (!again.auto) {
          await supabaseAdmin.from('ig_comment_queue').update({
            status: 'pending', detail: '자동 보류 — 재판정 ' + again.why,
          }).eq('comment_id', t.comment_id);
          return 'SKIP';
        }
        const r = await ig.setHidden(t.comment_id, true);
        let verified = r.verified;
        if (verified === false) {
          // 인스타 반영이 한 박자 늦을 수 있다. 한 번만 더 확인하고 판단한다.
          await new Promise((ok) => setTimeout(ok, 1500));
          const re = await ig.getComment(t.comment_id).catch(() => null);
          verified = re ? re.hidden === true : null;
        }
        if (verified === false) {
          autoFailed.push({ id: t.comment_id, why: '응답 성공 · 상태 미변경(2회 확인)' });
          await supabaseAdmin.from('ig_comment_queue').update({
            status: 'failed', detail: '자동 숨김 응답은 성공인데 상태가 안 바뀜(2회 확인)',
            decided_at: new Date().toISOString(),
          }).eq('comment_id', t.comment_id);
          return 'FAIL';
        }
        autoHidden.push({ id: t.comment_id, score: total, text: String(cur.text || '').slice(0, 40) });
        await supabaseAdmin.from('ig_comment_queue').update({
          status: 'auto_hidden', detail: '자동 숨김 · ' + again.why,
          decided_at: new Date().toISOString(),
        }).eq('comment_id', t.comment_id);
        return 'OK';
      } catch (e) {
        const why = String((e && e.message) || e).slice(0, 150);
        autoFailed.push({ id: t.comment_id, why });
        await supabaseAdmin.from('ig_comment_queue').update({
          status: e && e.gone ? 'gone' : 'failed', detail: why,
          decided_at: new Date().toISOString(),
        }).eq('comment_id', t.comment_id);
        return e && e.permission ? 'STOP' : 'FAIL';   // 권한 문제면 나머지도 똑같이 실패한다
      }
    };

    for (let i = 0; i < autoTargets.length; i += AUTO_CONCURRENCY) {
      if (Date.now() - startedAt > BUDGET_MS) { autoLeft = autoTargets.length - i; break; }
      const batch = autoTargets.slice(i, i + AUTO_CONCURRENCY);
      const outs = await Promise.all(batch.map(hideOne));
      if (outs.some((o) => o === 'STOP')) { autoLeft = autoTargets.length - i - batch.length; break; }
    }
  }

  // ── 5. 알림 (쿨다운) ────────────────────────────────────
  const { count: pendingCount } = await supabaseAdmin.from('ig_comment_queue')
    .select('comment_id', { count: 'exact', head: true }).eq('status', 'pending');

  let alerted = false;
  const worthTelling = newCount > 0 || autoHidden.length > 0 || autoFailed.length > 0 || autoLeft > 0;
  if (worthTelling) {
    const { data: st } = await supabaseAdmin.from('ops_alert_state')
      .select('last_alert_at').eq('key', ALERT_KEY).maybeSingle();
    const lastAt = st && st.last_alert_at ? Date.parse(st.last_alert_at) : 0;
    // 실패는 쿨다운을 무시한다. 자동 처리가 막힌 것은 즉시 알아야 한다.
    const cooled = Date.now() - lastAt > COOLDOWN_H * 3600000;
    if (cooled || autoFailed.length || autoLeft) {
      const lines = [];
      if (autoHidden.length) {
        lines.push(`✅ ${autoHidden.length}건은 자동으로 숨겼습니다 (${AUTO_MIN}점 이상 · 확실한 것만).`);
        for (const a of autoHidden.slice(0, 3)) lines.push(`   · ${a.score}점 ${a.text}`);
        lines.push('');
      }
      if (pendingCount) {
        lines.push(`🙋 ${pendingCount}건은 애매해서 확인이 필요합니다. 아래에서 보고 판단해 주세요.`);
        lines.push('');
      }
      if (autoLeft) {
        lines.push(`⏳ 시간이 모자라 ${autoLeft}건은 다음 회차(매시 :25)에 이어서 처리합니다.`);
        lines.push('');
      }
      if (autoFailed.length) {
        lines.push(`⛔ 자동 숨김 실패 ${autoFailed.length}건: ${autoFailed[0].why}`);
        lines.push('');
      }
      lines.push(`최근 게시물 ${targets.length}개 · 댓글 ${scanned}건 검사`);
      lines.push('숨김은 삭제가 아닙니다. 목록에서 되돌릴 수 있습니다.');

      const title = autoFailed.length
        ? `⛔ IG 스팸 자동 처리 실패 ${autoFailed.length}건`
        : (autoHidden.length
          ? `🧹 IG 스팸 ${autoHidden.length}건 자동 정리${pendingCount ? ` · 확인 ${pendingCount}건` : ''}`
          : `🙋 IG 스팸 확인 요청 ${pendingCount}건`);

      await pushAlert({ personalOnly: true, title, lines,
        url: `${SITE}/api/ops/ig-comment-queue`, urlLabel: '확인·되돌리기' })
        .catch((e) => errors.push('알림 실패: ' + String(e && e.message).slice(0, 100)));
      await supabaseAdmin.from('ops_alert_state').upsert({
        key: ALERT_KEY, last_alert_at: new Date().toISOString(),
        last_payload: { new: newCount, auto: autoHidden.length, pending: pendingCount || 0 },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      alerted = true;
    }
  }

  return res.status(200).json({
    ok: true,
    note: note(res, `게시물 ${targets.length}개 · 댓글 ${scanned}건 · 스팸 ${candidates.length}건`
      + ` · 신규 ${newCount}건 · 자동숨김 ${autoHidden.length}건 · 대기 ${pendingCount || 0}건`
      + (autoLeft ? ` · ⏳남음 ${autoLeft}건` : '')
      + (autoFailed.length ? ` · ⛔자동실패 ${autoFailed.length}건(${autoFailed[0].why})` : '')
      + ` · ${Math.round((Date.now() - startedAt) / 1000)}초`
      + (alerted ? ' · 알림발송' : '')
      + (errors.length ? ' · ⚠️ ' + errors.join(' / ') : '')),
    게시물: targets.length, 댓글: scanned, 스팸: candidates.length,
    신규: newCount, 자동숨김: autoHidden.length, 자동실패: autoFailed, 자동남음: autoLeft,
    소요초: Math.round((Date.now() - startedAt) / 1000),
    대기: pendingCount || 0, 알림: alerted, 오류: errors,
  });
});
