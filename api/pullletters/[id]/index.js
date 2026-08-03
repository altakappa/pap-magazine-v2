/**
 * DELETE /api/pullletters/:id — 신청자 본인이 자기 풀레터 요청을 철회한다.
 *
 * 2026-07-26 감사 B-2 — 지금까지 회원에게는 취소 수단이 전혀 없었다
 * (있는 건 mine.js GET, 관리자 review PUT 뿐). 잘못 낸 요청을 지우려면
 * 운영자에게 메일을 보내야 했다. 서브미션(api/submissions/[id].js DELETE)과
 * 같은 규칙으로 소유자 전용 하드삭제를 연다.
 *
 * 가드레일
 *   • 소유자만 (user_id === user.id) — 아니면 403
 *   • status === 'pending' 일 때만 — 검토가 시작·완료된 뒤(approved /
 *     accepted / issued / rejected)에는 409. 특히 issued 는 발급 PDF 가
 *     이미 나간 상태라 삭제하면 이력이 끊긴다.
 *   • 발급 PDF(pull_letter_url)가 붙어 있으면 상태와 무관하게 409.
 *   • 행 삭제 후 스토리지 정리 — 무드보드(공개 'pullletters' 버킷) +
 *     촬영시안 PDF(비공개 'pull-letters' 버킷). 실패는 비치명(로그만).
 *
 * 자동 삭제는 없다 — 이 경로는 언제나 사람(신청자)의 명시적 요청이다.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAuth } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

// 무드보드는 공개 버킷의 공개 URL 로 저장된다 →
// "<uid>/<filename>" 부분만 뽑아 remove() 에 넘긴다.
const MOODBOARD_BUCKET = 'pullletters';
const PROPOSAL_BUCKET = 'pull-letters';

function _moodboardPathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = '/storage/v1/object/public/' + MOODBOARD_BUCKET + '/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const tail = url.slice(idx + marker.length);
  const qIdx = tail.indexOf('?');
  return qIdx === -1 ? tail : tail.slice(0, qIdx);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ message: 'Missing pull-letter id' });
    }

    const { data: pl, error } = await supabaseAdmin
      .from('pullletters')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !pl) {
      return res.status(404).json({ message: 'Pull-letter request not found' });
    }

    if (pl.user_id !== user.id) {
      return res.status(403).json({
        message: 'Only the requester can cancel this pull-letter request',
        code: 'not_owner',
      });
    }

    // 2026-08-03 — 'on_hold'(무료체험 중 접수 자동 보류)도 아직 검토 전 상태라
    // 회원이 스스로 취소할 수 있어야 한다.
    if (pl.status !== 'pending' && pl.status !== 'on_hold') {
      return res.status(409).json({
        message: 'This request can no longer be cancelled (status: ' + pl.status + ')',
        code: 'not_cancellable',
      });
    }
    if (pl.pull_letter_url) {
      return res.status(409).json({
        message: 'This request already has an issued pull-letter and cannot be cancelled',
        code: 'already_issued',
      });
    }

    const { error: delErr } = await supabaseAdmin
      .from('pullletters')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (delErr) {
      // 원문 DB 메시지는 서버 로그에만 (A-3 과 같은 규칙)
      console.error('Pull-letter DELETE failed:', delErr);
      return res.status(500).json({
        message: 'Failed to cancel the request. If this keeps happening, contact contact@pap-magazine.com',
        code: 'cancel_failed',
      });
    }

    // ── 스토리지 정리 (비치명) ──
    let storageDeleted = 0;
    try {
      const moodPaths = [];
      const fileUrls = Array.isArray(pl.file_urls) ? pl.file_urls : [];
      for (const u of fileUrls) {
        const p = _moodboardPathFromUrl(u);
        if (p) moodPaths.push(p);
      }
      if (moodPaths.length) {
        const { error: rmErr } = await supabaseAdmin
          .storage.from(MOODBOARD_BUCKET).remove(moodPaths);
        if (rmErr) console.warn('[pullletters DELETE] moodboard remove failed', id, '—', rmErr.message);
        else storageDeleted += moodPaths.length;
      }
      // 촬영시안 PDF 는 비공개 버킷의 '경로'가 그대로 저장돼 있다.
      if (pl.proposal_pdf_url && typeof pl.proposal_pdf_url === 'string') {
        const { error: rmErr2 } = await supabaseAdmin
          .storage.from(PROPOSAL_BUCKET).remove([pl.proposal_pdf_url]);
        if (rmErr2) console.warn('[pullletters DELETE] proposal remove failed', id, '—', rmErr2.message);
        else storageDeleted += 1;
      }
    } catch (swErr) {
      console.warn('[pullletters DELETE] storage sweep threw', id, '—', swErr && swErr.message);
    }

    return res.status(200).json({ ok: true, id, storageDeleted });
  } catch (err) {
    console.error('Cancel pull-letter error:', err);
    return res.status(500).json({
      message: 'Failed to cancel the request. If this keeps happening, contact contact@pap-magazine.com',
      code: 'cancel_failed',
    });
  }
};
