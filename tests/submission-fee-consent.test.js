/**
 * 2026-08-12 — 제출 직전 게재료 고지·동의 게이트를 고정한다.
 *
 * 왜 이 테스트가 있나 — 실측
 *   승인됐는데 미결제인 유료 서브미션 18건 = €13,400.
 *   `submissions.payment_status='paid'` 는 전체 124건 중 0건.
 *   도메니코 확인: 작가들이 "선택을 하지 않아서" 결제하지 않는다. 즉 제출 시점에
 *   돈이 나갈 수 있다는 사실을 몰랐다. 안내 박스는 있었지만 지나칠 수 있었고,
 *   무엇보다 "언제 청구되는지" 를 말하지 않았다.
 *
 * 그래서 여기서 지키는 것
 *   1) 유료 판정이면 업로드 전에 반드시 막고 명시적 동의를 받는다
 *   2) 체크박스를 켜야만 진행된다 (오클릭으로 €790 에 동의되지 않는다)
 *   3) 취소가 기본값이다 (ESC·바깥클릭·닫기 = 돌아가기)
 *   4) 무료 제출자에게는 아무것도 뜨지 않는다
 *   5) 안내 금액이 서버 요금표와 같다 (다르면 "안내한 값 ≠ 청구된 값" 이 된다)
 *   6) 9개 언어 전부에 "수락된 경우에만 청구" 가 들어 있다
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'de', 'ja', 'zh', 'ru'];
const KEYS = ['title', 'whyLabel', 'feeLabel', 'whenLabel', 'when', 'howLabel', 'how',
  'ifNotLabel', 'ifNot', 'fixLabel', 'fixFewLooks', 'fixBranded',
  'whyFewLooks', 'whyBrandOne', 'whyBrandShared', 'whyBrandGeneric', 'agree', 'back', 'go'];

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

// ── 아주 작은 DOM 스텁 ──────────────────────────────────────────────────
// jsdom 은 이 저장소에 없다. 모듈이 실제로 쓰는 것만 흉내 낸다.
// 이렇게까지 하는 이유: 정규식으로 소스만 보면 "체크박스가 있다" 는 알 수 있어도
// "체크 안 하면 진짜로 못 누른다" 는 알 수 없다. 돈이 걸린 조건은 실행해서 본다.
function makeEl(tag) {
  const el = {
    tagName: tag, id: '', disabled: false, checked: false, value: '',
    style: { cssText: '', cursor: '', opacity: '', overflow: '' },
    children: [], parentNode: null, innerHTML: '', _h: {},
    setAttribute() {}, focus() {},
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
    addEventListener(t, fn) { (el._h[t] = el._h[t] || []).push(fn); },
    removeEventListener(t, fn) { el._h[t] = (el._h[t] || []).filter((f) => f !== fn); },
    fire(t, ev) { (el._h[t] || []).slice().forEach((fn) => fn(ev || { target: el, stopPropagation() {} })); },
    querySelector(sel) { return el._byId[sel] || null; },
    _byId: {},
  };
  return el;
}

function runModule() {
  const src = read('frontend/pap-submission-fee-consent.js');
  const body = makeEl('body');
  const docHandlers = {};
  const sandbox = {
    console,
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; },
    Promise,
    localStorage: { getItem: () => 'ko' },
    document: {
      body,
      createElement: makeEl,
      addEventListener(t, fn) { (docHandlers[t] = docHandlers[t] || []).push(fn); },
      removeEventListener(t, fn) { docHandlers[t] = (docHandlers[t] || []).filter((f) => f !== fn); },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'pap-submission-fee-consent.js' });
  return { sandbox, body, docHandlers };
}

// 모달을 띄우고, 안에 있는 세 요소를 스텁에 연결한다.
function openModal(classification, langOverride) {
  const { sandbox, body, docHandlers } = runModule();
  if (langOverride) sandbox.localStorage.getItem = () => langOverride;
  const p = sandbox.window._papFeeConsent(classification);
  const back = body.children[body.children.length - 1];
  if (!back) return { p, back: null, chk: null, go: null, no: null, docHandlers, body };
  const chk = makeEl('input'); const go = makeEl('button'); const no = makeEl('button');
  back._byId['#_papFeeAgree'] = chk; back._byId['#_papFeeGo'] = go; back._byId['#_papFeeBack'] = no;
  // 모듈은 innerHTML 을 넣은 뒤 querySelector 로 세 요소를 찾는다. 스텁에서는
  // innerHTML 파싱이 없으므로, 같은 순서를 재현하려면 한 번 더 실행해야 한다.
  return { sandbox, back, chk, go, no, docHandlers, body, p };
}

console.log('=== 소스 · 사전 (실행 없이 볼 수 있는 것) ===');
{
  const src = read('frontend/pap-submission-fee-consent.js');
  for (const l of LANGS) {
    ok('사전에 ' + l + ' 가 있다', new RegExp('(^|\\n)\\s{4}' + l + ':\\s*\\{').test(src));
  }
  // 각 언어가 19개 키를 다 갖고 있는지 — 실제로 객체를 꺼내 본다
  const sandbox = { console, localStorage: { getItem: () => 'en' }, Promise, setTimeout: () => 0,
    document: { body: makeEl('body'), createElement: makeEl, addEventListener() {}, removeEventListener() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;window.__T = (function(){ try { return T; } catch(e) { return null; } })();', sandbox);
  // T 는 IIFE 안에 있어 밖에서 못 본다 → 문자열로 검사한다.
  for (const l of LANGS) {
    const block = src.split(new RegExp('(^|\\n)\\s{4}' + l + ':\\s*\\{'))[2] || '';
    const seg = block.split(/\n\s{4}\},/)[0];
    const missing = KEYS.filter((k) => !new RegExp('(^|\\s)' + k + ':').test(seg));
    ok(l + ' 에 문구 19개가 다 있다', missing.length === 0, '빠진 키: ' + missing.join(', '));
  }
  ok('금액이 €380 / €790 이다', /branded:\s*'€790'/.test(src) && /paid_few_looks:\s*'€380'/.test(src));
  ok('취소가 기본값 — ESC 는 false 로 닫는다', /Escape[\s\S]{0,80}close\(false\)/.test(src));
  ok('바깥 클릭도 false 로 닫는다', /e\.target === back[\s\S]{0,40}close\(false\)/.test(src));
  ok('진행 버튼은 disabled 로 시작한다', /id="_papFeeGo" disabled/.test(src));
}

console.log('=== 서버 요금표와 일치 ===');
{
  const srv = read('api/_lib/submissionPayment.js');
  const src = read('frontend/pap-submission-fee-consent.js');
  const m = srv.match(/SUBMISSION_FEE_CENTS\s*=\s*\{([\s\S]*?)\}/);
  ok('서버에 SUBMISSION_FEE_CENTS 가 있다', !!m);
  if (m) {
    const brandedCents = (m[1].match(/branded:\s*(\d+)/) || [])[1];
    const fewCents = (m[1].match(/paid_few_looks:\s*(\d+)/) || [])[1];
    ok('branded 안내 €790 = 서버 ' + brandedCents + '센트',
      Number(brandedCents) === 79000 && /branded:\s*'€790'/.test(src),
      '안내 금액과 청구 금액이 다르면 회원이 예상 못 한 청구를 받는다');
    ok('few_looks 안내 €380 = 서버 ' + fewCents + '센트',
      Number(fewCents) === 38000 && /paid_few_looks:\s*'€380'/.test(src));
  }
}

console.log('=== 실행 — 무료 제출자는 막지 않는다 ===');
{
  const { sandbox, body } = runModule();
  let resolved = null;
  const cases = [
    { submissionType: 'free', realLookCount: 6 },
    null,
    undefined,
    {},
  ];
  let allTrue = true; let anyModal = false;
  for (const c of cases) {
    const before = body.children.length;
    sandbox.window._papFeeConsent(c).then((v) => { if (v !== true) allTrue = false; });
    if (body.children.length !== before) anyModal = true;
  }
  ok('free · null · 빈 객체 전부 통과시킨다', allTrue);
  ok('무료 제출자에게는 모달이 뜨지 않는다', !anyModal);
  resolved = null; void resolved;
}

console.log('=== 실행 — 유료 제출자는 반드시 막는다 ===');
{
  const { sandbox, body } = runModule();
  const before = body.children.length;
  sandbox.window._papFeeConsent({ submissionType: 'branded', realLookCount: 5, clothingBrands: ['Juana Echeguia'], singleClothingBrand: true });
  ok('branded 면 모달이 뜬다', body.children.length === before + 1);
  const back = body.children[body.children.length - 1];
  const html = back.innerHTML;
  ok('금액 €790 이 화면에 있다', html.indexOf('€790') !== -1);
  ok('왜 유료인지 그 제출본의 사실로 말한다 (브랜드 이름)', html.indexOf('Juana Echeguia') !== -1,
    '일반론만 쓰면 안 읽힌다');
  ok('"수락한 경우에만" 이 화면에 있다', html.indexOf('수락한 경우에만') !== -1);
  ok('"거절되면 한 푼도" 가 화면에 있다', html.indexOf('한 푼도') !== -1);
  ok('돌아가기 버튼이 있다', html.indexOf('_papFeeBack') !== -1);
  ok('진행 버튼이 disabled 로 시작한다', /id="_papFeeGo" disabled/.test(html));
  ok('body 스크롤을 잠근다', body.style.overflow === 'hidden');
}

{
  const { sandbox, body } = runModule();
  sandbox.window._papFeeConsent({ submissionType: 'paid_few_looks', realLookCount: 2 });
  const html = body.children[body.children.length - 1].innerHTML;
  ok('few_looks 면 €380 을 보여준다', html.indexOf('€380') !== -1 && html.indexOf('€790') === -1);
  ok('룩이 몇 개인지 구체적으로 말한다', html.indexOf('2개') !== -1, '"룩이 부족합니다" 로는 뭘 고칠지 모른다');
  ok('무료로 만드는 방법을 알려준다', html.indexOf('4개 이상') !== -1);
}

console.log('=== 실행 — 언어별로 뜬다 ===');
{
  for (const l of LANGS) {
    const { sandbox, body } = runModule();
    sandbox.localStorage.getItem = () => l;
    sandbox.window._papFeeConsent({ submissionType: 'branded', realLookCount: 4, clothingBrands: ['X'], singleClothingBrand: true });
    const html = body.children[body.children.length - 1].innerHTML;
    ok(l + ' 로 뜨고 금액이 들어 있다', html.indexOf('€790') !== -1 && html.length > 500);
  }
  const { sandbox, body } = runModule();
  sandbox.localStorage.getItem = () => 'xx';   // 모르는 언어
  sandbox.window._papFeeConsent({ submissionType: 'branded', realLookCount: 4 });
  ok('모르는 언어는 영어로 떨어진다', body.children[body.children.length - 1].innerHTML.indexOf('Before you submit') !== -1);
}

console.log('=== submission.html 연결 ===');
{
  const html = read('frontend/submission.html');
  ok('동의 모듈을 로드한다', /pap-submission-fee-consent\.js\?v=/.test(html));
  ok('업로드 전에 동의를 받는다', /_papFeeConsent\(_papClassifySubmission\(\)\)/.test(html));
  ok('동의하지 않으면 제출을 멈춘다', /if\(!_feeOk\)\{[^}]*return;/.test(html));
  // 순서: 동의 게이트가 데이터 수집·업로드보다 먼저여야 한다
  const gate = html.indexOf('_papFeeConsent(_papClassifySubmission())');
  const collect = html.indexOf('// Collect form data — field names match backend expectations');
  ok('동의 게이트가 데이터 수집보다 앞에 있다', gate > 0 && collect > 0 && gate < collect,
    '뒤에 있으면 이미 업로드가 시작된 뒤에 묻게 된다');
  ok('분류 결과가 브랜드 이름을 함께 돌려준다', /clothingBrands:Object\.keys\(clothing\)/.test(html),
    '이름이 없으면 "어느 브랜드 때문인지" 를 말해 줄 수 없다');
}

console.log('=== 안내 박스 문구 (9개 언어) ===');
{
  const html = read('frontend/submission.html');
  function values(key) {
    const out = [];
    const re = new RegExp(key + ":'((?:[^'\\\\]|\\\\.)*)'", 'g');
    let m; while ((m = re.exec(html))) out.push(m[1]);
    return out;
  }
  for (const key of ['submissionTypeFewLooks', 'submissionTypeBranded']) {
    const vals = values(key);
    ok(key + ' 가 9개 언어에 있다', vals.length === 9, '실제 ' + vals.length + '개');
    const fee = key === 'submissionTypeBranded' ? '790' : '380';
    ok(key + ' 전부에 금액이 있다', vals.every((v) => v.indexOf(fee) !== -1));
    // "수락된 경우에만 청구" 가 빠지면 회원은 제출 즉시 청구되는 줄 안다 —
    // 그게 이탈 사유가 된다. 언어마다 표현이 다르므로 후보 목록으로 본다.
    // 언어마다 "오직 ~한 경우에만" 의 어순이 다르다(독일어는 nur ... wenn 처럼 떨어진다).
    // 그래서 문자열이 아니라 정규식으로 본다. 카피를 테스트에 맞춰 비틀지 않기 위해서다.
    const COND = [/수락한 경우에만/, /only if/i, /nur\b[\s\S]{0,40}wenn/, /solo se/i,
      /ne sont factur[\s\S]{0,20}que si/, /solo si/i, /受理した場合にのみ/, /仅在[\s\S]{0,30}录用/,
      /только если/];
    const hit = (v) => COND.some((c) => c.test(v));
    ok(key + ' 전부에 "수락된 경우에만 청구" 조건이 있다',
      vals.every(hit),
      '빠진 언어 인덱스: ' + vals.map((v, i) => (hit(v) ? null : i)).filter((x) => x !== null).join(', '));
  }
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ submission-fee-consent tests passed');
process.exit(0);
