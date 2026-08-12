/**
 * 2026-08-12 — Paddle → PayPal 전환에서 실제로 돈이 샌 두 가지를 고정한다.
 *
 * [A] 접근권 종료일(current_period_end)은 절대 앞당겨지지 않는다.
 *     실제 사고: 8/10 11:01 UTC 에 사과 보상으로 유료 5명의 종료일을 손으로 1개월
 *     늘렸는데, 11:22~11:26 UTC 에 온 Paddle subscription.updated 웹훅이 그 값을
 *     결제사가 아는 원래 날짜로 되돌렸다. 4명이 되돌아갔고 1명만 살아남았다.
 *     메일로 이미 약속한 무료 1개월이 DB 에서 조용히 사라진 채 이틀이 지났다.
 *     결제사는 "우리가 청구한 기간"만 안다. 결제와 무관하게 늘린 접근권은
 *     결제사가 알 수 없으므로, 결제사 값으로 덮으면 손해는 항상 우리 쪽으로 온다.
 *
 * [B] 구독 금액은 EUR 한 통화다.
 *     PayPal 은 플랜당 통화가 하나뿐이라 국가별 현지가를 유지할 수 없다.
 *     어드민 매출 계산만 원화 가격표(8500/13500)로 남아 있었고 환산 코드도 없어서,
 *     화면의 "₩8,500" 은 어떤 환율로도 맞을 수 없는 숫자였다.
 *     8/14 에 Paddle 대시보드가 닫히면 어드민이 유일한 장부다.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
}

// ── [A] 종료일 축소 금지 ────────────────────────────────────────────────
{
  const src = read('api/paddle-webhook.js');

  ok('[A1] upsert 가 웹훅 값을 그대로 쓰지 않는다',
    !/current_period_end:\s*period\.ends_at/.test(src),
    'period.ends_at 를 그대로 넣으면 손으로 늘린 종료일이 웹훅 한 번에 되돌아간다');

  ok('[A2] upsert 전에 기존 종료일을 읽는다',
    /select\(\s*'current_period_end'\s*\)/.test(src),
    "supabaseAdmin.from('subscriptions').select('current_period_end') 가 없다");

  ok('[A3] 더 나중 날짜가 이긴다',
    /getTime\(\)\s*>\s*new Date\(incomingEnd\)\.getTime\(\)/.test(src),
    '기존값 > 웹훅값 비교가 없다');

  ok('[A4] 결정된 값을 upsert 에 넣는다',
    /current_period_end:\s*nextEnd/.test(src),
    'nextEnd 가 upsert 에 반영되지 않았다');

  // 가드 로직만 떼어내 실제로 계산해 본다 (소스 정규식만으로는 방향이 뒤집혀도 통과한다).
  function guard(prevEnd, incomingEnd) {
    let nextEnd = incomingEnd;
    if (prevEnd && (!incomingEnd || new Date(prevEnd).getTime() > new Date(incomingEnd).getTime())) {
      nextEnd = prevEnd;
    }
    return nextEnd;
  }
  ok('[A5] 보상으로 늘린 10/07 을 웹훅의 09/07 이 되돌리지 못한다',
    guard('2026-10-07T16:44:00Z', '2026-09-07T16:44:00Z') === '2026-10-07T16:44:00Z');
  ok('[A6] 정상 갱신(뒤로 미는 값)은 그대로 반영된다',
    guard('2026-09-07T16:44:00Z', '2026-10-07T16:44:00Z') === '2026-10-07T16:44:00Z');
  ok('[A7] 웹훅이 종료일을 안 주면 기존 값을 지킨다 (null 로 밀면 만료 스윕이 영영 못 잡는다)',
    guard('2026-10-07T16:44:00Z', null) === '2026-10-07T16:44:00Z');
  ok('[A8] 신규 구독(기존 값 없음)은 웹훅 값을 쓴다',
    guard(null, '2026-09-07T16:44:00Z') === '2026-09-07T16:44:00Z');
}

// ── [B] EUR 단일 통화 ───────────────────────────────────────────────────
const EXPECTED_CENTS = {
  standard_monthly: 549,
  standard_yearly: 4599,
  premium_monthly: 899,
  premium_yearly: 7499,
};

{
  // 진실의 근원: 고객이 실제로 보는 결제 페이지
  const sub = read('frontend/subscribe.html');
  const m = sub.match(/EUR_PRICES\s*=\s*\{[^}]*\}/);
  ok('[B0] subscribe.html 에 EUR_PRICES 가 있다', !!m);
  if (m) {
    const blob = m[0];
    const num = (k) => {
      const mm = blob.match(new RegExp(k + '\\s*:\\s*([0-9.]+)'));
      return mm ? Math.round(parseFloat(mm[1]) * 100) : null;
    };
    ok('[B1] 어드민 가격표가 결제 페이지와 같다 (std 월)', num('std_m') === EXPECTED_CENTS.standard_monthly, 'subscribe.html std_m=' + num('std_m'));
    ok('[B2] 어드민 가격표가 결제 페이지와 같다 (prem 월)', num('prem_m') === EXPECTED_CENTS.premium_monthly, 'subscribe.html prem_m=' + num('prem_m'));
    ok('[B3] 어드민 가격표가 결제 페이지와 같다 (std 연)', num('std_y') === EXPECTED_CENTS.standard_yearly, 'subscribe.html std_y=' + num('std_y'));
    ok('[B4] 어드민 가격표가 결제 페이지와 같다 (prem 연)', num('prem_y') === EXPECTED_CENTS.premium_yearly, 'subscribe.html prem_y=' + num('prem_y'));
  }
}

for (const f of ['api/admin/stats.js', 'api/admin/subscriptions.js']) {
  const src = read(f);
  for (const [k, cents] of Object.entries(EXPECTED_CENTS)) {
    const mm = src.match(new RegExp(k + '\\s*:\\s*(\\d+)'));
    ok('[B] ' + f + ' 의 ' + k + ' = ' + cents + ' (EUR 센트)',
      !!mm && Number(mm[1]) === cents,
      mm ? ('실제 ' + mm[1] + ' — 원화 가격표가 남아 있으면 매출 숫자가 통째로 틀린다') : '값을 찾지 못했다');
  }
  ok('[B] ' + f + ' 는 통화를 EUR 로 밝힌다', /PLAN_PRICE_CURRENCY\s*=\s*'EUR'/.test(src));
}

// 어드민 화면이 그 숫자에 ₩ 를 붙이지 않는다
{
  const js = read('frontend/pap-admin.js');
  const html = read('frontend/admin.html');
  ok('[B] pap-admin.js 에 원화 포맷 함수가 없다',
    !/function\s+fmtKRW/.test(js) && !/function\s+_subFmtKRW/.test(js),
    'fmtKRW / _subFmtKRW 가 남아 있다');
  ok('[B] pap-admin.js 가 EUR 포맷을 쓴다',
    /function\s+fmtEUR/.test(js) && /function\s+_subFmtEUR/.test(js));
  ok('[B] admin.html 의 매출 초기값이 ₩0 이 아니다 ("모름"과 "0원"은 다르다)',
    !/id="dashRevenue">₩0</.test(html));
}

// 고객이 보는 곳에 옛 통화·옛 가격이 남아 있지 않다
{
  const files = ['frontend/pap-faq-i18n.js', 'frontend/pullletter.html', 'frontend/about.html', 'frontend/subscribe.html'];
  const BAD = [
    ['$5.99', /\$5[.,]99/], ['$9.49', /\$9[.,]49/], ['$79.99', /\$79[.,]99/],
    ['¥1,400', /¥1,400/], ['¥11,800', /¥11,800/], ['¥65.9', /¥65[.,]9/],
    ['₩8,500', /₩\s?8,500/], ['₩13,500', /₩\s?13,500/],
  ];
  for (const f of files) {
    const src = read(f);
    for (const [label, re] of BAD) {
      ok('[B] ' + f + ' 에 옛 가격 ' + label + ' 이 없다', !re.test(src));
    }
  }
}

// 지원하지 않는 결제수단을 광고하지 않는다
{
  const src = read('frontend/subscribe.html');
  ok('[B] 결제수단 로고에 KAKAO PAY 가 없다 (PayPal 로는 결제 불가)', !/payment-logo">KAKAO PAY</.test(src));
  ok('[B] 결제수단 로고에 NAVER PAY 가 없다', !/payment-logo">NAVER PAY</.test(src));
  ok('[B] 결제수단 안내에 PayPal 이 명시돼 있다', /paymentNote:'[^']*PayPal/.test(src));
}

if (fails.length) {
  console.error('\n❌ 실패 ' + fails.length + '건 (통과 ' + pass + '건)');
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('✅ EUR 단일통화 + 접근권 종료일 축소 금지 — ' + pass + '개 통과');
process.exit(0);
