/**
 * PAP Magazine — 어필리에이트 지역 스코프 회귀 테스트 (2026-07-26)
 *
 * 배경: 라쿠텐 계정 감사에서 마이테레사 AU/Asia-Pacific(MID 43171) 계약이
 * 승인된 채 방치돼 있는 걸 발견했다. 이 프로그램은 APAC 한정이라 수수료 인정
 * 지역 밖(=PAP 트래픽의 99%인 GLOBAL) 클릭은 0원이다.
 *
 * 그런데 예전 pickAffiliateUrl 은
 *     return brand.affiliate_url_global || brand.affiliate_url_korea || null;
 * 이어서 **GLOBAL 방문자에게 korea 링크를 폴백으로 내보냈다.** 그대로 링크를
 * 꽂았으면 글로벌 트래픽이 수수료 0원 링크로 새어나가고, 원래 가던 인스타그램
 * 폴백(=IG 팔로워 유입)까지 잃어 지금보다 나빠졌을 것이다.
 *
 * 이 테스트는 그 누수를 0으로 강제한다.
 *
 * 프레임워크 없음 — tests/affiliate-phase0.test.js 와 같은 스타일.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { pickAffiliateUrl } = require(path.join(ROOT, 'api/_lib/affiliateUrl.js'));

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); fail++; }
}

const KR_LINK = 'https://click.linksynergy.com/deeplink?id=xaC5X1voYF4&mid=43171&u1=prada&murl=https%3A%2F%2Fwww.mytheresa.com%2Fkr%2Fko%2Fwomen%2Fdesigners%2Fprada';
const GLOBAL_LINK = 'https://example-global-network.test/click?brand=prada';

console.log('\n=== pickAffiliateUrl: 지역 스코프 ===');

it('핵심 회귀: GLOBAL 방문자 + korea 링크만 → null (korea 로 새지 않는다)', () => {
  const brand = { affiliate_url_korea: KR_LINK, affiliate_url_global: null };
  assert.strictEqual(pickAffiliateUrl(brand, 'GLOBAL'), null);
});

it('GLOBAL 방문자 + global 링크 → global', () => {
  const brand = { affiliate_url_korea: KR_LINK, affiliate_url_global: GLOBAL_LINK };
  assert.strictEqual(pickAffiliateUrl(brand, 'GLOBAL'), GLOBAL_LINK);
});

it('KR 방문자 + korea 링크 → korea (global 이 있어도 korea 우선)', () => {
  const brand = { affiliate_url_korea: KR_LINK, affiliate_url_global: GLOBAL_LINK };
  assert.strictEqual(pickAffiliateUrl(brand, 'KR'), KR_LINK);
});

it('KR 방문자 + global 링크만 → global 로 폴백 (글로벌 프로그램은 통상 KR 포함)', () => {
  const brand = { affiliate_url_korea: null, affiliate_url_global: GLOBAL_LINK };
  assert.strictEqual(pickAffiliateUrl(brand, 'KR'), GLOBAL_LINK);
});

it('링크 없음 → null (호출부가 인스타그램 폴백으로 넘어간다)', () => {
  assert.strictEqual(pickAffiliateUrl({ affiliate_url_korea: null, affiliate_url_global: null }, 'KR'), null);
  assert.strictEqual(pickAffiliateUrl({ affiliate_url_korea: null, affiliate_url_global: null }, 'GLOBAL'), null);
});

it('빈 문자열은 링크 없음으로 취급', () => {
  assert.strictEqual(pickAffiliateUrl({ affiliate_url_korea: '', affiliate_url_global: '' }, 'GLOBAL'), null);
  assert.strictEqual(pickAffiliateUrl({ affiliate_url_korea: '', affiliate_url_global: '' }, 'KR'), null);
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

it('금지 패턴: affiliate_url_global || affiliate_url_korea 폴백이 없다', () => {
  assert.ok(
    !/affiliate_url_global\s*\|\|\s*brand\.affiliate_url_korea/.test(goSrc),
    'GLOBAL → korea 폴백이 되살아났다 (수수료 0원 링크로 글로벌 트래픽이 샌다)'
  );
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
