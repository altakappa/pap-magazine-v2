/**
 * POST /api/article-submissions/:id/review — 아티클 기고 심사 (관리자)
 *
 * body: { action, feeType?, feedback?, notes? }
 *   action='set_fee'  — 홍보성 판정. feeType 'free' | 'branded'(€790)
 *   action='approve'  — 승인 → articles 에 **status='draft'** INSERT
 *   action='reject'   — 거절 (+ 제출자에게 보일 feedback)
 *   action='notes'    — 관리자 메모만
 *
 * ■ 유료 건은 결제 전에 승인되지 않는다
 * 도메니코 결정(2026-11-12): €790 안내는 **심사 후**에 보낸다. 그래서 제출은
 * 무료로 접수되고, 관리자가 branded 로 판정하면 안내 메일이 나가고
 * payment_status='awaiting_authorization' 이 된다. 그 상태에서 승인을 허용하면
 * **게재 후에 €790 을 영영 못 받는다** — 에디토리얼 쪽에서 이미 같은 이유로
 * 같은 게이트를 두고 있다. 그래서 여기서도 결제(또는 면제) 없이는 409 다.
 *
 * ■ 발행은 사람이 한다 (절대 규칙 4)
 * 승인은 `articles` 에 **draft** 를 만드는 데까지다. status='published' 로
 * 바꾸는 코드 경로는 이 파일에 없다. 발행 판단은 도메니코가 한다.
 *
 * ■ 본문은 우리가 안전한 HTML 로 만들어 넣는다
 * `articles.content` 는 공개 상세에서 innerHTML 로 들어간다. 그래서 접수 단계에서
 * 태그를 거부하고(articleSubmission.hasHtmlTag), 여기서 문단마다 <p> 로 감싸며
 * 안쪽 글자를 이스케이프한다(bodyToSafeHtml). 회원이 적은 글자가 마크업으로
 * 해석되는 경로를 아예 없앤다.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const A = require('../../_lib/articleSubmission');
const { sendEmail, templates } = require('../../_lib/email');
const { resolveEmailLang } = require('../../_lib/emailLocale');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');

/* 홍보성 아티클 게재료 — 에디토리얼 branded 와 같은 €790 (도메니코 2026-11-11
   "게재료가 790유로로 똑같이 적용"). 금액 상수는 submissionPayment 의 값을
   그대로 빌려 쓴다 — 두 벌로 두면 한쪽만 올라간다. */
const { SUBMISSION_FEE_CENTS } = require('../../_lib/submissionPayment');
const BRANDED_FEE_CENTS = SUBMISSION_FEE_CENTS.branded;

const FEE_TYPES = ['free', 'branded'];
const PAID_OK = ['paid', 'waived'];

async function loadProfile(userId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('email, display_name, language, email_language, country')
    .eq('id', userId)
    .single();
  return data || null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ message: 'Missing id', code: 'missing_id' });

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }
  const action = String((body && body.action) || '').trim();

  try {
    const { data: sub, error } = await supabaseAdmin
      .from('article_submissions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!sub) return res.status(404).json({ message: 'Submission not found', code: 'not_found' });

    const now = new Date().toISOString();

    // ── 관리자 메모 ──
    if (action === 'notes') {
      const notes = String(body.notes == null ? '' : body.notes).slice(0, 4000);
      const { error: e } = await supabaseAdmin.from('article_submissions')
        .update({ admin_notes: notes, updated_at: now }).eq('id', id);
      if (e) throw e;
      return res.status(200).json({ ok: true, admin_notes: notes });
    }

    // ── 홍보성 판정 ──
    if (action === 'set_fee') {
      const feeType = String(body.feeType || '').trim().toLowerCase();
      if (FEE_TYPES.indexOf(feeType) === -1) {
        return res.status(400).json({ message: 'feeType must be free or branded', code: 'fee_type_invalid' });
      }
      if (feeType === sub.fee_type) {
        return res.status(200).json({ ok: true, unchanged: true, fee_type: sub.fee_type, payment_status: sub.payment_status });
      }
      // 이미 결제된 건을 free 로 되돌리는 것은 환불 문제다 — 코드로 하지 않는다.
      if (feeType === 'free' && PAID_OK.indexOf(String(sub.payment_status)) !== -1) {
        return res.status(409).json({ message: 'This submission is already settled. Handle the refund first.', code: 'already_settled' });
      }

      const patch = feeType === 'branded'
        ? { fee_type: 'branded', payment_status: 'awaiting_authorization', fee_notified_at: now, updated_at: now }
        : { fee_type: 'free', payment_status: 'none', fee_notified_at: null, updated_at: now };
      const { error: e } = await supabaseAdmin.from('article_submissions').update(patch).eq('id', id);
      if (e) throw e;

      // €790 안내 메일 — ★ await (fire-and-forget 은 서버리스 프리즈로 안 나간다)
      if (feeType === 'branded') {
        try {
          const prof = await loadProfile(sub.user_id);
          if (prof && prof.email) {
            await sendEmail(prof.email, templates.articleSubmissionFee(
              { name: prof.display_name || '' },
              { title: sub.title, feeCents: BRANDED_FEE_CENTS },
              resolveEmailLang(prof)));
          }
        } catch (e2) {
          console.error('[article-review] €790 안내 메일 실패(판정은 저장됨):', (e2 && e2.message) || e2);
        }
        try {
          await sendTextToTelegramSafe('💰 아티클 홍보성 판정 → €790 안내 발송'
            + '\n제목: ' + String(sub.title || '').slice(0, 80) + '\nsubmission=' + id);
        } catch (_) {}
      }
      return res.status(200).json({ ok: true, fee_type: feeType, payment_status: patch.payment_status });
    }

    // ── 거절 ──
    if (action === 'reject') {
      const feedback = String(body.feedback == null ? '' : body.feedback).slice(0, 4000);
      const { error: e } = await supabaseAdmin.from('article_submissions')
        .update({ status: 'rejected', feedback: feedback || null, reviewed_by: admin.id, reviewed_at: now, updated_at: now })
        .eq('id', id);
      if (e) throw e;
      try {
        const prof = await loadProfile(sub.user_id);
        if (prof && prof.email) {
          await sendEmail(prof.email, templates.articleSubmissionRejected(
            { name: prof.display_name || '' }, { title: sub.title, feedback }, resolveEmailLang(prof)));
        }
      } catch (e2) {
        console.error('[article-review] 거절 메일 실패(판정은 저장됨):', (e2 && e2.message) || e2);
      }
      return res.status(200).json({ ok: true, status: 'rejected' });
    }

    // ── 승인 → articles draft ──
    if (action === 'approve') {
      // 유료 건은 결제(또는 면제) 없이 승인하지 않는다. 게재 후엔 받을 길이 없다.
      if (sub.fee_type === 'branded' && PAID_OK.indexOf(String(sub.payment_status)) === -1) {
        return res.status(409).json({
          message: 'This is a promotional piece (€790). Approve it after the fee is settled.',
          code: 'fee_unpaid',
          fee_type: sub.fee_type,
          payment_status: sub.payment_status,
        });
      }
      if (sub.published_article_id) {
        return res.status(200).json({ ok: true, unchanged: true, article_id: sub.published_article_id });
      }

      const gallery = [sub.cover_url].concat(Array.isArray(sub.image_urls) ? sub.image_urls : []).filter(Boolean);
      const safeContent = A.bodyToSafeHtml(sub.body);
      const bylineName = sub.author_name || null;

      const row = {
        title: sub.title,
        subtitle: sub.subtitle || null,
        category: sub.category,
        // 작성 언어가 영어면 영어 칸에도 같은 본문을 넣는다 — 언어 전환 시
        // 본문이 비어 보이지 않게(상세는 비-한국어 모드에서 content_en 을 본다).
        content: safeContent,
        content_en: sub.body_lang === 'en' ? safeContent : null,
        title_en: sub.body_lang === 'en' ? sub.title : null,
        thumbnail_url: sub.cover_url || null,
        hero_image_url: sub.cover_url || null,
        gallery,
        // credits 는 **배열**로 소비된다(pap-content-article.js: det.credits.map).
        // 객체를 넣으면 렌더러가 조용히 건너뛴다. 바이라인도 배열 원소로 넣는다.
        credits: bylineName
          ? [{ role: 'Words', name: bylineName, instagram: sub.author_instagram || '', website: sub.author_website || '' }]
          : [],
        slug: null,                 // 발행 시 도메니코가 정한다
        published_date: null,       // draft 는 게시일 없음
        status: 'draft',            // 절대 규칙 4 — INSERT 는 draft 로만
        source_article_submission_id: sub.id,
        created_by: admin.id,
      };

      const { data: article, error: insErr } = await supabaseAdmin
        .from('articles').insert(row).select('id, status').single();
      if (insErr) {
        console.error('[article-review] articles insert failed:', insErr);
        throw insErr;
      }

      const { error: e } = await supabaseAdmin.from('article_submissions')
        .update({
          status: 'approved',
          published_article_id: article.id,
          feedback: String(body.feedback == null ? '' : body.feedback).slice(0, 4000) || null,
          reviewed_by: admin.id, reviewed_at: now, updated_at: now,
        })
        .eq('id', id);
      if (e) throw e;

      try {
        const prof = await loadProfile(sub.user_id);
        if (prof && prof.email) {
          await sendEmail(prof.email, templates.articleSubmissionApproved(
            { name: prof.display_name || '' }, { title: sub.title }, resolveEmailLang(prof)));
        }
      } catch (e2) {
        console.error('[article-review] 승인 메일 실패(승인은 저장됨):', (e2 && e2.message) || e2);
      }
      try {
        await sendTextToTelegramSafe('✅ 아티클 기고 승인 → 기사 초안 생성'
          + '\n제목: ' + String(sub.title || '').slice(0, 80)
          + '\narticle=' + article.id + ' (draft — 발행은 수동)'
          + '\nsubmission=' + id);
      } catch (_) {}

      return res.status(200).json({ ok: true, status: 'approved', article_id: article.id, article_status: article.status });
    }

    return res.status(400).json({ message: 'Unknown action', code: 'unknown_action' });
  } catch (error) {
    console.error('[article-submissions/review] error:', error);
    // 원문 노출 금지 (.claude/rules/api.md A-3)
    return res.status(500).json({ message: 'Review action failed. Check the server logs.', code: 'review_failed' });
  }
};
