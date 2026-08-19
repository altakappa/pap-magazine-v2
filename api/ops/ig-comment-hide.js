/**
 * POST|GET /api/ops/ig-comment-hide — IG 댓글 1건 숨기기 (쓰기 시험 · 수동)
 *
 * 왜 이렇게 조심스러운가 (2026-08-19):
 *   숨기기는 되돌릴 수 있지만, 팬 댓글을 숨기는 것은 되돌려도 이미 손해다.
 *   그리고 오늘 이미 한 번 오탐을 냈다 — 이모지 댓글 20건이 '살포'로 묶여
 *   기준점을 넘었다(b677f8f 에서 수정). 판정기를 만든 사람이 판정기를
 *   전적으로 믿으면 안 된다.
 *
 *   그래서 이 엔드포인트는 다음을 전부 만족해야만 움직인다.
 *     ① 관리자(또는 CRON_SECRET) 인증
 *     ② commentId 를 명시적으로 지정 — '알아서 고르기' 없음
 *     ③ confirm=hide 를 명시 — 주소만 열려서 실행되는 일이 없게
 *     ④ 그 댓글을 다시 읽어 점수를 매겨 기준점(60) 이상일 때만 숨긴다
 *        판정기가 스팸이라고 안 하는 것은 사람이 시켜도 안 숨긴다
 *     ⑤ 한 번에 1건. 일괄 처리 경로는 이 파일에 없다
 *
 *   삭제는 하지 않는다. 이 파일에 delete 는 존재하지 않는다.
 *   (절대 규칙: 삭제는 도메니코가 직접)
 *
 * 되돌리기: ?unhide=1 로 같은 댓글을 다시 보이게 한다.
 */

const { requireAdmin } = require('../_lib/auth');
const { sanitizeCredential } = require('../_lib/instagramImport');
const spam = require('../_lib/igCommentSpam');

const API = 'https://graph.facebook.com/v21.0';
const THRESHOLD = 60;

function scrub(text, token) {
  let s = String(text == null ? '' : text);
  if (token) s = s.split(token).join('[TOKEN]');
  return s.slice(0, 300);
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const q = req.query || {};
  const token = sanitizeCredential(process.env.IG_ACCESS_TOKEN);
  if (!token) return res.status(200).json({ ok: false, 결론: 'IG_ACCESS_TOKEN 미설정' });

  const commentId = String(q.commentId || '').trim();
  if (!/^[0-9]{5,}$/.test(commentId)) {
    return res.status(400).json({ ok: false, 결론: 'commentId 가 필요합니다 (probe 응답의 댓글ID)' });
  }
  const unhide = q.unhide === '1';
  if (!unhide && q.confirm !== 'hide') {
    return res.status(400).json({
      ok: false,
      결론: 'confirm=hide 가 없습니다. 주소만 열려서 실행되는 것을 막는 안전장치입니다.',
    });
  }

  // ── 1. 대상 댓글을 다시 읽는다 ─────────────────────────────
  const readUrl = `${API}/${commentId}?fields=id,text,hidden,timestamp&access_token=${encodeURIComponent(token)}`;
  const rr = await fetch(readUrl, { signal: AbortSignal.timeout(15000) });
  const before = await rr.json().catch(() => ({}));
  if (!rr.ok) {
    const err = (before && before.error) || {};
    return res.status(200).json({
      ok: false, 단계: '대상 읽기', status: rr.status, code: err.code,
      오류: scrub(err.message, token),
      결론: '그 댓글을 못 읽는다. ID 가 틀렸거나 이미 지워졌다.',
    });
  }

  const judged = spam.score(before.text || '');

  // ── 2. 판정기가 동의하지 않으면 숨기지 않는다 ───────────────
  if (!unhide && judged.total < THRESHOLD) {
    return res.status(200).json({
      ok: false,
      단계: '판정',
      점수: judged.total, 기준점: THRESHOLD, 신호: judged.signals,
      원문: String(before.text || '').slice(0, 120),
      결론: '판정기가 스팸으로 안 본다. 사람이 시켜도 숨기지 않는다. '
        + '진짜 스팸인데 안 걸렸다면 그건 탐지기를 고칠 일이지 이걸 우회할 일이 아니다.',
    });
  }

  // ── 3. 숨긴다 (또는 되돌린다) ──────────────────────────────
  const writeUrl = `${API}/${commentId}?hide=${unhide ? 'false' : 'true'}&access_token=${encodeURIComponent(token)}`;
  const wr = await fetch(writeUrl, { method: 'POST', signal: AbortSignal.timeout(15000) });
  const wbody = await wr.json().catch(() => ({}));

  if (!wr.ok) {
    const err = (wbody && wbody.error) || {};
    const noPerm = wr.status === 403 || err.code === 200 || err.code === 10;
    return res.status(200).json({
      ok: false, 단계: '쓰기', status: wr.status, code: err.code,
      오류: scrub(err.message, token),
      결론: noPerm
        ? '숨기기 권한이 없다 → Meta 앱에 instagram_manage_comments 쓰기 승인 필요'
        : '숨기기 실패 — 위 오류 확인',
    });
  }

  // ── 4. 실제로 바뀌었는지 다시 읽어 확인한다 ─────────────────
  const vr = await fetch(readUrl, { signal: AbortSignal.timeout(15000) });
  const after = await vr.json().catch(() => ({}));

  return res.status(200).json({
    ok: true,
    동작: unhide ? '되돌리기(다시 보이게)' : '숨기기',
    댓글ID: commentId,
    점수: judged.total, 신호: judged.signals,
    원문: String(before.text || '').slice(0, 120),
    이전_hidden: before.hidden,
    이후_hidden: after.hidden,
    검증: after.hidden === (unhide ? false : true) ? '확인됨' : '⚠️ 응답은 성공인데 상태가 안 바뀌었다',
    결론: unhide
      ? '다시 보이게 했다.'
      : '숨겼다. 삭제가 아니다 — ?commentId=' + commentId + '&unhide=1 로 되돌릴 수 있다.',
  });
};
