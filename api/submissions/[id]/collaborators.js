/**
 * PUT /api/submissions/[id]/collaborators — 공동작업자만 고친다 (2026-11-15)
 *
 * ■ 왜 문을 따로 내나
 * 전체 수정(PUT /api/submissions/[id])은 pending·revision 에서만 열린다. 심사가 끝난
 * 뒤에 제목·이미지·룩 크레딧이 바뀌면 "심사한 것" 과 "실린 것" 이 달라지기 때문이고,
 * 그 잠금은 그대로 두는 게 맞다.
 * 그런데 공동작업자는 심사 판단과 아무 상관이 없다. 실제 기한은 '심사 종료' 가 아니라
 * '인스타그램 게시 전' 이다 — 인스타그램은 이미 올라간 게시물에 공동작업자를 붙일 수
 * 없으니까.
 *
 * 실측(도메니코 2026-11-15): 승인이 끝난 뒤 연간 프리미엄으로 올린 회원이 공동작업자를
 * 적을 곳이 없어 사람에게 물어 왔다("리스트를 어디에 적나요"). 전체 수정을 열어 주면
 * 심사 내용까지 함께 열리므로, 공동작업자 한 칸만 받는 문을 따로 만든다.
 *
 * ■ 열리는 조건 — 하나라도 어긋나면 거부한다
 *   · 제출자 본인(관리자는 대행 가능)
 *   · 거절된 건이 아니다 — 실릴 것이 없으면 태그할 자리도 없다
 *   · 연결된 에디토리얼이 아직 발행되지 않았다
 *   · 연간 프리미엄 — validateCollaborators 안에서 canPickCollaborators 가 재판정한다.
 *     폼·접수 메일·승인 재판정과 같은 함수 하나를 쓴다. 기준이 갈라지면 한쪽은 막고
 *     한쪽은 된다고 말하는 일이 생긴다.
 *
 * ■ 알림은 제출 경로와 같은 모양으로 보낸다
 * 머리말 + 복사용 크레딧은 이 자리에서, 4:5 합성 이미지는 워커(collab-telegram)로.
 * 바뀐 게 없으면 아무것도 보내지 않는다 — 같은 알림이 두 번 오면 신호가 죽는다.
 */
'use strict';

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { requireAuth } = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { validateCollaborators, collaboratorAlertText, MAX_COLLABORATORS } = require('../../_lib/collaborators');
const { collabCreditText, dispatchCollabImages, collaboratorsChanged } = require('../../_lib/collabTelegram');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');

/** 실릴 일이 없는 건에는 태그할 자리도 없다. */
const BLOCKED_STATUSES = ['rejected'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'PUT' && req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const id = String((req.query && req.query.id) || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ message: 'Missing submission id', code: 'bad_id' });
  }

  try {
    const { data: submission, error: sErr } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, title, status, file_urls, description')
      .eq('id', id)
      .single();
    if (sErr || !submission) {
      return res.status(404).json({ message: 'Submission not found', code: 'not_found' });
    }

    const isAdmin = user.role === 'admin';
    if (submission.user_id !== user.id && !isAdmin) {
      return res.status(403).json({ message: 'Only the submitter can change collaborators', code: 'not_owner' });
    }
    if (BLOCKED_STATUSES.indexOf(String(submission.status)) !== -1) {
      return res.status(409).json({
        message: 'Collaborators can no longer be changed for this submission.',
        code: 'not_editable',
      });
    }

    /* 발행됐으면 끝이다. 인스타그램 게시물에는 나중에 공동작업자를 붙일 수 없으므로
       "바꿀 수 있다" 고 말하면 거짓이 된다. 여기서 정직하게 닫는다. */
    const { data: eds } = await supabaseAdmin
      .from('editorials')
      .select('id, status')
      .eq('source_submission_id', submission.id);
    const published = (eds || []).some((e) => String(e && e.status) === 'published');
    if (published) {
      return res.status(409).json({
        message: 'This editorial is already published, so collaborators can no longer be changed.',
        code: 'editorial_published',
      });
    }

    let desc = {};
    try { desc = submission.description ? JSON.parse(submission.description) : {}; } catch (_) { desc = {}; }

    const incoming = (req.body && (req.body.collaborators || req.body.handles)) || [];
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ message: 'collaborators must be an array', code: 'bad_body' });
    }
    if (incoming.length > MAX_COLLABORATORS) {
      return res.status(400).json({
        message: 'At most ' + MAX_COLLABORATORS + ' collaborators',
        code: 'COLLAB_MAX',
      });
    }

    /* 자격 판정은 **제출자** 기준이다 — 혜택은 제출자의 것이다. 관리자가 대행할 때만
       isAdmin 으로 통과한다(관리자 자신의 구독을 보지 않는다). */
    const v = await validateCollaborators(supabaseAdmin, incoming, {
      userId: submission.user_id,
      isAdmin,
    });
    if (!v.ok) {
      return res.status(400).json({ message: v.message, code: v.code, handles: v.handles || [] });
    }

    const prev = Array.isArray(desc.collaborators) ? desc.collaborators : [];
    const next = v.collaborators;
    if (!collaboratorsChanged(prev, next)) {
      return res.status(200).json({ ok: true, unchanged: true, collaborators: next });
    }

    desc.collaborators = next;
    desc.collaboratorsEditedAt = new Date().toISOString();
    const { error: uErr } = await supabaseAdmin
      .from('submissions')
      .update({ description: JSON.stringify(desc) })
      .eq('id', submission.id);
    if (uErr) {
      console.error('[collaborators] 저장 실패:', uErr.message);
      return res.status(500).json({ message: 'Failed to save collaborators', code: 'save_failed' });
    }

    /* ★ await — fire-and-forget 은 서버리스 프리즈로 실제 발송이 안 된다
       (승인 메일 0/35 실측 전례). 알림이 실패해도 저장은 되돌리지 않는다. */
    if (next.length) {
      const who = (user.email || submission.user_id);
      try { await sendTextToTelegramSafe(collaboratorAlertText('collab_edit', submission, next, who)); } catch (_) {}
      try { await sendTextToTelegramSafe(collabCreditText(submission, desc, next)); } catch (_) {}
      /* 이미지 워커는 new·resubmit 두 꼬리표만 안다(캡션 '신규'·'수정').
         공동작업자만 고친 건은 '신규' 가 아니라 '수정' 이 사실에 가깝다. */
      try { await dispatchCollabImages(submission.id, 'resubmit'); } catch (_) {}
    } else {
      try {
        await sendTextToTelegramSafe('🤝 인스타그램 공동작업자 전체 해제\n제목: '
          + String(submission.title || '').slice(0, 80) + '\nsubmission=' + submission.id);
      } catch (_) {}
    }

    return res.status(200).json({ ok: true, collaborators: next });
  } catch (e) {
    console.error('[collaborators] 예외:', e && e.message);
    return res.status(500).json({ message: 'Failed to change collaborators', code: 'failed' });
  }
};
