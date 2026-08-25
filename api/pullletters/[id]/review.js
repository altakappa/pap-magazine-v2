/**
 * PUT /api/pullletters/:id/review — Admin review a pull-letter
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { sendEmail, templates } = require('../../_lib/email');
const { resolveEmailLang } = require('../../_lib/emailLocale');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { id } = req.query;
    const { status, reviewNote, pullLetterPath } = req.body;

    // 'issued' added for the community-flow PDF deliverable. Existing
    // 'accepted'/'rejected' still work for legacy multipart requests.
    // 2026-08-03 — 'on_hold'(무료체험 중 접수 보류)와 'pending'(보류 해제 후
    // 정상 검토 대기)을 추가. 서버가 자동으로 넣은 보류를 첫 결제 확인 뒤
    // 관리자가 되돌릴 수 있어야 한다.
    /* 'revision' (2026-08-25 도메니코) — 무드보드 수정 요청. 피드백과 함께
       회원에게 돌아가고, 회원이 수정본을 재제출하면 다시 pending 이 된다.
       적합해질 때까지 왕복하다 최종 발급하는 흐름의 축. */
    if (!status || !['pending', 'on_hold', 'accepted', 'approved', 'rejected', 'issued', 'revision'].includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: pending, on_hold, accepted, approved, rejected, issued, revision' });
    }
    if (status === 'revision' && !String(reviewNote || '').trim()) {
      /* 피드백 없는 수정 요청은 회원이 뭘 고쳐야 하는지 모른다 — 막는다. */
      return res.status(400).json({ message: '수정 요청에는 피드백(Admin notes)이 필요합니다.', code: 'revision_needs_note' });
    }

    const update = {
      status,
      admin_notes: reviewNote || '',
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    };
    // A-4 (2026-07-26 감사) — 발급 PDF 경로 위조 방지. upload.js 가 만드는
    // '<uid>/<파일>.pdf' 형식(폴더 1단계 + .pdf, 경로 이탈 금지)만 허용.
    var _plPath = null;
    if (typeof pullLetterPath === 'string' && pullLetterPath) {
      if (pullLetterPath.indexOf('..') === -1 && /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.pdf$/i.test(pullLetterPath)) {
        _plPath = pullLetterPath;
      } else {
        return res.status(400).json({ message: 'Invalid pullLetterPath', code: 'invalid_path' });
      }
    }
    if (status === 'issued') {
      update.issued_at = new Date().toISOString();
      if (_plPath) update.pull_letter_url = _plPath;
      else {
        /* ── 자동 발급 (2026-08-24 도메니코 지시) ─────────────────────────
           "승인하면 포토그래퍼·스타일리스트 이름과 발급일이 자동으로 들어간
            풀레터가 만들어져야 한다."
           PDF 를 첨부하지 않고 발급을 누르면 서버가 공문을 직접 만든다.
           발행 판단은 여전히 사람이다 — 이 코드는 관리자의 '발급' 클릭
           이후에만 돈다(자동 발행 금지 원칙과 충돌하지 않는다).
           수동 업로드(_plPath)는 그대로 살아 있다 — 특수한 공문이 필요하면
           예전처럼 파일을 첨부하면 이 블록은 돌지 않는다. */
        const { data: row, error: rowErr } = await supabaseAdmin
          .from('pullletters').select('id, user_id, title, team_info').eq('id', id).single();
        if (rowErr || !row) {
          return res.status(404).json({ message: 'Pull letter not found', code: 'not_found' });
        }
        const team = row.team_info || {};
        const phName = team.photographer && team.photographer.name;
        const stName = team.stylist && team.stylist.name;
        if (!phName || !stName) {
          /* 이름이 없으면 만들 수 없다 — 조용히 빈 공문을 내보내는 게 최악이다. */
          return res.status(400).json({
            message: '자동 발급 불가: 신청서에 포토그래퍼/스타일리스트 이름이 없습니다. PDF 를 직접 첨부해 발급하세요.',
            code: 'auto_issue_missing_names',
          });
        }
        try {
          const { generatePullLetterPdf, docNoFor, issueDateTextFor } = require('../../_lib/pullLetterPdf');
          const now = new Date();
          const pdf = await generatePullLetterPdf({
            photographer: phName,
            stylist: stName,
            project: row.title || '',
            docNo: docNoFor(row.id, now),
            issueDateText: issueDateTextFor(now),
          });
          const autoPath = row.user_id + '/' + row.id + '-auto-' + Date.now() + '.pdf';
          const { error: upErr } = await supabaseAdmin.storage
            .from('pull-letters')
            .upload(autoPath, pdf, { contentType: 'application/pdf', upsert: false });
          if (upErr) throw new Error('storage upload failed: ' + upErr.message);
          update.pull_letter_url = autoPath;
        } catch (e) {
          /* 실패를 issued 로 덮지 않는다 — 발급 없이 발급 완료가 되면
             회원은 빈 다운로드를 본다. 에러를 그대로 관리자에게 돌려준다. */
          console.error('[pullletter] 자동 발급 실패:', (e && e.message) || e);
          return res.status(500).json({
            message: '풀레터 자동 생성 실패: ' + String((e && e.message) || e).slice(0, 200),
            code: 'auto_issue_failed',
          });
        }
      }
    } else if (_plPath) {
      // Allow attaching the PDF on approval too (pre-issue), optional.
      update.pull_letter_url = _plPath;
    }

    if (status === 'revision') {
      /* 왕복 이력 — 몇 번째 피드백인지가 남아야 대화가 된다. */
      const { data: cur } = await supabaseAdmin
        .from('pullletters').select('revision_history').eq('id', id).single();
      const hist = Array.isArray(cur && cur.revision_history) ? cur.revision_history : [];
      hist.push({ at: new Date().toISOString(), by: 'pap', note: String(reviewNote || '').trim() });
      update.revision_history = hist;
    }

    const { data: pullLetter, error } = await supabaseAdmin
      .from('pullletters')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Send notification email (non-blocking). 'issued' uses the accepted
    // template until a dedicated 'issued' template is added.
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('email, name, email_language, language, country').eq('id', pullLetter.user_id).single();
    // 2026-08-03 — 'pending'/'on_hold' 는 내부 상태 전환일 뿐이라 회원에게
    // 메일을 보내지 않는다. (보류 사실을 매번 알리면 오히려 혼란)
    const _silent = status === 'pending' || status === 'on_hold';
    if (profile && !_silent) {
      const _lang = resolveEmailLang(profile);
      const isPositive = status === 'accepted' || status === 'approved' || status === 'issued';
      const tpl = status === 'issued'
        ? templates.pullletterIssued({ name: profile.name }, reviewNote, _lang)
        : status === 'revision'
          ? templates.pullletterRevision({ name: profile.name }, reviewNote, _lang)
          : isPositive
            ? templates.pullletterAccepted({ name: profile.name }, reviewNote, _lang)
            : templates.pullletterRejected({ name: profile.name }, reviewNote, _lang);
      sendEmail(profile.email, tpl).catch(() => {});
    }

    return res.status(200).json({ pullLetter });
  } catch (error) {
    console.error('Review pull-letter error:', error);
    return res.status(500).json({ message: 'Failed to review pull-letter' });
  }
};
