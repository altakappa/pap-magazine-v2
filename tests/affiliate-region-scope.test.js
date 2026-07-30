/**
 * PAP Magazine — 어필리에이트 지역 스코프 회귀 테스트
 *
 * ── 이력 (지우지 말 것 — 두 번 뒤집힌 규칙이다) ─────────────────────────
 *
 * 2026-07-26 (구): 라쿠텐 감사에서 마이테레사 AU/Asia-Pacific(MID 43171)이
 *   "APAC 한정"이라고 판단했다. 그래서 GLOBAL 방문자에게 korea 링크를 주지
 *   않도록 막고, 이 테스트가 그 누수를 0으로 강제했다.
 *
 * 2026-07-29 (현): **그 전제가 사실이 아니었다.** Mytheresa 마리나 그레지오
 *   확인 — "You earn a commission regardless of where the order is shipped...
 *   if an order goes through the APAC MID but is shipped to Italy, South
 *   Korea, or any other country, you still receive the commission."
 *
 *   그 사이의 실제 손실: 최근 30일 /go 클릭 2,128건 중 어필리에이트 링크로
 *   간 건 2건(0.09%). 브랜드 94개 전부 korea 링크만 있고 global 은 0개라
 *   GLOBAL(트래픽의 99%)은 구조적으로 항상 인스타그램 폴백이었다.
 *
 *   그래서 방향이 반대가 됐다. 이 테스트는 이제 **GLOBAL 이 korea 링크로
 *   폴백하는 것**과, 그때 목적지가 한국어 페이지로 가지 않는 것을 강제한다.
 *
 * 프레임워크 없음 — tests/affiliate-phase0.test.js 와 같은 스타일.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  pickAffiliateUrl,
  isNonCommissionable,
  toInternationalStorefront,
} = require(path.join(ROOT, 'api/_lib/affiliateUrl.js'));

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); fail++; }
}

const KR_LINK = 'https://click.linksynergy.com/deeplink?id=xaC5X1voYF4&mid=43171&u1=prada&murl=https%3A%2F%2Fwww.mytheresa.com%2Fkr%2Fko%2Fwomen%2Fdesigners%2Fprada';
const KR_LINK_INT = 'https://click.linksynergy.com/deeplink?id=xaC5X1voYF4&mid=43171&u1=prada&murl=https%3A%2F%2Fwww.mytheresa.com%2Fint%2Fen%2Fwomen%2Fdesigners%2Fprada';
const GLOBAL_LINK = 'https://example-global-network.test/click?brand=prada';

const PRADA = { brand_id: 'prada', display_name: 'PRADA' };
function brand(extra) { return Object.assign({}, PRADA, extra); }

console.log('\n=== pickAffiliateUrl: GLOBAL 폴백 (2026-07-29 전환) ===');

it('핵심: GLOBAL + korea 링크만 → korea 링크로 폴백한다 (더 이상 null 이 아니다)', () => {
  const b = brand({ affiliate_url_korea: KR_LINK, affiliate_url_global: null });
  const got = pickAffiliateUrl(b, 'GLOBAL');
  assert.ok(got, 'GLOBAL 이 null 을 받았다 — 2,108건이 새던 그 버그의 재발');
  assert.ok(/mid=43171/.test(got), 'MID 43171 트래킹이 유지돼야 한다');
});

it('GLOBAL 폴백 시 목적지가 국제판(/int/en/)으로 바뀐다', () => {
  const b = brand({ affiliate_url_korea: KR_LINK, affiliate_url_global: null });
  assert.strictEqual(pickAffiliateUrl(b, 'GLOBAL'), KR_LINK_INT);
});

it('GLOBAL 폴백이 트래킹 파라미터(id·mid·u1)를 건드리지 않는다', () => {
  const got = pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), 'GLOBAL');
  assert.ok(/id=xaC5X1voYF4/.test(got), 'id 파라미터가 사라졌다');
  assert.ok(/mid=43171/.test(got), 'mid 파라미터가 사라졌다');
  assert.ok(/u1=prada/.test(got), 'u1 파라미터가 사라졌다');
});

it('GLOBAL 전용 링크가 있으면 그걸 우선 쓴다 (폴백보다 먼저)', () => {
  const b = brand({ affiliate_url_korea: KR_LINK, affiliate_url_global: GLOBAL_LINK });
  assert.strictEqual(pickAffiliateUrl(b, 'GLOBAL'), GLOBAL_LINK);
});

it('KR 방문자는 한국어 링크를 그대로 받는다 (로케일을 바꾸지 않는다)', () => {
  const b = brand({ affiliate_url_korea: KR_LINK, affiliate_url_global: GLOBAL_LINK });
  assert.strictEqual(pickAffiliateUrl(b, 'KR'), KR_LINK);
});

it('KR + global 링크만 → global 폴백', () => {
  const b = brand({ affiliate_url_korea: null, affiliate_url_global: GLOBAL_LINK });
  assert.strictEqual(pickAffiliateUrl(b, 'KR'), GLOBAL_LINK);
});

console.log('\n=== 수수료 제외 브랜드 → 인스타그램 폴백 ===');

it('Adidas · Nike · New Balance · On 은 링크가 있어도 null', () => {
  ['ADIDAS', 'Nike', 'New Balance', 'NEWBALANCE', 'On', 'ON'].forEach((name) => {
    const b = { brand_id: name.toLowerCase(), display_name: name, affiliate_url_korea: KR_LINK };
    assert.strictEqual(pickAffiliateUrl(b, 'GLOBAL'), null, name + ' (GLOBAL) 이 링크를 받았다');
    assert.strictEqual(pickAffiliateUrl(b, 'KR'), null, name + ' (KR) 이 링크를 받았다');
  });
});

it('부분일치로 잘못 걸리지 않는다 (ONITSUKA·NIKELAB 등은 정상 브랜드)', () => {
  ['ONITSUKATIGER', 'NIKELAB', 'ADIDASORIGINALS_X', 'BALENCIAGA'].forEach((name) => {
    assert.strictEqual(
      isNonCommissionable({ display_name: name }), false,
      name + ' 이 수수료 제외로 잘못 분류됐다'
    );
  });
});

it('표기 흔들림을 흡수한다 (new_balance / new-balance / New Balance)', () => {
  ['new_balance', 'new-balance', 'New Balance', 'NEW  BALANCE'].forEach((name) => {
    assert.strictEqual(isNonCommissionable({ display_name: name }), true, name + ' 를 못 잡았다');
  });
});

console.log('\n=== toInternationalStorefront: 안전 규칙 ===');

it('마이테레사 링크가 아니면 원본 그대로', () => {
  assert.strictEqual(toInternationalStorefront(GLOBAL_LINK), GLOBAL_LINK);
});

it('이미 국제판이면 그대로 (중복 치환 없음)', () => {
  assert.strictEqual(toInternationalStorefront(KR_LINK_INT), KR_LINK_INT);
});

it('인코딩되지 않은 형태도 처리', () => {
  assert.strictEqual(
    toInternationalStorefront('https://www.mytheresa.com/kr/ko/women/designers/prada'),
    'https://www.mytheresa.com/int/en/women/designers/prada'
  );
});

it('빈 값·null 에 throw 하지 않는다', () => {
  assert.strictEqual(toInternationalStorefront(''), '');
  assert.strictEqual(toInternationalStorefront(null), '');
});

console.log('\n=== 공통 안전 ===');

it('링크 없음 → null (호출부가 인스타그램 폴백으로 넘어간다)', () => {
  const b = brand({ affiliate_url_korea: null, affiliate_url_global: null });
  assert.strictEqual(pickAffiliateUrl(b, 'KR'), null);
  assert.strictEqual(pickAffiliateUrl(b, 'GLOBAL'), null);
});

it('빈 문자열은 링크 없음으로 취급', () => {
  const b = brand({ affiliate_url_korea: '', affiliate_url_global: '' });
  assert.strictEqual(pickAffiliateUrl(b, 'GLOBAL'), null);
  assert.strictEqual(pickAffiliateUrl(b, 'KR'), null);
});

it('brand 자체가 null → null (throw 하지 않는다)', () => {
  assert.strictEqual(pickAffiliateUrl(null, 'KR'), null);
  assert.strictEqual(pickAffiliateUrl(undefined, 'GLOBAL'), null);
});

// ── 소스 레벨 가드 ───────────────────────────────────────────────────────
// 누군가 [id].js 안에 pickAffiliateUrl 을 다시 인라인으로 만들어 넣는 회귀를 막는다.
console.log('\n=== 소스 가드: api/go/[id].js ===');

const goSrc = fs.readFileSync(path.join(ROOT, 'api/go/[id].js'), 'utf8');

it('[id].js 는 _lib/affiliateUrl 에서 pickAffiliateUrl 을 가져온다', () => {
  assert.ok(
    /require\(['"]\.\.\/_lib\/affiliateUrl['"]\)/.test(goSrc),
    "api/go/[id].js 가 require('../_lib/affiliateUrl') 를 하지 않는다"
  );
});

it('[id].js 안에 pickAffiliateUrl 을 재정의하지 않는다', () => {
  assert.ok(
    !/function\s+pickAffiliateUrl/.test(goSrc),
    'api/go/[id].js 안에 pickAffiliateUrl 이 다시 정의됐다 — _lib 버전만 써야 한다'
  );
});

it('브랜드 조회가 제외 판정에 필요한 컬럼을 가져온다', () => {
  assert.ok(/brand_id/.test(goSrc) && /display_name/.test(goSrc),
    'brand_id·display_name 없이는 수수료 제외 브랜드를 판정할 수 없다');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
