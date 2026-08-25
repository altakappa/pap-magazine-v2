/**
 * POST /api/pullletters/:id/resubmit — 수정 무드보드 재제출 (회원 본인 전용)
 *
 * 2026-08-25 도메니코: "피드백을 주면 신청자가 무드보드를 고쳐 다시 올리고,
 * 적합해지면 최종 발급." 이 왕복의 회원 쪽 절반이다.
 *
 * 규칙:
 *  - status === 'revision' 인 자기 신청에만 (수정 요청을 받은 건에만 재제출이 성립)
 *  - 새 파일은 기존 upload-url 서명 업로드로 이미 스토리지에 올라간 상태여야 하고,
 *    여기서는 그 publicUrl 을 file_urls 에 **추가**한다 (기존 파일 보존 — 이전
 *    버전과 비교하며 검토할 수 있어야 왕복이 의미 있다)
 *  - revision_history 에 {by:'member'} 기록, status → 'pending' (재검토 대기)
 *  - 운영자 텔레그램 알림 — 재제출이 조용히 쌓이면 또 24일 방치가 된다
 */
const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAuth } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');

const MAX_FILES = 10;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);   // 동기 — mine.js 와 같은 패턴
  if (!user) return;

  try {
    const { id } = req.query;
    const body = req.body || {};
    const fileUrls = Array.isArray(body.fileUrls) ? body.fileUrls.slice(0, MAX_FILES) : [];
    const note = String(body.note || '').trim().slice(0, 1000);

    if (!fileUrls.length) {
      return res.status(400).json({ message: '수정한 무드보드 파일이 필요합니다.', code: 'files_required' });
    }
    /* 우리 공개 버킷(pullletters)의 자기 폴더 URL 만 받는다 — 남의 파일·외부
       URL 을 신청에 붙이는 것을 막는다. upload-url.js 가 만드는 publicUrl 형식. */
    const safeUserId = String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const okPrefix = '/storage/v1/object/public/pullletters/' + safeUserId + '/';
    for (const u of fileUrls) {
      if (typeof u !== 'string' || u.indexOf(okPrefix) === -1 || !/^https:\/\//.test(u)) {
        return res.status(400).json({ message: '허용되지 않는 파일 URL 입니다.', code: 'bad_file_url' });
      }
    }

    const { data: row, error } = await supabaseAdmin
      .from('pullletters')
      .select('id, user_id, status, file_urls, revision_history, title')
      .eq('id', id).single();
    if (error || !row) return res.status(404).json({ message: 'Not found' });
    if (row.user_id !== user.id) return res.status(403).json({ message: 'Forbidden' });
    if (row.status !== 'revision') {
      return res.status(400).json({
        message: '수정 요청 상태의 신청에만 재제출할 수 있습니다.',
        code: 'not_in_revision',
      });
    }

    const hist = Array.isArray(row.revision_history) ? row.revision_history : [];
    hist.push({ at: new Date().toISOString(), by: 'member', note: note || undefined, files: fileUrls });
    const mergedFiles = (Array.isArray(row.file_urls) ? row.file_urls : []).concat(fileUrls).slice(0, 40);

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('pullletters')
      .update({ status: 'pending', file_urls: mergedFiles, revision_history: hist })
      .eq('id', id).eq('status', 'revision')   // 동시 요청 방어
      .select('id, status').single();
    if (upErr || !updated) throw upErr || new Error('resubmit update failed');

    await sendTextToTelegramSafe(
      '📎 풀레터 수정본 재제출 — "' + (row.title || id) + '"\n'
      + '새 파일 ' + fileUrls.length + '건' + (note ? ('\n메모: ' + note) : '')
      + '\n어드민에서 재검토해 주세요.'
    );

    return res.status(200).json({ ok: true, status: 'pending' });
  } catch (e) {
    console.error('[pullletter] resubmit 실패:', (e && e.message) || e);
    return res.status(500).json({ message: 'Failed to resubmit' });
  }
};
