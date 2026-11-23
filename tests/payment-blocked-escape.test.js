/**
 * 결제가 막힌 사람이 말할 곳이 있는가 (2026-11-23)
 * ─────────────────────────────────────────────────────────────────────
 * 사고 기록: 세르비아 회원(Aleksandar Mladjenović)이 Standard 를 사려다 PayPal
 * **계정 생성**의 전화번호 인증에서 막혔다. 번호와 기기를 바꿔도 "다른 번호를
 * 쓰세요" 가 반복됐다. 우리 구독은 vault=true&intent=subscription 이라 PayPal 이
 * 결제수단을 보관해야 하고, 그러려면 계정이 반드시 있어야 한다.
 *
 * 그가 예외가 아니라는 것이 핵심이다. 국가별 실측(profiles) — 일본 66명 중 유료 0명,
 * 브라질 28/0, 인도 23/0, 인도네시아 24/0, 멕시코 30/0, 홍콩 31/0, 싱가포르 25/0.
 * 결제가 막히면 우리 DB 에는 아무 기록도 남지 않는다. 그는 메일을 쓴 한 명이고
 * 나머지는 그냥 떠났다.
 *
 * 이 파일이 지키는 것
 *  ① 결제창 안에 '막혔다' 고 말할 길이 있다 (그가 보고 있는 화면이 거기다).
 *  ② 그 길이 9개 언어로 열려 있다 — 막히는 사람은 대개 한국어도 영어도 아니다.
 *  ③ 전달 실패를 삼키지 않는다. 조용히 삼키면 비상구가 비상구가 아니다.
 *  ④ 카드 결제 수단을 끄지 않는다.
 *  ⑤ 알림에 '다음에 뭘 하면 되는지' 가 적혀 있다 (청구서 → 수동 등급).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 220)); } };

const API = R('api/subscriptions/payment-help.js');
const FE = R('frontend/pap-api.js');

console.log('=== 1. 결제창 안에 말할 길이 있다 ===');
t('결제 오버레이에 비상구 링크가 있다', /pap-pp-stuck/.test(FE));
t('한 번 누르면 끝난다 (양식을 또 채우게 하지 않는다)',
  /payment-help'[\s\S]{0,80}plan: planKey/.test(FE),
  '여기까지 온 사람은 이미 한 번 막힌 사람이다');
t('고른 플랜을 같이 보낸다', /plan: planKey/.test(FE));
t('두 번 눌러도 두 번 보내지 않는다', /dataset\.sent === '1'/.test(FE));

console.log('\n=== 2. 9개 언어로 열려 있다 ===');
/* 막히는 사람은 대개 한국어도 영어도 아니다 — 일본·브라질·인도네시아가 그렇다. */
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
for (const k of ['stuck', 'stuckSent', 'stuckFail']) {
  const missing = LANGS.filter((l) => !(new RegExp('\\n    ' + l + ':\\{[\\s\\S]*?' + k + ":'")).test(FE));
  t(k + ' 가 9개 언어에 있다', missing.length === 0, '빠진 언어: ' + missing.join(','));
}

console.log('\n=== 3. 실패를 삼키지 않는다 ===');
t('텔레그램 전달 실패를 응답에 담는다', /relay_failed/.test(API),
  '삼키면 사람은 전달된 줄 알고 기다린다');
t('실패 시 2xx 를 주지 않는다', /status\(502\)/.test(API));
t('화면이 실패를 말하고 메일 주소를 준다',
  /stuckFail/.test(FE) && /contact@pap-magazine\.com/.test(FE));
t('서버 로그에도 누가 막혔는지 남는다', /console\.error\('\[payment-help\]/.test(API));

console.log('\n=== 4. 카드 수단을 끄지 않았다 ===');
t('enable-funding=card 가 켜져 있다', /enable-funding=card/.test(FE));
/* disable-funding 은 수단을 **없앤다**. 결제가 막히는 게 문제인 상황에서 들어오면 안 된다. */
t('disable-funding 을 쓰지 않는다', !/disable-funding/.test(FE));
t('정기결제 필수 조합은 그대로다', /vault=true&intent=subscription/.test(FE));

console.log('\n=== 5. 알림이 다음 행동까지 알려준다 ===');
/* 알림이 "막혔대요" 로 끝나면 받는 사람이 매번 처음부터 생각해야 한다. */
t('PayPal 청구서라는 우회로를 적는다', /청구서/.test(API));
t('입금 뒤 수동 등급까지 적는다', /어드민/.test(API) && /등급/.test(API));
t('회원 이메일·국가가 알림에 들어간다', /country/.test(API) && /email/.test(API));

console.log('\n=== 6. 남용·사고 방지 ===');
t('레이트리밋이 걸려 있다', /rateLimit\(req, res, RATE_LIMITS/.test(API));
t('POST 만 받는다', /method !== 'POST'/.test(API));
t('플랜 값은 화이트리스트로만 받는다', /PLANS\.has/.test(API));
t('사람이 적은 값은 길이를 자른다', /function clean/.test(API) && /slice\(0, max\)/.test(API));
/* 로그인하지 않았다고 거절하지 않는다 — 여기 온 사람을 한 번 더 막을 이유가 없다. */
t('토큰이 없어도 거절하지 않는다', /catch \(_\) \{ user = null; \}/.test(API));

console.log('\n=== 7. 캐시버스트 ===');
const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html'))
  .filter((f) => R('frontend/' + f).includes('pap-api.js?v='));
const vers = new Set(htmls.map((f) => (R('frontend/' + f).match(/pap-api\.js\?v=(\d+)/) || [])[1]));
t('pap-api 를 쓰는 HTML 이 전부 같은 버전이다 (v=' + [...vers].join('/') + ')',
  htmls.length >= 10 && vers.size === 1 && !vers.has(undefined),
  htmls.length + '개 / 버전 ' + [...vers].join(', '));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ payment-blocked-escape tests FAILED'); process.exit(1); }
console.log('✅ payment-blocked-escape tests passed');
