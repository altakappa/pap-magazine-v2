/**
 * POST /api/brand-inquiry — 광고/제휴 문의 리드 캡처 (business 페이지 폼)
 *
 * 근거: 2026-07-18 광고문의 저조 진단 — mailto 마찰·리드 미캡처 해소.
 *  1) brand_inquiries 테이블에 저장(마이그레이션 086, service_role → RLS 우회)
 *  2) contact@pap-magazine.com 로 구조화 알림메일(예산·시기 포함 → 리드 선별)
 *
 * 봇 방어: honeypot 필드 `website`(사람에겐 숨김) 채워지면 조용히 200.
 * 이메일 실패는 흐름을 끊지 않음(best-effort). 저장 실패만 500.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { sendEmail } = require('./_lib/email');
const { rateLimitStrict, RATE_LIMITS } = require('./_lib/rateLimit');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  /* 2026-09-04 보안감사 — 레이트리밋이 없었다. 방어는 honeypot 하나였고, 요청마다
     brand_inquiries INSERT + contact@ 로 메일 발송이라 스팸·메일 쿼터 소진 벡터였다.
     login 과 같은 DB 기반 리밋(10/분)을 건다. */
  if (await rateLimitStrict(req, res, RATE_LIMITS.auth, 'brand-inquiry')) return;

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};

  // honeypot — 봇이 채우면 성공한 척 하고 무시
  if (b.website) return res.status(200).json({ ok: true });

  const email = String(b.email || '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: '유효한 이메일이 필요합니다.' });
  }
  const brand = String(b.brand_name || '').trim().slice(0, 200);
  const contact = String(b.contact_name || '').trim().slice(0, 120);
  const phone = String(b.phone || '').trim().slice(0, 60);
  const itype = String(b.inquiry_type || '').trim().slice(0, 80);
  const budget = String(b.budget_range || '').trim().slice(0, 80);
  const timing = String(b.timing || '').trim().slice(0, 80);
  const message = String(b.message || '').trim().slice(0, 4000);
  const locale = String(b.locale || '').trim().slice(0, 10);
  /* 유입 출처 (2026-07-29). 브랜드 허브(/brand/:id)의 문의 버튼이 여기로 오면서
   * "어느 브랜드 페이지가 이 리드를 만들었나"가 처음으로 관측 가능해졌다.
   * 그게 곧 다음에 어느 브랜드를 화보에 넣을지의 근거다.
   * 클라이언트 값이므로 화이트리스트 문자로 정규화만 하고 그대로 믿지 않는다. */
  const source = String(b.source || '').trim().toLowerCase()
    .replace(/[^a-z0-9_:.-]/g, '').slice(0, 60) || 'business_page';
  if (!brand && !message) {
    return res.status(400).json({ error: '브랜드명 또는 문의 내용을 입력해주세요.' });
  }

  let saved = false;
  try {
    const { error } = await supabaseAdmin.from('brand_inquiries').insert({
      brand_name: brand, contact_name: contact, email, phone,
      inquiry_type: itype, budget_range: budget, timing, message,
      locale, source, status: 'new',
    });
    if (error) throw error;
    saved = true;
  } catch (e) {
    console.error('[brand-inquiry] insert fail:', e && e.message);
  }

  // 알림 메일 (best-effort) — 회신 주소를 본문 상단에 명시
  try {
    const html =
      '<h2 style="margin:0 0 12px">🆕 새 광고/제휴 문의</h2>' +
      '<p style="margin:0 0 14px"><b>회신:</b> <a href="mailto:' + esc(email) + '">' + esc(email) + '</a></p>' +
      '<table cellpadding="6" style="border-collapse:collapse;font-size:14px">' +
      '<tr><td><b>브랜드/회사</b></td><td>' + (esc(brand) || '-') + '</td></tr>' +
      '<tr><td><b>담당자</b></td><td>' + (esc(contact) || '-') + '</td></tr>' +
      '<tr><td><b>이메일</b></td><td>' + esc(email) + '</td></tr>' +
      '<tr><td><b>연락처</b></td><td>' + (esc(phone) || '-') + '</td></tr>' +
      '<tr><td><b>문의 유형</b></td><td>' + (esc(itype) || '-') + '</td></tr>' +
      '<tr><td><b>예산 규모</b></td><td>' + (esc(budget) || '-') + '</td></tr>' +
      '<tr><td><b>집행 시기</b></td><td>' + (esc(timing) || '-') + '</td></tr>' +
      '<tr><td valign="top"><b>문의 내용</b></td><td>' + (esc(message).replace(/\n/g, '<br>') || '-') + '</td></tr>' +
      '</table>' +
      '<p style="color:#888;font-size:12px;margin-top:14px">source: ' + esc(source) + ' · locale: ' + esc(locale || '-') + ' · saved: ' + saved + '</p>';
    await sendEmail('contact@pap-magazine.com', {
      // 제목에 출처를 넣는다 — 브랜드 페이지發 리드는 이미 우리를 아는 쪽이라
      // 회신 우선순위가 다르다.
      subject: '[PAP] 광고 문의 — ' + (brand || contact || email) +
        (source !== 'business_page' ? ' (' + source + ')' : ''),
      html,
    });
  } catch (e) {
    console.error('[brand-inquiry] email fail:', e && e.message);
  }

  if (!saved) {
    return res.status(500).json({ error: '저장 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 contact@pap-magazine.com 으로 보내주세요.' });
  }
  return res.status(200).json({ ok: true });
};
