/**
 * PATCH /api/editorials/:id/credits — 프리미엄 회원의 크레딧 자가 수정
 *
 * 2026-08-26 도메니코 지시 / 스펙:
 *   PAP-Vault/45_Business/스펙-에디토리얼-크레딧-수정-프리미엄-2026-08-26.md
 *
 * 검증 순서를 스펙 3-C 그대로 지킨다. 순서가 곧 방어선이다.
 *   인증 → 소유 → 프리미엄 → 게재 상태 → 입력 → 횟수 → 결제 →
 *   브랜드 종류 수 감소 금지 → 라틴 전용 → 저장 → 이력 → 알림
 *
 * 넣지 않은 것 (일부러 뺐다)
 *   브랜드명 편집거리 가드. 도메니코 결정 0-2-b 로 전면 교체를 허용한다.
 *   되살리지 말 것. 대신 텔레그램 알림이 의심 신호를 표시한다.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { requireAuthStrict } = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { hasActivePremium } = require('../../_lib/subscriptionAccess');
const { spaRuleApplies, isSpaBrand, isGenericCredit } = require('../../_lib/submissionType');
const { findNonLatin } = require('../../_lib/latinOnly');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');
const { recordContentChange } = require('../../_lib/audit');
const ce = require('../../_lib/creditEdit');

const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // 1. 인증. 수정(쓰기)이므로 token_version 까지 보는 strict 를 쓴다.
  //    로그아웃으로 무효화된 토큰이 남의 지면을 고치지 못하게 한다.
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  const id = (req.query && req.query.id) || '';
  if (!id) return res.status(400).json({ message: 'Editorial id is required' });

  try {
    const { data: ed, error: edErr } = await supabaseAdmin
      .from('editorials')
      .select('id, title, slug, status, source_submission_id, credits, fashion, credits_edit_count, credits_history')
      .eq('id', id)
      .single();
    if (edErr || !ed) return res.status(404).json({ message: 'Editorial not found' });

    // 2. 소유 확인. source_submission_id 가 없는 행(인스타 임포트·legacy)은
    //    주인이 없으므로 아무도 고칠 수 없다. 404 로 존재 자체를 감춘다.
    if (!ed.source_submission_id) {
      return res.status(404).json({ message: 'Editorial not found' });
    }
    const { data: sub, error: subErr } = await supabaseAdmin
      .from('submissions')
      .select('id, user_id, payment_status, created_at')
      .eq('id', ed.source_submission_id)
      .single();
    if (subErr || !sub || sub.user_id !== user.id) {
      return res.status(404).json({ message: 'Editorial not found' });
    }

    // 3. 프리미엄 판정은 반드시 서버에서. 프론트 게이트만으로는
    //    무료 회원이 이 API 를 직접 호출해 고칠 수 있다.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, display_name, subscription_plan, subscription_status')
      .eq('id', user.id)
      .single();
    if (!hasActivePremium(profile || {})) {
      return res.status(403).json({
        message: '크레딧 수정은 프리미엄 멤버십에 포함된 기능입니다.',
        reason: 'not_premium',
      });
    }

    // 4. 게재된 건만 대상. 초안·예약 건은 아직 관리자 흐름 안에 있다.
    if (ed.status !== 'published') {
      return res.status(409).json({ message: '게재된 에디토리얼만 수정할 수 있습니다.', reason: 'not_published' });
    }

    // 5. 입력 검증
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prevCredits = Array.isArray(ed.credits) ? ed.credits : [];
    const prevFashion = ed.fashion && typeof ed.fashion === 'object' && !Array.isArray(ed.fashion) ? ed.fashion : {};
    const prevBrands = Array.isArray(prevFashion.brands) ? prevFashion.brands : [];

    const creditsIn = body.credits === undefined ? prevCredits : body.credits;
    const brandsIn = body.brands === undefined ? prevBrands : body.brands;

    const c = ce.sanitizeCredits(creditsIn);
    if (c.error) return res.status(400).json({ message: c.error, reason: 'invalid_credits' });
    const b = ce.sanitizeBrands(brandsIn);
    if (b.error) return res.status(400).json({ message: b.error, reason: 'invalid_brands' });
    const nextCredits = c.rows;
    const nextBrands = b.rows;

    // 6. 횟수. 검증 실패는 차감하지 않으므로 여기서 본다(저장 직전에 증가).
    const used = Number(ed.credits_edit_count || 0);
    if (used >= ce.MAX_CREDIT_EDITS) {
      return res.status(403).json({
        message: '수정 가능 횟수(' + ce.MAX_CREDIT_EDITS + '회)를 모두 사용했습니다. 추가 수정은 문의해 주세요.',
        reason: 'limit_reached',
        editsUsed: used,
        maxEdits: ce.MAX_CREDIT_EDITS,
      });
    }

    // 7. 결제 게이트. 화이트리스트다 (스펙 0-2-c).
    const pay = sub.payment_status || 'none';
    if (!ce.PAYMENT_EDITABLE.includes(pay)) {
      return res.status(403).json({
        message: '게재료 결제 완료 후 수정할 수 있습니다. MY SUBMISSIONS 에서 결제를 완료해 주세요.',
        reason: 'payment_pending',
        paymentStatus: pay,
      });
    }

    // 8. 라틴 전용. 제출은 영어로 받아 놓고 수정으로 한글을 넣는 우회를 막는다.
    //    팀 크레딧(사람 이름)에는 적용하지 않는다 (스펙 C-11).
    //    스펙 3-C 는 이 검사를 브랜드 수 가드 뒤에 두었으나 순서를 앞으로
    //    옮겼다. 비라틴 이름은 isGenericCredit 의 키가 빈 문자열이 되어
    //    종류 수에서 빠지므로, 뒤에 두면 '한글은 못 쓴다'가 아니라
    //    '브랜드가 줄어든다'는 엉뚱한 안내가 나간다. 막는 강도는 같다.
    const latinEntries = [];
    nextBrands.forEach(function (row, i) {
      latinEntries.push({ label: 'brands[' + i + '].name', value: row.name });
      if (row.instagram) latinEntries.push({ label: 'brands[' + i + '].instagram', value: row.instagram });
    });
    const bad = findNonLatin(latinEntries);
    if (bad.length) {
      return res.status(400).json({
        message: '브랜드명과 핸들은 영문(라틴 문자)으로만 입력할 수 있습니다: ' + bad.map(function (x) { return x.value; }).join(', '),
        reason: 'non_latin_brand',
        violations: bad,
      });
    }

    // 9. 브랜드 종류 수 감소 금지. SPA 제외 여부는 그 서브미션의 요금을
    //    정한 규칙과 같아야 한다(제출 시각 기준). 다르면 유예 대상 건에서
    //    가드가 헐거워진다.
    const excludeSpa = spaRuleApplies(sub.created_at);
    const beforeCount = ce.countRealBrands(prevBrands, { excludeSpa: excludeSpa });
    const afterCount = ce.countRealBrands(nextBrands, { excludeSpa: excludeSpa });
    if (afterCount < beforeCount) {
      // 왜 줄었는지까지 말해 준다. SPA 브랜드와 관용 표기는 애초에 세지 않으므로
      // "이름을 바꿨을 뿐인데 왜 줄었냐"는 문의가 바로 여기서 나온다.
      const uncounted = nextBrands
        .filter(function (row) { return isGenericCredit(row.name) || (excludeSpa && isSpaBrand(row.name)); })
        .map(function (row) { return row.name; });
      return res.status(400).json({
        message: '의상 브랜드 종류가 ' + beforeCount + '종에서 ' + afterCount + '종으로 줄어듭니다. 브랜드 종류 수는 줄일 수 없습니다.'
          + (uncounted.length ? ' 다음 항목은 브랜드로 세지 않습니다(SPA·빈티지·관용 표기): ' + uncounted.join(', ') : ''),
        reason: 'brand_count_decreased',
        beforeCount: beforeCount,
        afterCount: afterCount,
        uncounted: uncounted,
      });
    }

    // 10. 브랜드명 전면 교체는 허용한다 (스펙 0-2-b). 편집거리 가드를 넣지 말 것.

    // ── 저장 ────────────────────────────────────────────────────────────
    // 이미지 크레딧의 @토큰도 같이 고친다. 안 고치면 브랜드 목록만 바뀌고
    // 사진 밑 크레딧은 옛 이름으로 남는다.
    const remap = ce.remapImageCredits(prevFashion.imageCredits, prevBrands, nextBrands);
    const nextFashion = Object.assign({}, prevFashion, {
      brands: nextBrands,
      imageCredits: remap.imageCredits,
    });

    const now = new Date();
    const historyEntry = {
      at: now.toISOString(),
      by: user.id,
      by_email: (profile && profile.email) || null,
      source: 'member',
      before: { credits: prevCredits, fashion: { brands: prevBrands, imageCredits: prevFashion.imageCredits || null } },
      after: { credits: nextCredits, fashion: { brands: nextBrands, imageCredits: remap.imageCredits || null } },
    };
    const prevHistory = Array.isArray(ed.credits_history) ? ed.credits_history : [];

    const { data: upRows, error: upErr } = await supabaseAdmin
      .from('editorials')
      .update({
        credits: nextCredits,
        fashion: nextFashion,
        credits_history: prevHistory.concat([historyEntry]),
        credits_edit_count: used + 1,
        updated_at: now.toISOString(),
        updated_by: user.id,
      })
      .eq('id', ed.id)
      // 동시 요청으로 4회차가 통과하지 않게 카운터를 조건에 건다.
      .eq('credits_edit_count', used)
      .select('id');
    if (upErr) throw upErr;
    // 조건이 안 맞아 0행이 바뀌었으면 그 사이 다른 요청이 먼저 저장한 것이다.
    // 여기서 200 을 주면 저장되지 않은 수정을 저장됐다고 알리게 된다.
    if (!Array.isArray(upRows) || upRows.length !== 1) {
      return res.status(409).json({
        message: '다른 요청이 먼저 저장했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
        reason: 'concurrent_edit',
      });
    }

    // 감사 로그(관리자 화면의 "수정 이력"). 실패해도 저장을 되돌리지 않는다.
    await recordContentChange({
      content_type: 'editorial',
      content_id: ed.id,
      action: 'update',
      actor: { id: user.id, email: (profile && profile.email) || null },
      summary: '회원 크레딧 수정 ' + (used + 1) + '/' + ce.MAX_CREDIT_EDITS + '회차',
      diff: {
        credits: { before: prevCredits, after: nextCredits },
        brands: { before: prevBrands, after: nextBrands },
      },
    });

    // 텔레그램 알림. await 한다 — fire-and-forget 은 서버리스에서 유실된다.
    const suspicion = ce.suspicionFlags({
      before: prevBrands,
      after: nextBrands,
      paymentStatus: pay,
      excludeSpa: excludeSpa,
    });
    const alert = ce.buildEditAlert({
      title: ed.title,
      userName: (profile && profile.display_name) || null,
      userEmail: (profile && profile.email) || null,
      at: now,
      editIndex: used + 1,
      paymentStatus: pay,
      beforeBrands: prevBrands,
      afterBrands: nextBrands,
      beforeBrandCount: beforeCount,
      afterBrandCount: afterCount,
      beforeCredits: prevCredits,
      afterCredits: nextCredits,
      suspicion: suspicion,
      link: FRONTEND_URL + '/editorial/' + encodeURIComponent(ed.slug || ed.id),
    });
    await sendTextToTelegramSafe(alert);

    // 이 응답은 절대 캐시하지 않는다. 상세 엔드포인트도 캐시가 없으므로
    // 화면은 다음 조회에서 바로 새 크레딧을 읽는다(스펙 2절, 방향 1).
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      ok: true,
      credits: nextCredits,
      brands: nextBrands,
      imageCreditsRemapped: remap.remapped,
      editsUsed: used + 1,
      editsLeft: Math.max(0, ce.MAX_CREDIT_EDITS - (used + 1)),
      maxEdits: ce.MAX_CREDIT_EDITS,
      brandCount: { before: beforeCount, after: afterCount },
      flagged: suspicion.flagged,
    });
  } catch (e) {
    console.error('[editorials/credits]', (e && e.message) || e);
    return res.status(500).json({ message: 'Failed to update credits' });
  }
};
