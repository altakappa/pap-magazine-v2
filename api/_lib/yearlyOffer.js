'use strict';
/**
 * 월간 프리미엄 2개월째 → 연간 제안 메일, 한 번만 (2026-10-01, 도메니코 "나머지는 추가할까?").
 *
 * 왜: 연간 0건. 사는 사람은 전원 크리에이터이고 월간은 "화보 1편용 1회 구매"로 끝난다(9/24).
 *     첫 갱신에 성공한 사람 = 둘째 달에도 돈을 낸 사람 = 연간 제안이 가장 잘 먹힐 사람.
 * 언제: PAYMENT.SALE.COMPLETED 가 월간 플랜의 2번째 이상 결제일 때. 1번째(가입 결제)는 아님.
 * 한 번만: subscriptions.yearly_offer_sent_at 이 비어 있을 때만 먼저 찍고 보낸다.
 * 정직: "지금 바꾸면 남은 날이 사라진다"를 숨기지 않는다. 다음 결제일 직전에 바꾸라고 쓴다.
 */
const SITE = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

function isMonthlyPlan(plan) { return /_monthly$/i.test(String(plan || '')); }

/** PayPal billing_info.cycle_executions 에서 REGULAR 주기의 실행 횟수 */
function regularCycles(sub) {
  const ce = (sub && sub.billing_info && sub.billing_info.cycle_executions) || [];
  let n = 0;
  for (const c of ce) if (String(c.tenure_type || '').toUpperCase() === 'REGULAR') n += Number(c.cycles_completed || 0);
  return n;
}

function offerUrl(lang) {
  const pre = !lang || lang === 'ko' ? '' : '/' + lang;
  return SITE + pre + '/subscribe?billing=yearly&utm_source=renewal_mail&utm_medium=email&utm_campaign=yearly_offer';
}

async function maybeSendYearlyOffer(sub, row, deps) {
  const { db, sendEmail, templates, resolveEmailLang } = deps;
  try {
    if (!row || !row.user_id || !row.paypal_subscription_id) return { skipped: 'no_row' };
    if (!isMonthlyPlan(row.plan)) return { skipped: 'not_monthly' };
    if (regularCycles(sub) < 2) return { skipped: 'first_payment' };
    if (row.yearly_offer_sent_at) return { skipped: 'already_sent' };
    const stamp = new Date().toISOString();
    const { data: claimed, error: cErr } = await db.from('subscriptions')
      .update({ yearly_offer_sent_at: stamp }).eq('user_id', row.user_id).is('yearly_offer_sent_at', null).select('user_id');
    if (cErr) throw cErr;
    if (!claimed || !claimed.length) return { skipped: 'already_sent' };
    const { data: p } = await db.from('profiles')
      .select('email, display_name, name, language, email_language, country').eq('id', row.user_id).maybeSingle();
    if (!p || !p.email) return { skipped: 'no_email' };
    const lang = resolveEmailLang(p);
    const next = (sub && sub.billing_info && sub.billing_info.next_billing_time) || row.current_period_end || '';
    const tpl = templates.yearlyOffer({ name: p.display_name || p.name || '' }, { url: offerUrl(lang), date: String(next).slice(0, 10) }, lang);
    const r = await sendEmail(p.email, tpl);
    if (!(r && r.sent)) {
      await db.from('subscriptions').update({ yearly_offer_sent_at: null }).eq('user_id', row.user_id).eq('yearly_offer_sent_at', stamp);
      return { sent: false, error: r && r.error };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[yearlyOffer] 연간 제안 메일 실패 (갱신 처리는 그대로):', (e && e.message) || e);
    return { sent: false, error: (e && e.message) || String(e) };
  }
}

module.exports = { maybeSendYearlyOffer, isMonthlyPlan, regularCycles, offerUrl };
