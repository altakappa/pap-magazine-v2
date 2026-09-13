'use strict';
/**
 * 풀레터 → 완성 에디토리얼 서브미션 연결 (도메니코 2026-09-13).
 *   "풀레터를 받아간 사람은 웹사이트 내에서 완성된 에디토리얼 제출하기를 통해 서브미션처럼
 *    똑같은 제출 과정을 거쳐 최종 제출이 되어야 해."
 *
 * 흐름: 마이페이지 풀레터 카드(발급 완료) → "완성된 에디토리얼 제출하기" → /submission?pullletter=<id>
 *       → 일반 서브미션과 같은 폼·같은 판정 → POST 가 data.pullLetterId 를 받아 여기서 검증·연결.
 * 규칙: 본인 풀레터 · 발급된 것(issued/approved + PDF) · 아직 연결 안 된 것. 한 풀레터에 한 서브미션.
 */
const ELIGIBLE_STATUSES = ['issued', 'approved', 'accepted'];

/** 연결 가능한 풀레터인지 판정. { ok:true, pullLetter } | { ok:false, code, message } */
async function checkPullLetterForSubmission(supabaseAdmin, userId, pullLetterId) {
  const id = String(pullLetterId || '').trim();
  if (!id) return { ok: false, code: 'PULL_LETTER_INVALID', message: 'Invalid pull-letter id' };
  const { data: pl, error } = await supabaseAdmin
    .from('pullletters').select('id, user_id, status, pull_letter_url, submission_id, title').eq('id', id).maybeSingle();
  if (error || !pl) return { ok: false, code: 'PULL_LETTER_NOT_FOUND', message: 'Pull-letter not found' };
  if (pl.user_id !== userId) return { ok: false, code: 'PULL_LETTER_NOT_YOURS', message: 'This pull-letter belongs to another member' };
  if (ELIGIBLE_STATUSES.indexOf(String(pl.status || '').toLowerCase()) === -1 || !pl.pull_letter_url) {
    return { ok: false, code: 'PULL_LETTER_NOT_ISSUED', message: 'This pull-letter has not been issued yet' };
  }
  if (pl.submission_id) return { ok: false, code: 'PULL_LETTER_ALREADY_SUBMITTED', message: 'An editorial has already been submitted for this pull-letter', submissionId: pl.submission_id };
  return { ok: true, pullLetter: pl };
}

/** 서브미션이 만들어진 뒤 풀레터 쪽에 연결을 기록한다. 실패해도 제출은 살린다(호출자가 catch). */
async function linkPullLetterToSubmission(supabaseAdmin, pullLetterId, submissionId) {
  const { error } = await supabaseAdmin
    .from('pullletters')
    .update({ submission_id: submissionId, editorial_submitted_at: new Date().toISOString() })
    .eq('id', pullLetterId)
    .is('submission_id', null);
  if (error) throw error;
}

module.exports = { ELIGIBLE_STATUSES, checkPullLetterForSubmission, linkPullLetterToSubmission };
