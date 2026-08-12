/**
 * 2026-08-12 — Paddle(MoR) 폐쇄로 바뀐 "법적 사실" 이 문구에 반영됐는지 고정한다.
 *
 * ■ 무엇이 바뀌었나
 *   Paddle 은 MoR(판매자 대행)이었다. 세금 계산·징수·인보이스 발행·EU 소비자
 *   대응을 Paddle 이 대신 했다. 그래서 우리 사이트는 세금 이야기를 한 마디도
 *   안 해도 굴러갔다. **PayPal 은 MoR 이 아니다.** 그 책임이 전부 주식회사
 *   알타카파에게 넘어왔다.
 *
 *   8/14 에 Paddle 계정이 닫히면, 아직 "Paddle 이 결제·환불 주체" 라고 적힌
 *   문장은 존재하지 않는 회사를 가리키는 허위 표시가 된다.
 *
 * ■ 코드와 약속이 어긋나던 것도 같이 잡는다
 *   · terms.html 은 "즉시 탈퇴" 라고 했지만 실제는 예약 탈퇴다
 *   · refund.html 은 연간 중도 환불을 약속하지만 코드에 자동 환불 경로가 없다
 *     (api/subscriptions/paypal-portal.js 는 cancel 만 부른다)
 *   · it/de 푸터가 한국 사업자등록번호를 P. IVA / Handelsregister 로 표기했다
 *   · 해지 버튼이 10px · 흰색 32% 였다 (독일 § 312k "gut lesbar" 미달)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

console.log('=== 고객 눈에 Paddle 이 남아 있지 않다 ===');
{
  // 8/14 이후 존재하지 않는 회사를 결제·환불 주체로 적어 두면 허위 표시다.
  // 주석·죽은 SDK 태그는 별개 문제라 여기서는 "정책 문서" 만 본다.
  for (const f of ['frontend/refund.html', 'frontend/terms.html', 'frontend/privacy.html', 'frontend/data-deletion.html']) {
    let src = '';
    try { src = read(f); } catch (_) { continue; }
    const hits = src.split('\n')
      .map((l, i) => ({ l, i: i + 1 }))
      .filter((x) => /Paddle/.test(x.l) && !/^\s*(\/\/|\/\*|\*|<!--)/.test(x.l));
    ok(f + ' 에 Paddle 언급이 없다', hits.length === 0,
      hits.map((h) => h.i + ': ' + h.l.trim().slice(0, 90)).join(' | '));
  }
}

console.log('=== 판매자와 세금을 누가 지는지 말한다 (MoR 이 사라진 자리) ===');
{
  const refund = read('frontend/refund.html');
  ok('환불정책에 판매자 조항이 있다', /판매자는 <strong>주식회사 알타카파<\/strong>/.test(refund));
  ok('  → PayPal 은 결제 수단일 뿐이라고 밝힌다', /PayPal 은 결제 수단일 뿐 판매자가 아닙니다/.test(refund));
  ok('  → 표시가가 세금 포함 최종가라고 말한다', /세금이 포함된 최종 결제 금액/.test(refund));
  ok('  → 영수증·세금계산서 안내가 있다', /세금계산서 등 별도 증빙/.test(refund));
  ok('  → 영문 요약에도 seller of record 가 있다', /seller of record/i.test(refund));

  const sub = read('frontend/subscribe.html');
  ok('결제 페이지 안내에도 판매자가 명시돼 있다', /paymentNote:'[^']*알타카파/.test(sub));
}

console.log('=== 약관이 실제 코드 동작과 같은 말을 한다 ===');
{
  const terms = read('frontend/terms.html');
  ok('"즉시 회원 탈퇴를 처리합니다" 가 사라졌다',
    !/회사는 즉시 회원 탈퇴를 처리합니다/.test(terms),
    '실제는 예약 탈퇴다 — 결제한 기간이 끝나는 날 삭제된다');
  ok('  → 예약 탈퇴를 설명한다', /이미 결제하신 이용 기간이 끝나는 날 계정과 개인정보가 삭제/.test(terms));
  ok('  → 즉시 삭제 선택지도 알려준다', /지금 즉시 삭제/.test(terms));

  // data-deletion.html 은 이미 고쳐져 있다 — 세 문서가 같은 말을 하는지 본다
  const dd = read('frontend/data-deletion.html');
  ok('탈퇴 안내 페이지와 약관이 같은 말을 한다',
    /이용 기간이 끝나는 날/.test(dd) && /이용 기간이 끝나는 날/.test(terms));
}

console.log('=== 해지 ≠ 환불 을 분명히 한다 ===');
{
  const refund = read('frontend/refund.html');
  ok('환불정책이 "해지만으로는 환불되지 않는다" 고 말한다',
    /구독 해지 버튼만 누르면 환불되지 않습니다/.test(refund),
    'refund.html 제4조는 연간 중도 환불을 약속하는데 코드에 자동 환불 경로가 없다');

  const mypage = read('frontend/mypage.html');
  const confirms = [];
  const re = /confirm:\s*(['"])((?:[^\\]|\\.)*?)\1/g;
  let m; while ((m = re.exec(mypage))) confirms.push(m[2]);
  const cancelConfirms = confirms.filter((c) => /해지|Cancel|kündigen|annullare|Résilier|Cancelar|解約|取消订阅|Отменить/i.test(c));
  ok('해지 확인창이 9개 언어 있다', cancelConfirms.length >= 9, '실제 ' + cancelConfirms.length + '개');
  const REFUND_NOTE = [/환불되지 않습니다/, /does not issue a refund/i, /keine Rückerstattung/,
    /non comporta un rimborso/, /ne déclenche pas de remboursement/, /no genera un reembolso/,
    /返金されません/, /并不退款/, /не означает возврат/];
  const missing = cancelConfirms.filter((c) => !REFUND_NOTE.some((r) => r.test(c)));
  ok('해지 확인창 전부에 "환불되지 않는다" 가 있다', missing.length === 0,
    '빠진 문구: ' + missing.map((c) => c.slice(0, 40)).join(' | '));
  ok('  → 전부 연락처를 준다', cancelConfirms.every((c) => c.indexOf('contact@pap-magazine.com') !== -1));
}

console.log('=== 사업자 정보 표기 (한국 번호를 EU 번호처럼 쓰지 않는다) ===');
{
  const i18n = read('frontend/pap-i18n.js');
  ok('이탈리아어 푸터가 P. IVA 를 쓰지 않는다', !/P\. IVA:\s*192-88-02644/.test(i18n),
    'P. IVA 는 이탈리아 부가세번호다. VIES 로 검증하면 없는 번호로 나온다');
  ok('독일어 푸터가 Handelsregister 를 쓰지 않는다', !/Handelsregister:\s*192-88-02644/.test(i18n));
  ok('  → 한국 등록번호임을 밝힌다',
    /Reg\. impresa \(Corea\)/.test(i18n) && /Unternehmensregister \(Südkorea\)/.test(i18n));
  const pl = read('frontend/pullletter.html');
  ok('풀레터 페이지 푸터도 같이 고쳤다', !/P\. IVA:\s*192-88-02644/.test(pl));
}

console.log('=== 해지 버튼이 눈에 띈다 (독일 § 312k BGB) ===');
{
  const mypage = read('frontend/mypage.html');
  const m = mypage.match(/b\.style\.cssText = '([^']*mpCancel[^']*|[^']*)';\s*\n\s*b\.textContent = _mpCancT\('btn'\)/);
  const style = m ? m[1] : '';
  ok('해지 버튼 스타일을 찾았다', !!style);
  const size = Number((style.match(/font-size:(\d+)px/) || [])[1] || 0);
  const alpha = Number((style.match(/color:rgba\(255,255,255,([\d.]+)\)/) || [])[1] || 0);
  ok('글자 크기가 12px 이상', size >= 12, '실제 ' + size + 'px — 10px 는 "gut lesbar" 가 아니다');
  ok('불투명도가 0.7 이상 (대비비 4.5:1 확보)', alpha >= 0.7, '실제 ' + alpha + ' — 0.32 는 약 2.7:1 이었다');
  ok('밑줄로 눌리는 것임을 알린다', /text-decoration:underline/.test(style));
  ok('독일어 라벨이 법문 표현이다', /de:\{btn:'Vertrag hier kündigen'/.test(mypage),
    '§ 312k 는 "Verträge hier kündigen" 에 준하는 명확한 표현을 요구한다');
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ policy-copy-paypal-era tests passed');
process.exit(0);
