/**
 * POST /api/subscriptions/payment-help — "결제가 안 돼요" 를 받는 비상구
 *
 * ■ 왜 (실측 2026-11-23)
 * 세르비아 회원 Aleksandar Mladjenović 이 Standard 를 사려다 PayPal **계정 생성**의
 * 전화번호 인증에서 막혀 메일을 보내 왔다. 번호와 기기를 바꿔 가며 시도했지만
 * "다른 번호를 쓰세요" 가 반복됐다. 우리 구독은 vault=true&intent=subscription 이라
 * PayPal 이 결제수단을 보관해야 하고, 그러려면 PayPal 계정이 반드시 있어야 한다.
 * 그 계정 생성은 나라·통신사에 따라 벽이 된다 — 우리가 고칠 수 있는 벽이 아니다.
 *
 * ■ 진짜 문제는 그가 '메일을 쓴 한 명' 이라는 것
 * 국가별 실측(profiles):
 *   이탈리아 293명 / 유료 10   미국 168 / 5   한국 154 / 5   영국 144 / 4
 *   일본 66 / **0**   홍콩 31 / 0   멕시코 30 / 0   브라질 28 / 0
 *   싱가포르 25 / 0   인도네시아 24 / 0   인도 23 / 0   중국 15 / 0
 * 일본 66명 중 유료가 0명인 것이 우연일 수는 없다(일본은 PayPal 보급률이 낮고,
 * 인도는 2021년에 PayPal 이 국내결제를 접었다). 결제가 막히면 우리 DB 에는 아무
 * 기록도 남지 않는다 — "시도했다가 못 했다" 는 존재하지 않는 행이다.
 *
 * 그래서 이 엔드포인트가 하는 일은 결제를 고치는 게 아니다. **막혔다는 사실을
 * 보이게 만드는 것**이다. 고치는 건(결제사 하나 더) 돈과 계약이 걸린 사람 판단이고,
 * 그 판단을 하려면 먼저 숫자가 있어야 한다.
 *
 * ■ 저장하지 않는다
 * 텔레그램으로 보내고 끝낸다. 표를 만들지 않은 이유는 두 가지다 — 방문자가 타이핑한
 * 것을 새로 쌓기 시작하면 처리방침이 따라오고, 도메니코는 실제로 텔레그램을 보고
 * 움직인다. 대신 전송이 **실패하면 그 사실을 응답에 담는다**(code: 'relay_failed').
 * 조용히 삼키면 비상구가 비상구가 아니게 된다 — 이 엔드포인트가 막으려는 실패가
 * 바로 '아무도 모르게 사라지는 것' 이다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { verifyToken } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const PLANS = new Set(['standard_monthly', 'standard_yearly', 'premium_monthly', 'premium_yearly']);

/** 사람이 적은 값은 길이를 자르고 줄바꿈을 없앤다 — 알림 한 줄을 지키기 위해서다. */
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.auth)) return;   // 분당 10회 — 알림 폭주 방지

  const body = (req && req.body) || {};
  const plan = PLANS.has(String(body.plan || '')) ? String(body.plan) : '';
  const note = clean(body.note, 300);

  /* 로그인 상태에서만 열리는 결제창의 버튼이라 보통 토큰이 있다. 없더라도 거절하지
     않는다 — 여기까지 온 사람은 이미 한 번 막힌 사람이고, 한 번 더 막을 이유가 없다. */
  let user = null;
  try { user = verifyToken(req); } catch (_) { user = null; }

  let email = clean(user && user.email, 160);
  let name = '';
  let country = '';
  if (user && user.id) {
    try {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('email, name, country')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        email = clean(data.email || email, 160);
        name = clean(data.name, 80);
        country = clean(data.country, 8);
      }
    } catch (_) { /* 프로필 조회 실패가 알림을 막을 이유는 없다 */ }
  }
  if (!email) email = clean(body.email, 160);
  if (!email || email.indexOf('@') < 1) {
    return res.status(400).json({ message: 'email required', code: 'no_email' });
  }

  const line = '💳 결제가 막혔다는 신고\n'
    + '회원: ' + (name || '(이름 없음)') + ' <' + email + '>'
    + (country ? ' · ' + country : '') + '\n'
    + '플랜: ' + (plan || '(미선택)') + '\n'
    + (note ? '남긴 말: ' + note + '\n' : '')
    + '\nPayPal 구독은 PayPal 계정이 있어야 한다. 계정을 못 만드는 나라·번호가 있다.\n'
    + '→ 비즈니스 계정에서 PayPal 청구서를 보내면 계정 없이 카드로 낼 수 있다.\n'
    + '→ 입금 확인 후 어드민 → 회원에서 등급을 직접 올려 준다.';

  const sent = await sendTextToTelegramSafe(line);
  if (!sent || sent.ok !== true) {
    console.error('[payment-help] 텔레그램 전달 실패:', sent && sent.error, '| 회원:', email);
    /* 삼키지 않는다. 화면이 "contact@ 로 메일 주세요" 를 띄우게 한다. */
    return res.status(502).json({ message: 'Could not relay', code: 'relay_failed' });
  }
  return res.status(200).json({ ok: true });
};
