/**
 * GET /api/subscriptions/paypal-claim-check?subscription_id=I-XXXXXXXX
 *
 * 결제는 끝났는데 **내 등급이 안 올라갔을 때**, 그 이유를 회원에게 알려주기 위한 조회.
 *
 * ■ 왜 생겼나 (2026-11-08 실측)
 * 한 회원이 37분 동안 구독을 **4번** 만들었다
 * (I-5VLWTJT34R2Y → I-S0TPMR24S6S5 → I-DSC3N4YUXACT → I-V4XUBEFLLY93).
 * 사기도 버그도 아니었다. 그 회원은 PAP 계정이 두 개였고, 로그인한 계정과
 * **PayPal 계정의 이메일이 달랐다.** 웹훅(resolveUserId)은 브라우저가 심는
 * custom_id 를 일부러 믿지 않고 결제자 이메일 쪽 계정을 택한다(위조 방지).
 * 그래서 결제는 매번 **다른 계정**에 붙었고, 그가 보고 있던 화면은 계속 무료였다.
 *
 * 더 나빴던 건 화면이 **아무 말도 안 했다**는 점이다. pap-api.js 의
 * _waitUpgradeThenGo 는 1.5초×8번(12초)만 기다린 뒤 **성공이든 실패든 똑같이**
 * /mypage 로 보냈다. 결제한 사람 입장에서는 "돈은 나갔는데 아무 일도 안 일어남"
 * 이다. 그러니 다시 시도한다. 네 번.
 *
 * ■ 이 엔드포인트가 하는 일
 * 구독 id 하나를 받아 **세 가지 중 하나**만 돌려준다.
 *   ok            — 그 구독이 지금 로그인한 계정에 붙어 있다 (정상)
 *   other_account — 다른 PAP 계정에 붙었다 (= 위의 이메일 불일치 상황)
 *   pending       — 아직 웹훅이 도착하지 않았다 (조금 더 기다리면 된다)
 *
 * ■ 일부러 하지 않는 것
 * **어느 계정에 붙었는지는 알려주지 않는다.** 이메일도, 계정 id 도, 마스킹한
 * 형태조차 돌려주지 않는다. 구독 id 는 브라우저가 쥐고 있는 값이라 이 호출만으로는
 * '이 사람이 그 결제의 주인' 임을 증명하지 못한다. 그 상태에서 남의 계정 이메일을
 * 흘리면 열거 공격의 창구가 된다. 상태 한 단어면 회원이 할 일(다른 이메일로 로그인,
 * 또는 문의)은 충분히 정해진다 — 그 이상은 사람이 처리한다.
 *
 * PayPal API 를 부르지 않는다. 우리 subscriptions 표만 읽으면 되는 질문이고,
 * 결제창 뒤에서 도는 호출이라 외부 왕복을 더할 이유가 없다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

/** PayPal 구독 id 형식만 통과시킨다 (I- 로 시작하는 영숫자). */
function validSubId(v) {
  return /^I-[A-Z0-9]{8,32}$/i.test(String(v || '').trim());
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ message: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const subId = String((req.query && req.query.subscription_id) || '').trim();
  if (!validSubId(subId)) {
    return res.status(400).json({ message: 'subscription_id is required', code: 'SUB_ID_INVALID' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, status, plan')
      .or(`paypal_subscription_id.eq.${subId},pending_paypal_subscription_id.eq.${subId}`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!data) return res.status(200).json({ status: 'pending' });
    if (data.user_id === user.id) {
      return res.status(200).json({ status: 'ok', plan: data.plan || null });
    }
    /* 다른 계정에 붙었다. 어느 계정인지는 돌려주지 않는다 (위 주석). */
    return res.status(200).json({ status: 'other_account' });
  } catch (err) {
    console.error('[paypal-claim-check] 조회 실패:', err && err.message);
    return res.status(500).json({ message: 'Could not check this subscription. Please contact contact@pap-magazine.com', code: 'claim_check_failed' });
  }
};
