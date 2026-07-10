/**
 * Paddle Local Prices 일괄 설정 스크립트
 *
 * 웹사이트에 고정된 통화별 가격을 Paddle Live catalog의 4개 Price에
 * unit_price_overrides로 전부 반영합니다. 실행하면 각 Price가 KR/JP/CN/RU/GB
 * 및 유로존 20개국에 대해 fixed price 를 갖게 됩니다.
 *
 * 사용법:
 *   PADDLE_API_KEY=live_xxxxx node scripts/paddle-set-local-prices.js
 *   PADDLE_API_KEY=live_xxxxx node scripts/paddle-set-local-prices.js --dry-run
 *
 * API Key 발급:
 *   Paddle Dashboard > Developer > Authentication > API keys > Create new key (Live)
 *
 * 주의:
 *   - live_ 접두사 확인 (test_ 는 sandbox 계정)
 *   - API key 는 절대 커밋하지 마세요 (env 로만 전달)
 */

const https = require('https');
const readline = require('readline');

const DRY_RUN = process.argv.includes('--dry-run');

async function promptApiKey() {
  if (process.env.PADDLE_API_KEY) return process.env.PADDLE_API_KEY;

  // 프롬프트를 즉시 stdout 에 씀 (마스킹 로직이 이걸 삼키지 않도록 readline 밖에서)
  process.stdout.write('\nPaddle API key 를 Cmd+V 로 붙여넣고 Enter\n');
  process.stdout.write('(⚠️ 화면에 표시됩니다 — 이 창을 스크린샷 찍지 마세요)\n\n> ');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await new Promise((resolve) => {
    rl.on('line', (line) => resolve(line));
  });
  rl.close();
  console.log('');
  return String(answer || '').trim();
}

// main() 안에서 promptApiKey() 결과를 API_KEY 로 대입
let API_KEY = null;

// (환경 판별 및 로그 출력은 main() 안에서 API_KEY 확보 후 수행)
let BASE_URL = null;

// ============================================================
// 웹 가격 (subscribe.html PRICES 오브젝트와 동일)
// ============================================================
// Paddle amount 는 minor units 로 전달 (JPY/KRW 는 그대로, 나머지 ×100)
const PRICES = {
  'PAP STANDARD': {
    monthly: {
      USD: 599,   // $5.99
      KRW: 8500,  // ₩8,500
      EUR: 549,   // €5.49
      JPY: 890,   // ¥890
      CNY: 3990,  // 元39.9
      RUB: 59900, // ₽599
      GBP: 479,   // £4.79
    },
    yearly: {
      USD: 4999,   // $49.99
      KRW: 85000,  // ₩85,000
      EUR: 4599,   // €45.99
      JPY: 7400,   // ¥7,400
      CNY: 33900,  // 元339
      RUB: 499900, // ₽4,999
      GBP: 3999,   // £39.99
    },
  },
  'PAP PREMIUM': {
    monthly: {
      USD: 949,   // $9.49
      KRW: 13500, // ₩13,500
      EUR: 899,   // €8.99
      JPY: 1400,  // ¥1,400
      CNY: 6590,  // 元65.9
      RUB: 94900, // ₽949
      GBP: 779,   // £7.79
    },
    yearly: {
      USD: 7999,   // $79.99
      KRW: 135000, // ₩135,000
      EUR: 7499,   // €74.99
      JPY: 11800,  // ¥11,800
      CNY: 54900,  // 元549
      RUB: 799900, // ₽7,999
      GBP: 6499,   // £64.99
    },
  },
};

// ============================================================
// 통화 → 국가코드 매핑
// ============================================================
const EUROZONE = [
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
];

const CURRENCY_COUNTRIES = {
  KRW: ['KR'],
  JPY: ['JP'],
  CNY: ['CN'],
  RUB: ['RU'],
  GBP: ['GB'],
  EUR: EUROZONE,
  // USD 는 base price 라 override 안 함 (나머지 국가 = USD 자동 변환)
};

// ============================================================
// Paddle API 호출 헬퍼
// ============================================================
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: BASE_URL,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          if (res.statusCode >= 400) {
            reject(new Error(`${method} ${path} → ${res.statusCode}: ${JSON.stringify(parsed.error || parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`${method} ${path} → ${res.statusCode}: ${raw.slice(0, 400)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ============================================================
// 메인
// ============================================================
async function main() {
  // 0. API key 확보 + 환경 판별
  API_KEY = await promptApiKey();
  if (!API_KEY) {
    console.error('❌ API key 가 입력되지 않았습니다.');
    process.exit(1);
  }
  const isLive = /^(pdl_live|live_)/i.test(API_KEY);
  const isSandbox = /^(pdl_sdbx|test_)/i.test(API_KEY);
  if (!isLive && !isSandbox) {
    console.error(`❌ API key 접두사를 인식하지 못했습니다. 앞부분: "${API_KEY.slice(0, 12)}…"`);
    console.error('   Live 키는 pdl_live_ 로, Sandbox 키는 pdl_sdbx_ 로 시작합니다.');
    process.exit(1);
  }
  BASE_URL = isLive ? 'api.paddle.com' : 'sandbox-api.paddle.com';
  console.log(`ℹ️  ${isLive ? 'LIVE' : 'SANDBOX'} 환경 — ${BASE_URL}`);
  if (DRY_RUN) console.log('🧪 DRY RUN — 실제 업데이트하지 않음');

  // 1. 상품 목록 조회
  console.log('\n1️⃣  상품 목록 조회…');
  const products = await apiRequest('GET', '/products?status=active&per_page=100');
  const targets = products.data.filter((p) => /pap\s*(standard|premium)/i.test(p.name));
  console.log(`   찾은 상품: ${targets.map((p) => p.name).join(', ')}`);
  if (targets.length !== 2) {
    console.error(`❌ PAP STANDARD + PAP PREMIUM 2개 상품이 필요합니다. (찾음: ${targets.length}개)`);
    process.exit(1);
  }

  // 2. 각 상품의 Prices 조회
  console.log('\n2️⃣  각 상품의 Prices 조회…');
  for (const product of targets) {
    const prices = await apiRequest('GET', `/prices?product_id=${product.id}&status=active&per_page=100`);
    product.prices = prices.data;
    console.log(`   ${product.name}: ${prices.data.length}개 Price`);
    for (const pr of prices.data) {
      console.log(`     - ${pr.id} | ${pr.billing_cycle?.interval || '?'} | ${pr.unit_price.amount} ${pr.unit_price.currency_code}`);
    }
  }

  // 3. 각 Price 에 unit_price_overrides + base amount 조정
  console.log('\n3️⃣  Price 업데이트…');
  for (const product of targets) {
    const priceMap = PRICES[product.name.toUpperCase().replace(/\s+/g, ' ').trim()]
      || PRICES[Object.keys(PRICES).find((k) => k.toLowerCase() === product.name.toLowerCase())];
    if (!priceMap) {
      console.error(`   ⚠️  가격 매핑 없음: "${product.name}" — 스킵`);
      continue;
    }
    for (const pr of product.prices) {
      const interval = pr.billing_cycle?.interval;
      const period = interval === 'year' ? 'yearly' : interval === 'month' ? 'monthly' : null;
      if (!period) {
        console.log(`   ⚠️  ${pr.id}: interval 알 수 없음 (${interval}) — 스킵`);
        continue;
      }
      const targetPrices = priceMap[period];
      const usdAmount = String(targetPrices.USD);

      // unit_price_overrides 배열 생성 (USD 제외한 통화들)
      const overrides = [];
      for (const [currency, countries] of Object.entries(CURRENCY_COUNTRIES)) {
        if (!targetPrices[currency]) continue;
        overrides.push({
          country_codes: countries,
          unit_price: {
            amount: String(targetPrices[currency]),
            currency_code: currency,
          },
        });
      }

      const body = {
        unit_price: {
          amount: usdAmount,
          currency_code: 'USD',
        },
        unit_price_overrides: overrides,
      };

      console.log(`\n   ${product.name} / ${period}: USD ${usdAmount} + ${overrides.length}개 통화 override`);
      overrides.forEach((o) => {
        console.log(`     - ${o.unit_price.amount} ${o.unit_price.currency_code} → ${o.country_codes.length}개 국가 (${o.country_codes.slice(0, 3).join(',')}${o.country_codes.length > 3 ? '...' : ''})`);
      });

      if (DRY_RUN) {
        console.log(`   🧪 dry-run — PATCH /prices/${pr.id} 스킵`);
      } else {
        await apiRequest('PATCH', `/prices/${pr.id}`, body);
        console.log(`   ✅ ${pr.id} 업데이트 완료`);
      }
    }
  }

  console.log('\n🎉 완료');
  console.log('   Paddle 대시보드 > Catalog > Products 에서 각 Price 의');
  console.log('   Country specific prices 컬럼 확인해 주세요.');
}

main().catch((err) => {
  console.error('\n❌ 실행 실패:', err.message);
  process.exit(1);
});
