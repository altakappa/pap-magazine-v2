'use strict';
/**
 * 연간가 = 월간 × 10 (2개월 무료) · 연간 프리미엄 혜택 설명 누락 메우기 (도메니코 2026-09-24)
 *   "연간구독자의 할인율이 왜 이렇게 크게 설정된 거야?" → 근거 없는 약 30%(€45.99/€74.99)였다. 원화 시절엔 정확히 2개월 무료였다.
 *   "2개월 무료로 고치고 페이팔 플랜을 새로 짜자" · "(연간 프리미엄 혜택 설명 누락) 전부 알맞게 수정해줘"
 *
 *  1. 결제 페이지 EUR_PRICES: 연간 = 월간 × 10, 뱃지 '2개월 무료' 와 산수가 맞는다
 *  2. 고객이 보는 곳 어디에도 옛 연간가(€45.99 · €74.99)가 없다 (푸터·사전·FAQ·풀레터·소개)
 *  3. 어드민 매출 단가(센트)도 같은 값
 *  4. FAQ: 스탠다드 범위 '최근 3개 분기'(옛 6개월 아님) + 연간 프리미엄 혜택 — 8개 언어 + about JSON-LD
 *  5. 승인 메일 업셀: upB4 = 프리미엄 공통, upB5 = 연간 전용(€380 면제 · 공동작업자 5명) 9개 언어, 목록에 렌더
 *  6. /submissions: 연간 프리미엄 €380 면제 (본문 · FAQ · JSON-LD)
 *  7. €380 결제 승인 창: 연간이 아닌 사람에게만 "연간이면 이번 건 면제" (창을 실제로 띄워 본다)
 *  8. 마이페이지 멤버십 카드: 연간 혜택 줄 9개 언어, 프리미엄이면 fee-waiver.yearlyPremium 으로 켠다
 *  9. 가입 화면(auth.html): 없는 혜택(비하인드·1:1 피드백·이벤트 초대, 스탠다드의 Pull Letter·우선 리뷰)을 더 이상 적지 않는다
 * 10. 구독 페이지 연간 혜택 상자 (2026-09-25 "연간 혜택이 눈에 띄게"): 토글 바로 아래 금색 상자 + 프리미엄 카드 맨 위 두 줄
 * 11. 구독 페이지 언어 블록이 영어 복사본으로 남지 않는다 (2026-09-25 발견: 독일어 38줄이 영어, 프랑스어 월간/연간 라벨 없음)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

console.log('=== 1. 결제 페이지 가격 ===');
{
  const sub = R('frontend/subscribe.html');
  const m = sub.match(/var EUR_PRICES = \{ symbol:'€', std_m:([\d.]+), prem_m:([\d.]+), std_y:([\d.]+), prem_y:([\d.]+) \};/);
  t('EUR_PRICES 를 읽는다', !!m);
  if (m) {
    const [sm, pm, sy, py] = m.slice(1).map(Number);
    t('스탠다드 연간 = 월간 × 10 (€54.90)', Math.round(sm * 10 * 100) === Math.round(sy * 100) && sy === 54.9, sy);
    t('프리미엄 연간 = 월간 × 10 (€89.90)', Math.round(pm * 10 * 100) === Math.round(py * 100) && py === 89.9, py);
  }
  t("뱃지는 '2개월 무료' 그대로 (이제 산수가 맞는다)", /data-i18n="save2mo">2개월 무료</.test(sub) && /save2mo:'2 MONTHS FREE'/.test(sub));
}

console.log('\n=== 2. 옛 연간가가 고객 화면에 없다 ===');
{
  const OLD = /€\s?45[.,]99|€\s?74[.,]99|45[.,]99\s?€|74[.,]99\s?€/;
  const files = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => /\.(html|js)$/.test(f)).map((f) => 'frontend/' + f)
    .concat(fs.readdirSync(path.join(ROOT, 'frontend/i18n/ui')).map((f) => 'frontend/i18n/ui/' + f))
    .concat(['api/_lib/email.js', 'api/_lib/seoRenderer.js']);
  const bad = files.filter((f) => OLD.test(R(f)));
  t('frontend 전체 · 사전 · 메일 · SSR 에 €45.99/€74.99 없음', bad.length === 0, bad.join(', '));
  const i18n = R('frontend/pap-i18n.js');
  const footers = i18n.match(/footerLegal:\s*'[^']*'/g) || [];
  const priced = footers.filter((f) => /€5[.,]49/.test(f));
  t('가격을 적은 푸터는 전부 새 연간가', priced.length > 0 && priced.every((f) => /€54[.,]90/.test(f) && /€89[.,]90/.test(f)), priced.length);
  const pl = R('frontend/pullletter.html');
  t('풀레터 게이트 9개 언어: 연간 €89.90', (pl.match(/gateTier:'[^']*€89[.,]90/g) || []).length === 9);
}

console.log('\n=== 3. 어드민 매출 단가 ===');
for (const f of ['api/admin/stats.js', 'api/admin/subscriptions.js']) {
  const s = R(f);
  t(f + ': standard_yearly 5490 · premium_yearly 8990', /standard_yearly: 5490/.test(s) && /premium_yearly: 8990/.test(s));
}

console.log('\n=== 4. FAQ ===');
{
  const faq = R('frontend/pap-faq-i18n.js');
  const answers = faq.match(/"a": "[^"]*€5[.,]49[^"]*"/g) || [];
  t('가격 FAQ 답 8개 언어', answers.length === 8, answers.length);
  t('전부 2개월 무료 · 새 연간가', answers.every((a) => /€54[.,]90/.test(a) && /€89[.,]90/.test(a) && /(2개월|2 months|2 mesi|2 meses|2か月|2 个月|2 месяца|2 Monate)/.test(a)));
  t('전부 스탠다드 = 최근 3개 분기 (옛 6개월 표현 없음)', answers.every((a) => /(3개 분기|three quarters|tre trimestri|tres trimestres|3四半期|三个季度|три квартала|drei Quartale)/.test(a)) && !answers.some((a) => /(6개월|6 months|6 mesi|6 meses|6か月|6个月|6 месяцев|6 Monate)/.test(a)));
  t('전부 연간 프리미엄 혜택(€380 · 5명)', answers.every((a) => /€380/.test(a) && /5/.test(a.split('€380')[1] || '')));
  const about = R('frontend/about.html');
  t('about.html JSON-LD 한국어 답도 같은 문장', /연간 결제는 2개월 무료\(Standard €54\.90 · Premium €89\.90\)/.test(about) && /pap-faq-i18n\.js\?v=10/.test(about));
}

console.log('\n=== 5. 승인 메일 업셀 ===');
{
  const em = R('api/_lib/email.js');
  const b4 = em.match(/upB4: '[^']*'/g) || [];
  const b5 = em.match(/upB5:\s*'[^']*'/g) || [];
  t('upB4 9개 · upB5 9개', b4.length === 9 && b5.length === 9, b4.length + '/' + b5.length);
  t('upB4 는 연간 전용이라고 말하지 않는다 (심사 중 수정·크레딧 수정은 프리미엄 공통)', !b4.some((x) => /(연간|Yearly|annual|annuel|anual|Jahres|年間|年度|年付|Годов|jährlich)/i.test(x)));
  t('upB5 = 연간 전용 · €380 · 5명 · 무료 회원도', b5.every((x) => /€380/.test(x) && /5/.test(x)) && /PAP 회원이면 무료 회원도 가능/.test(em) && /free members included/.test(em));
  t('메일 목록에 upB5 가 렌더된다', /<li>\$\{L\.upB4\}<\/li><li>\$\{L\.upB5\}<\/li>/.test(em));
}

console.log('\n=== 6. /submissions ===');
{
  const s = R('frontend/submissions.html');
  t('본문 · FAQ · JSON-LD 세 곳 모두 연간 프리미엄 €380 면제', (s.match(/Yearly Premium[^<"]{0,40}(members get one €380 submission waived|<\/strong> members get one €380 submission waived)/g) || []).length + (/Yearly Premium<\/strong> members get one €380 submission waived per subscription year/.test(s) ? 0 : 0) >= 2
    && /<strong style="color:rgba\(255,255,255,\.6\)">Yearly Premium<\/strong> members get one €380 submission waived per subscription year \(branded €790 excluded\)/.test(s)
    && /Fees apply only if accepted, and Yearly Premium members get one €380 submission waived per subscription year\./.test(s)
    && /a declined submission costs nothing\. Yearly Premium members get one €380 submission waived per subscription year \(branded €790 excluded\)\."/.test(s));
}

console.log('\n=== 7. €380 결제 승인 창 (실제로 띄운다) ===');
{
  const src = R('frontend/pap-submission-fee-consent.js');
  t('안내 문구 9개 언어 (라벨 · 본문 · subscribe 링크 utm)', (src.match(/yearlyTipLabel:'/g) || []).length === 9 && (src.match(/yearlyTip:'[^\n]*utm_source=submission_fee_modal/g) || []).length === 9);
  function open(opts) {
    let html = '';
    const el = () => ({ style: {}, setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => ({ addEventListener() {}, style: {}, focus() {} }), set innerHTML(v) { html = v; }, get innerHTML() { return html; }, parentNode: null });
    const ctx = {
      window: {}, document: { createElement: el, body: { appendChild() {}, style: {} }, addEventListener() {}, removeEventListener() {} },
      localStorage: { getItem: () => opts.lang || 'ko' }, setTimeout: () => 0, Promise,
    };
    ctx.window._papYearlyPremium = opts.yearly;
    ctx.window._papFeeWaiver = opts.waiver || null;
    vm.createContext(ctx);
    vm.runInContext(src.replace(/\bwindow\./g, 'window.'), ctx);
    ctx.window._papFeeConsent({ submissionType: opts.type, paidReason: 'few_looks', realLookCount: 2 });
    return html;
  }
  let h = open({ type: 'paid_few_looks', yearly: false });
  t('€380 · 연간 아님 → "연간 프리미엄이라면" 안내가 뜬다', /연간 프리미엄이라면/.test(h) && /utm_source=submission_fee_modal/.test(h), h.slice(0, 60));
  h = open({ type: 'paid_few_looks', yearly: null });
  t('€380 · 모름(비로그인 등) → 안내가 뜬다', /연간 프리미엄이라면/.test(h));
  h = open({ type: 'paid_few_looks', yearly: true });
  t('€380 · 이미 연간(면제 사용함) → 안내 없음', !/연간 프리미엄이라면/.test(h) && /€380/.test(h));
  h = open({ type: 'paid_few_looks', yearly: true, waiver: { eligible: true } });
  t('€380 · 면제 대상 → 면제 창, 안내 없음', /이번 게재료\(€380\)는 면제/.test(h) && !/연간 프리미엄이라면/.test(h));
  h = open({ type: 'branded', yearly: false });
  t('€790 브랜디드 → 안내 없음 (면제 대상이 아니다)', !/연간 프리미엄이라면/.test(h) && /€790/.test(h));
  h = open({ type: 'paid_few_looks', yearly: false, lang: 'de' });
  t('독일어로도 뜬다', /Mit Jahres-Premium/.test(h));
  const subHtml = R('frontend/submission.html');
  t('캐시버스트 consent v6', /pap-submission-fee-consent\.js\?v=6/.test(subHtml));
}

console.log('\n=== 8. 마이페이지 멤버십 카드 ===');
{
  const mp = R('frontend/mypage.html');
  t('perkYearly 9개 언어', (mp.match(/perkYearly:'/g) || []).length === 9);
  t('무료 · 스탠다드 카드: 잠금 줄로 보인다', (mp.match(/perk\(false, _t\.perkYearly\);/g) || []).length === 2);
  t('프리미엄 카드: 기본 잠금, fee-waiver.yearlyPremium 이면 켠다', /'<span id="mpPerkYearly">' \+ perk\(false, _t\.perkYearly\) \+ '<\/span>'/.test(mp)
    && /fetch\('\/api\/submissions\/fee-waiver'[\s\S]{0,300}j\.yearlyPremium[\s\S]{0,120}perk\(true, _t\.perkYearly\)/.test(mp));
}

console.log('\n=== 9. 가입 화면 플랜 문구 ===');
{
  const a = R('frontend/auth.html');
  const FAKE = /(비하인드|1:1 피드백|독점 이벤트|Behind-the-scenes|1:1 feedback|Exclusive event|закулисье|Закулисье|Behind-the-Scenes|Dietro le quinte|Coulisses|Detrás de escena|舞台裏|幕后|限定イベント|独家活动)/;
  t('플랜 문구에 존재하지 않는 혜택이 없다', !((a.match(/plan(Std|Prem|Free)Features:'[^']*'/g) || []).concat(a.match(/data-i18n="plan(Std|Prem|Free)Features">[^<]*/g) || [])).some((x) => FAKE.test(x)));
  const std = a.match(/planStdFeatures:'[^']*'/g) || [];
  t('스탠다드 문구 10블록: Pull Letter · 우선 리뷰를 약속하지 않는다', std.length === 10 && !std.some((x) => /Pull.?Letter|우선|Priority|prioritar|приоритет|bevorzugt|優先|优先/i.test(x)), std.length);
  const prem = a.match(/planPremFeatures:'[^']*'/g) || [];
  t('프리미엄 문구 10블록: 연간 €380 면제 · 5명', prem.length === 10 && prem.every((x) => /€380/.test(x) && /5/.test(x)));
  t('정적 한국어 · 사전 8개 언어 일치, data-v 5', /data-i18n="planPremFeatures">전체 아카이브 · Pull-Letter 월 1건/.test(a) && /content="auth" data-v="5"/.test(a)
    && ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].every((l) => { const d = JSON.parse(R('frontend/i18n/ui/auth.' + l + '.json')); return d['전체 아카이브 · Pull-Letter 월 1건 · 우선 심사 · 연간: €380 서브미션 1회 면제 + 공동작업자 5명 지정'] && !d['Standard 포함 + 비하인드 콘텐츠 · 1:1 피드백 · 독점 이벤트 초대']; }));
}

console.log('\n=== 10. 구독 페이지: 연간 프리미엄 혜택 상자 ===');
{
  const sub = R('frontend/subscribe.html');
  const KEYS = ['ypTag', 'ypTitle', 'ypWaiver', 'ypWaiverSub', 'ypCollab', 'ypCollabSub', 'ypValue', 'ypHint'];
  const iToggle = sub.indexOf('<div class="billing-toggle">');
  const iBox = sub.indexOf('<div class="yearly-perks" id="yearlyPerks"');
  const iGrid = sub.indexOf('<div class="pricing-grid">');
  t('상자는 토글 바로 아래, 요금 카드보다 위', iToggle > 0 && iBox > iToggle && iBox < iGrid);
  const box = sub.slice(iBox, sub.indexOf('<!-- PRICING CARDS -->', iBox));
  t('상자를 누르면(키보드 포함) 연간으로 바뀐다', /onclick="setBilling\('yearly'\)"/.test(box) && /tabindex="0"/.test(box) && /onkeydown=/.test(box));
  t('상자 문구는 전부 사전 키로 (마크업에 한글 없음)', KEYS.filter((k) => k !== 'ypValue').every((k) => box.includes('data-i18n="' + k + '"')) && !/[가-힯]/.test(box.replace(/<!--[\s\S]*?-->/g, '')));
  t('€380 · 5 가 큰 숫자로', /<div class="yp-big">€380<\/div>/.test(box) && /<div class="yp-big">5<\/div>/.test(box));

  const ctx = {}; vm.runInNewContext(sub.match(/var L = \{[\s\S]*?\n\};/)[0] + '\nthis.out = L;', ctx);
  const D = ctx.out;
  const langs = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
  t('사전 키 8개 × 9개 언어', langs.every((l) => D[l] && KEYS.every((k) => typeof D[l][k] === 'string' && D[l][k].trim())), langs.filter((l) => !D[l] || KEYS.some((k) => !D[l][k])).join(','));
  t('사전 블록 10개(ru 중복 포함) 전부에 키가 있다', (sub.match(/ypCollabSub:'/g) || []).length === 10);
  t('가치 문구의 가격은 {price} 자리표시자 (EUR_PRICES 한 곳)', langs.every((l) => D[l].ypValue.includes('{price}') && /€380/.test(D[l].ypValue) && !/89[.,]90/.test(D[l].ypValue)));
  t('€790 유형 제외를 밝힌다 (면제는 €380 유형만)', langs.every((l) => /€790/.test(D[l].ypWaiverSub)));
  t('공동작업자: 5명 · 제출 후 수정', langs.every((l) => /5/.test(D[l].ypCollabSub)));
  t('프리미엄 카드 맨 위 두 줄 = €380 면제 · 공동작업자 (y:true), 10블록', (() => {
    const lists = sub.match(/prem: \[\n[\s\S]*?\n    \]/g) || [];
    return lists.length === 10 && lists.every((x) => {
      const it = x.split('\n').slice(1, -1);
      return /y:true[^\n]*€380/.test(it[0]) && /y:true[^\n]*5/.test(it[1]) && it.slice(2).every((y) => !/y:true/.test(y));
    });
  })());
  t('renderFeatures: y 줄은 li.yp (금색)', /if \(f\.on && f\.y\) \{\s*html \+= '<li class="yp">'/.test(sub) && /\.plan-features li\.yp\{color:#ffd43b/.test(sub));

  // updatePrices 를 실제로 돌려 본다 — 연간이면 상자 on + €89.90, 월간이면 off
  const els = {};
  const mk = (id) => (els[id] = els[id] || { id, textContent: '', innerHTML: '', _cls: new Set(), classList: { toggle(c, on) { on ? els[id]._cls.add(c) : els[id]._cls.delete(c); } } });
  const fnSrc = sub.match(/var EUR_PRICES = [\s\S]*?\nfunction formatPrice[\s\S]*?\n\}\n/)[0] + sub.match(/function updatePrices\(\) \{[\s\S]*?\n\}\n/)[0];
  const run = (billing, lang) => {
    const c = { L: D, currentBilling: billing, localStorage: { getItem: (k) => (k === 'pap-lang' ? lang : null) }, document: { getElementById: mk }, Proxy, Math, Number };
    vm.runInNewContext(fnSrc + '\nupdatePrices();', c);
  };
  run('yearly', 'ko');
  const y1 = els.yearlyPerks._cls.has('on'), v1 = els.ypValue.textContent;
  run('monthly', 'en');
  const y2 = els.yearlyPerks._cls.has('on'), v2 = els.ypValue.textContent;
  t('연간: 상자 켜짐 + 가치 문구 €89.90', y1 && v1.includes('€89.90') && !v1.includes('{price}'), v1);
  t('월간: 상자 꺼짐(안내 보임), 가치 문구는 영어로 €89.90', !y2 && v2.includes('€89.90') && /a year/.test(v2), v2);
}

console.log('\n=== 11. 구독 페이지: 언어 블록에 영어 복사본이 남지 않는다 ===');
{
  const sub = R('frontend/subscribe.html');
  const ctx = {}; vm.runInNewContext(sub.match(/var L = \{[\s\S]*?\n\};/)[0] + '\nthis.out = L;', ctx);
  const D = ctx.out;
  const flat = (o, p, out) => {
    if (typeof o === 'string') { out[p] = o; return out; }
    if (Array.isArray(o)) { o.forEach((x, i) => flat(x, p + '[' + i + ']', out)); return out; }
    if (o && typeof o === 'object') { for (const k in o) flat(o[k], p ? p + '.' + k : k, out); }
    return out;
  };
  // 브랜드·등급 이름과 메뉴 고유명사는 모든 언어에서 영어 그대로 쓴다(일본어 블록과 같은 규칙).
  const BRAND = /^(BUSINESS|CONTACT|ABOUT|SUBMISSION|PULL-LETTER|TIER \d|FREE|STANDARD|PREMIUM|No)$/;
  const en = flat(D.en, '', {});
  const bad = [];
  ['de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].forEach((l) => {
    const d = flat(D[l], '', {});
    Object.keys(en).forEach((k) => { if (d[k] === en[k] && /[A-Za-z]{2,}/.test(en[k]) && !BRAND.test(en[k])) bad.push(l + ':' + k); });
  });
  t('영어와 똑같은 UI 문구가 다른 언어 블록에 없다 (브랜드명 제외)', bad.length === 0, bad.slice(0, 8).join(', '));
  const need = ['monthly', 'yearly', 'save2mo', 'perYear', 'perMonth'];
  const miss = [];
  ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].forEach((l) => need.forEach((k) => { if (!D[l][k]) miss.push(l + ':' + k); }));
  t('월간·연간·2개월 무료·기간 표시 라벨 9개 언어 (영어로 떨어지지 않게)', miss.length === 0, miss.join(', '));
  t('독일어 카드·비교표가 독일어', D.de.features.prem[2].text.startsWith('Alle Editorials') && D.de.comparison.rows[0][0] === 'Registrierung nötig' && D.de.save2mo === '2 MONATE GRATIS');
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ yearly-price-and-perks FAILED'); process.exit(1); }
console.log('✅ yearly-price-and-perks passed');
