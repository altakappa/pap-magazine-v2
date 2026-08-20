/**
 * GET  /api/ops/ig-comment-queue          — 승인 대기 목록 (사람이 보는 화면)
 * POST /api/ops/ig-comment-queue          — 승인/기각 처리
 *        ?action=hide&ids=a,b,c           승인 → 숨김 (판정 재확인 후)
 *        ?action=dismiss&ids=a,b,c        스팸 아님 → 큐에서 내림
 *        ?action=unhide&ids=a             되돌리기
 *
 * 왜 화면을 만드나 (2026-08-18 교훈):
 *   본문 보강 도구를 만들고 하루 반 동안 아무도 안 썼다. 판단은 사람이
 *   하게 설계해 놓고 **판단할 화면을 안 만들었기** 때문이다. JSON 을
 *   서른 번 열어보라는 건 안 하겠다는 말과 같다. 같은 실수를 반복하지 않는다.
 *
 * 안전장치:
 *   - 일괄 승인 버튼 없음. 체크한 것만 처리한다.
 *   - 숨기기 직전에 **원문을 다시 읽어 다시 점수를 매긴다.** 큐에 담길 때와
 *     판정기가 달라졌을 수 있고(오늘만 두 번 고쳤다), 그 사이 사람이
 *     댓글을 지웠을 수도 있다. 기준점 미만이면 숨기지 않고 큐에서 내린다.
 *   - 삭제 경로 없음.
 */

const { requireAdmin } = require('../_lib/auth');
const { supabaseAdmin } = require('../_lib/supabase');
const ig = require('../_lib/igComments');
const spam = require('../_lib/igCommentSpam');

const THRESHOLD = Number(process.env.IG_SPAM_THRESHOLD || 60);
const MAX_BATCH = 50;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(rows, msg, opt) {
  const auto = !!(opt && opt.auto);
  const autoCount = (opt && opt.autoCount) || 0;
  const items = rows.map((r) => `
    <li>
      <label>
        ${auto ? '' : `<input type="checkbox" name="id" value="${esc(r.comment_id)}">`}
        <b>${r.score}점</b>
        <span class="sig">${esc((r.signals || []).join(' · '))}</span>
      </label>
      <div class="txt">${esc(r.text)}</div>
      <div class="meta">
        ${r.username ? '@' + esc(r.username) + ' · ' : ''}
        ${r.is_reply ? '답글 · ' : ''}
        ${r.permalink ? `<a href="${esc(r.permalink)}" target="_blank" rel="noopener">게시물 보기</a>` : ''}
      </div>
    </li>`).join('');

  return `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IG 스팸 댓글 승인 (${rows.length}건)</title>
<style>
 body{font:15px/1.6 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;
      max-width:720px;margin:0 auto;padding:20px;color:#111}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#666;font-size:13px;margin-bottom:16px}
 ul{list-style:none;padding:0} li{border:1px solid #e5e5e5;border-radius:10px;padding:12px;margin:0 0 10px}
 .txt{margin:8px 0;word-break:break-all;background:#fafafa;padding:8px;border-radius:6px;font-size:14px}
 .sig{color:#c00;font-size:12px;margin-left:6px} .meta{color:#888;font-size:12px}
 .bar{position:sticky;bottom:0;background:#fff;border-top:1px solid #eee;padding:12px 0;display:flex;gap:8px}
 button{padding:10px 16px;border-radius:8px;border:0;font-size:15px;cursor:pointer}
 .hide{background:#111;color:#fff} .dismiss{background:#eee;color:#333}
 .msg{background:#f0f7ff;border:1px solid #cde;padding:10px;border-radius:8px;margin-bottom:14px;font-size:14px}
 .empty{color:#666;padding:40px 0;text-align:center}
 .warn{color:#666;font-size:12px;margin-top:10px}
 .tabs{display:flex;gap:14px;margin:0 0 14px;border-bottom:1px solid #eee}
 .tabs a{padding:8px 2px;text-decoration:none;color:#888;font-size:14px;border-bottom:2px solid transparent}
 .tabs a.on{color:#111;font-weight:600;border-bottom-color:#111}
</style>
<h1>IG 스팸 댓글 ${auto ? '자동 숨김 이력' : '승인'}</h1>
<div class="sub">${auto
  ? '봇이 스스로 숨긴 것들입니다. 잘못 숨긴 게 있으면 되돌리세요.'
  : '체크한 것만 처리됩니다. <b>삭제가 아니라 숨김</b>이라 되돌릴 수 있습니다.'}</div>
<div class="tabs">
  <a href="?" class="${auto ? '' : 'on'}">확인 필요</a>
  <a href="?view=auto" class="${auto ? 'on' : ''}">자동 숨김 ${autoCount}건</a>
</div>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
${rows.length ? (auto ? `<ul>${items}</ul>
  <form method="post" class="bar">
    <input type="hidden" name="id" value="${esc(rows.map((r) => r.comment_id).join(','))}">
    <div class="warn">잘못 숨긴 것이 있으면 해당 게시물 링크로 확인 후 알려주세요. 개별 되돌리기는 목록에서 처리합니다.</div>
  </form>` : `<form method="post">
  <ul>${items}</ul>
  <div class="bar">
    <button class="hide" formaction="?action=hide">선택 숨기기</button>
    <button class="dismiss" formaction="?action=dismiss">스팸 아님</button>
  </div>
  <div class="warn">숨기기 직전에 원문을 다시 읽어 다시 판정합니다. 기준점(${THRESHOLD}점) 미만이면 숨기지 않습니다.</div>
</form>`) : `<div class="empty">${auto ? '자동으로 숨긴 항목이 없습니다' : '확인할 항목이 없습니다 👍'}</div>`}
</html>`;
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const q = req.query || {};
  const wantsJson = q.format === 'json';

  // ── 목록 ────────────────────────────────────────────────
  if (req.method !== 'POST') {
    // ?view=auto 는 자동으로 숨긴 것을 보여준다. 자동 처리한 것을 사람이
    // 사후에 볼 수 없으면 그건 감시가 아니라 방치다.
    const auto = q.view === 'auto';
    const { data, error } = await supabaseAdmin.from('ig_comment_queue')
      .select('*').eq('status', auto ? 'auto_hidden' : 'pending')
      .order(auto ? 'decided_at' : 'score', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ ok: false, error: String(error.message).slice(0, 200) });
    const rows = data || [];
    const { count: autoCount } = await supabaseAdmin.from('ig_comment_queue')
      .select('comment_id', { count: 'exact', head: true }).eq('status', 'auto_hidden');
    if (wantsJson) return res.status(200).json({ ok: true, 보기: auto ? '자동숨김' : '대기', 건수: rows.length, 항목: rows });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(page(rows, q.msg || '', { auto, autoCount: autoCount || 0 }));
  }

  // ── 처리 ────────────────────────────────────────────────
  const action = String(q.action || '');
  if (!['hide', 'dismiss', 'unhide'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'action 은 hide|dismiss|unhide 중 하나' });
  }

  let ids = [];
  const body = req.body;
  if (body && body.id) ids = Array.isArray(body.id) ? body.id : [body.id];
  else if (q.ids) ids = String(q.ids).split(',');
  ids = ids.map((s) => String(s).trim()).filter((s) => /^[0-9]{5,}$/.test(s)).slice(0, MAX_BATCH);

  if (!ids.length) {
    return res.status(400).json({ ok: false, error: '선택된 항목이 없습니다' });
  }

  // 스팸 아님 → 큐에서 내리고 끝. IG 는 건드리지 않는다.
  if (action === 'dismiss') {
    await supabaseAdmin.from('ig_comment_queue')
      .update({ status: 'dismissed', decided_at: new Date().toISOString() })
      .in('comment_id', ids);
    return finish(res, wantsJson, `${ids.length}건을 '스팸 아님'으로 넘겼습니다. 다음 수집에서 다시 올라오지 않습니다.`);
  }

  const hide = action === 'hide';
  const done = []; const skipped = []; const failed = [];

  for (const id of ids) {
    // 1) 원문 재조회 — 그 사이 지워졌을 수 있다
    let cur;
    try {
      cur = await ig.getComment(id);
    } catch (e) {
      if (e && e.permission) {
        await mark(id, 'failed', '권한 없음');
        failed.push({ id, why: 'instagram_manage_comments 권한 없음' });
        break;                                  // 권한 문제면 나머지도 똑같이 실패한다
      }
      await mark(id, 'gone', '원본 없음');
      skipped.push({ id, why: '이미 삭제됨' });
      continue;
    }

    // 2) 다시 판정 — 큐에 담긴 뒤 판정기가 바뀌었을 수 있다
    if (hide) {
      const sc = spam.score(cur.text || '');
      if (sc.total < THRESHOLD) {
        await mark(id, 'dismissed', `재판정 ${sc.total}점 — 기준점 미만이라 숨기지 않음`);
        skipped.push({ id, why: `재판정 ${sc.total}점 (기준 ${THRESHOLD})` });
        continue;
      }
    }

    // 3) 숨긴다 / 되돌린다 — 결과는 재조회로 확인
    try {
      const r = await ig.setHidden(id, hide);
      if (r.verified === false) {
        await mark(id, 'failed', '응답은 성공인데 상태가 안 바뀜');
        failed.push({ id, why: '응답 성공 · 상태 미변경' });
      } else {
        await mark(id, hide ? 'hidden' : 'pending', hide ? '숨김 확인됨' : '되돌림');
        done.push(id);
      }
    } catch (e) {
      const why = String((e && e.message) || e).slice(0, 150);
      await mark(id, 'failed', why);
      failed.push({ id, why });
      if (e && e.permission) break;
    }
  }

  const msg = `${hide ? '숨김' : '되돌리기'} ${done.length}건`
    + (skipped.length ? ` · 건너뜀 ${skipped.length}건(${skipped[0].why})` : '')
    + (failed.length ? ` · 실패 ${failed.length}건(${failed[0].why})` : '');
  return finish(res, wantsJson, msg, { done, skipped, failed });
};

async function mark(id, status, detail) {
  await supabaseAdmin.from('ig_comment_queue')
    .update({ status, detail: String(detail || '').slice(0, 300), decided_at: new Date().toISOString() })
    .eq('comment_id', id);
}

function finish(res, wantsJson, msg, extra) {
  if (wantsJson) return res.status(200).json(Object.assign({ ok: true, 결과: msg }, extra || {}));
  res.setHeader('Location', '/api/ops/ig-comment-queue?msg=' + encodeURIComponent(msg));
  return res.status(303).end();
}
