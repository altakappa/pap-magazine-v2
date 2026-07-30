/**
 * PAP Magazine — 어필리에이트 지역 라우팅 회귀 테스트
 *
 * ── 이력 (지우지 말 것 — 규칙이 세 번 바뀌었다) ─────────────────────────
 *
 * 2026-07-26: "MID 43171 은 APAC 한정"이라 판단해 GLOBAL 이 korea 링크를 못 받게 막음.
 * 2026-07-29: **그 전제가 틀렸다.** Mytheresa 확인 — 배송지 무관 수수료.
 *             그 사이 30일 클릭 2,128건 중 어필리에이트 도달 2건(0.09%).
 * 2026-07-30: US/CA(43172)·EU/UK/ME(35663) 제휴 성립 → 지역별 MID 라우팅으로 전환.
 *
 * 링크 패턴은 실제 리다이렉트를 따라가 검증했다:
 *   mid=43172 → ranMID=43172 · tarea=us
 *   mid=35663 → ranMID=35663 · tarea=uk
 *   id=xaC5X1voYF4 는 세 MID 전부 동일 (퍼블리셔 ranEAID)
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
  localizeAffiliateUrl,
  regionFromCountry,
  REGION_CONFIG,
} = require(path.join(ROOT, 'api/_lib/affiliateUrl.js'));

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); fail++; }
}

const KR_LINK = 'https://click.linksynergy.com/deeplink?id=xaC5X1voYF4&mid=43171&u1=prada&murl=https%3A%2F%2Fwww.mytheresa.com%2Fkr%2Fko%2Fwomen%2Fdesigners%2Fprada';
const OTHER_NETWORK = 'https://example-global-network.test/click?brand=prada';

const PRADA = { brand_id: 'prada', display_name: 'PRADA' };
function brand(extra) { return Object.assign({}, PRADA, extra); }

console.log('\n=== MID 지도 (계약과 코드가 어긋나면 수수료가 통째로 샌다) ===');

it('APAC/KR = 43171 · /kr/ko', () => {
  assert.strictEqual(REGION_CONFIG.KR.mid, '43171');
  assert.strictEqual(REGION_CONFIG.KR.locale, 'kr/ko');
});
it('US/CA = 43172 · /us/en (실측 ranMID=43172·tarea=us)', () => {
  assert.strictEqual(REGION_CONFIG.US.mid, '43172');
  assert.strictEqual(REGION_CONFIG.US.locale, 'us/en');
});
it('EU/UK/ME = 35663 · /int/en (실측 ranMID=35663·tarea=uk)', () => {
  assert.strictEqual(REGION_CONFIG.EU.mid, '35663');
  assert.strictEqual(REGION_CONFIG.EU.locale, 'int/en');
});
// 2026-07-30 — 라쿠텐 실측: 43171 은 공용 베이스라인 4%, 43172·35663 은 전용 오퍼 8%.
// GLOBAL 을 43171 로 되돌리면 같은 클릭에 요율이 절반이 된다. 근거 없이 되돌리지 못하게 못박는다.
it('GLOBAL 은 43172(8%) 로 간다 — 43171(4%) 로 되돌리면 요율이 절반이다', () => {
  assert.strictEqual(REGION_CONFIG.GLOBAL.mid, '43172');
  assert.notStrictEqual(REGION_CONFIG.GLOBAL.mid, '43171');
});

it('요율이 8% 인 MID 로만 GLOBAL·US·EU 를 보낸다', () => {
  ['US', 'EU', 'GLOBAL'].forEach((r) => {
    assert.strictEqual(REGION_CONFIG[r].rate, 8, r + ' 가 8% MID 가 아니다');
  });
});

it('KR 은 한국어 스토어프론트를 위해 43171(4%) 을 의도적으로 유지', () => {
  assert.strictEqual(REGION_CONFIG.KR.mid, '43171');
  assert.strictEqual(REGION_CONFIG.KR.locale, 'kr/ko');
});

console.log('\n=== 국가 → 지역 ===');

it('KR → KR', () => assert.strictEqual(regionFromCountry('KR'), 'KR'));
it('US·CA → US', () => {
  assert.strictEqual(regionFromCountry('US'), 'US');
  assert.strictEqual(regionFromCountry('CA'), 'US');
});
it('유럽·영국·중동 → EU', () => {
  ['DE', 'FR', 'IT', 'ES', 'GB', 'NL', 'AE', 'IL'].forEach((c) => {
    assert.strictEqual(regionFromCountry(c), 'EU', c + ' 가 EU 로 안 갔다');
  });
});
it('그 외 → GLOBAL', () => {
  ['JP', 'AU', 'BR', 'ZA', 'CN', ''].forEach((c) => {
    assert.strictEqual(regionFromCountry(c), 'GLOBAL', c + ' 가 GLOBAL 이 아니다');
  });
});
it('소문자·공백을 흡수한다', () => {
  assert.strictEqual(regionFromCountry(' us '), 'US');
  assert.strictEqual(regionFromCountry('kr'), 'KR');
});
it('null·undefined 에 throw 하지 않는다', () => {
  assert.strictEqual(regionFromCountry(null), 'GLOBAL');
  assert.strictEqual(regionFromCountry(undefined), 'GLOBAL');
});

console.log('\n=== 링크 변환: mid 와 로케일만 바뀐다 ===');

it('US 방문자 → mid=43172 · /us/en', () => {
  const got = pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), 'US');
  assert.ok(/[?&]mid=43172\b/.test(got), 'mid 가 43172 로 안 바뀌었다: ' + got);
  assert.ok(/mytheresa\.com%2Fus%2Fen%2F/.test(got), '로케일이 us/en 이 아니다: ' + got);
});

it('EU 방문자 → mid=35663 · /int/en', () => {
  const got = pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), 'EU');
  assert.ok(/[?&]mid=35663\b/.test(got), 'mid 가 35663 으로 안 바뀌었다: ' + got);
  assert.ok(/mytheresa\.com%2Fint%2Fen%2F/.test(got), '로케일이 int/en 이 아니다: ' + got);
});

it('GLOBAL 방문자 → mid=43172(8%) · /int/en', () => {
  const got = pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), 'GLOBAL');
  assert.ok(/[?&]mid=43172\b/.test(got), 'GLOBAL 이 4% MID 로 갔다: ' + got);
  assert.ok(/mytheresa\.com%2Fint%2Fen%2F/.test(got), got);
});

it('KR 방문자는 저장된 링크를 그대로 받는다 (변환 없음)', () => {
  assert.strictEqual(pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), 'KR'), KR_LINK);
});

it('핵심: 퍼블리셔 id 와 u1 은 절대 바뀌지 않는다 (귀속이 여기서 갈린다)', () => {
  ['KR', 'US', 'EU', 'GLOBAL'].forEach((r) => {
    const got = pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), r);
    assert.ok(/id=xaC5X1voYF4/.test(got), r + ': 퍼블리셔 id 가 사라졌다');
    assert.ok(/u1=prada/.test(got), r + ': u1 이 사라졌다');
  });
});

it('경로(women/designers/prada)는 보존된다', () => {
  const got = pickAffiliateUrl(brand({ affiliate_url_korea: KR_LINK }), 'US');
  assert.ok(/women%2Fdesigners%2Fprada/.test(got), got);
});

it('변환은 멱등이다 (이미 US 링크를 US 로 변환해도 그대로)', () => {
  const once = localizeAffiliateUrl(KR_LINK, 'US');
  assert.strictEqual(localizeAffiliateUrl(once, 'US'), once);
});

console.log('\n=== 안전 규칙 ===');

it('마이테레사가 아닌 링크는 손대지 않는다 (다른 네트워크 보호)', () => {
  ['KR', 'US', 'EU', 'GLOBAL'].forEach((r) => {
    assert.strictEqual(localizeAffiliateUrl(OTHER_NETWORK, r), OTHER_NETWORK);
  });
});

it('우리가 모르는 MID 는 건드리지 않는다', () => {
  const unknown = 'https://click.linksynergy.com/deeplink?id=x&mid=99999&murl=https%3A%2F%2Fwww.mytheresa.com%2Fkr%2Fko%2Fa';
  assert.ok(/mid=99999/.test(localizeAffiliateUrl(unknown, 'US')), '모르는 MID 를 덮어썼다');
});

it('affiliate_url_global 이 있으면 그쪽을 우선한다 (관리자 수동 지정 존중)', () => {
  const b = brand({ affiliate_url_korea: KR_LINK, affiliate_url_global: OTHER_NETWORK });
  assert.strictEqual(pickAffiliateUrl(b, 'US'), OTHER_NETWORK);
});

it('빈 값·null 에 throw 하지 않는다', () => {
  assert.strictEqual(localizeAffiliateUrl('', 'US'), '');
  assert.strictEqual(localizeAffiliateUrl(null, 'EU'), '');
});

it('링크 없음 → null (호출부가 인스타그램 폴백으로 넘어간다)', () => {
  const b = brand({ affiliate_url_korea: null, affiliate_url_global: null });
  ['KR', 'US', 'EU', 'GLOBAL'].forEach((r) => {
    assert.strictEqual(pickAffiliateUrl(b, r), null);
  });
});

it('빈 문자열은 링크 없음으로 취급', () => {
  const b = brand({ affiliate_url_korea: '', affiliate_url_global: '' });
  assert.strictEqual(pickAffiliateUrl(b, 'US'), null);
});

it('brand 자체가 null → null (throw 하지 않는다)', () => {
  assert.strictEqual(pickAffiliateUrl(null, 'KR'), null);
  assert.strictEqual(pickAffiliateUrl(undefined, 'EU'), null);
});

console.log('\n=== 수수료 제외 브랜드 → 인스타그램 폴백 ===');

it('Adidas · Nike · New Balance · On 은 어느 지역에서도 null', () => {
  ['ADIDAS', 'Nike', 'New Balance', 'NEWBALANCE', 'On', 'ON'].forEach((name) => {
    const b = { brand_id: name.toLowerCase(), display_name: name, affiliate_url_korea: KR_LINK };
    ['KR', 'US', 'EU', 'GLOBAL'].forEach((r) => {
      assert.strictEqual(pickAffiliateUrl(b, r), null, name + ' (' + r + ') 이 링크를 받았다');
    });
  });
});

it('부분일치로 잘못 걸리지 않는다 (ONITSUKA·NIKELAB 등은 정상 브랜드)', () => {
  ['ONITSUKATIGER', 'NIKELAB', 'ADIDASORIGINALS_X', 'BALENCIAGA'].forEach((name) => {
    assert.strictEqual(isNonCommissionable({ display_name: name }), false, name + ' 오분류');
  });
});

it('표기 흔들림을 흡수한다 (new_balance / new-balance / New Balance)', () => {
  ['new_balance', 'new-balance', 'New Balance', 'NEW  BALANCE'].forEach((name) => {
    assert.strictEqual(isNonCommissionable({ display_name: name }), true, name + ' 를 못 잡았다');
  });
});

// ── 소스 레벨 가드 ───────────────────────────────────────────────────────
console.log('\n=== 소스 가드: api/go/[id].js ===');

const goSrc = fs.readFileSync(path.join(ROOT, 'api/go/[id].js'), 'utf8');

it('[id].js 는 _lib/affiliateUrl 에서 가져온다', () => {
  assert.ok(/require\(['"]\.\.\/_lib\/affiliateUrl['"]\)/.test(goSrc));
});

it('[id].js 안에 pickAffiliateUrl 을 재정의하지 않는다', () => {
  assert.ok(!/function\s+pickAffiliateUrl/.test(goSrc),
    'pickAffiliateUrl 이 다시 정의됐다 — _lib 버전만 써야 한다');
});

it('국가→지역 매핑을 [id].js 안에서 다시 만들지 않는다', () => {
  assert.ok(/regionFromCountry/.test(goSrc),
    '_lib 의 regionFromCountry 를 쓰지 않는다 — 매핑이 두 곳으로 갈라지면 어긋난다');
  assert.ok(!/country\s*===\s*'KR'\s*\?/.test(goSrc),
    '구형 이분 판정(KR ? : GLOBAL)이 남아 있다');
});

it('브랜드 조회가 제외 판정에 필요한 컬럼을 가져온다', () => {
  assert.ok(/brand_id/.test(goSrc) && /display_name/.test(goSrc));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
