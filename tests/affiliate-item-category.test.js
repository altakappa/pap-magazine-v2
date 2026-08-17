/**
 * 2단계 상품매칭 (2026-08-17, 도메니코 승인: "지금 2단계, 최종 4단계").
 *
 * 크레딧의 품목 단어("@ralphlauren Top")를 마이테레사 designer 딥링크의
 * 카테고리 경로로 변환한다. 실패 모드는 항상 "원본 그대로"(1단계 동작) —
 * 이 성질이 깨지면 리다이렉터가 깨진 URL 을 만들 수 있으므로 회귀 필수.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const {
  applyItemCategory, normalizeItemWord, ITEM_CATEGORY_PATHS,
} = require('../api/_lib/affiliateUrl');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const BASE = 'https://click.linksynergy.com/deeplink?id=xaC5X1voYF4&mid=43172&u1=acnestudios&murl=https%3A%2F%2Fwww.mytheresa.com%2Fint%2Fen%2Fwomen%2Fdesigners%2Facne-studios';

console.log('\n=== applyItemCategory 단위 ===');
const dress = applyItemCategory(BASE, 'Dress');
t('dress → murl 에 %2Fclothing%2Fdresses 가 붙는다',
  dress.includes('designers%2Facne-studios%2Fclothing%2Fdresses'), dress);
t('dress → u1 서브ID 에 -dress 가 붙는다 (라쿠텐 품목별 귀속)',
  /[?&]u1=acnestudios-dress&/.test(dress + '&'), dress);
t('shoes → 최상위 카테고리 %2Fshoes', applyItemCategory(BASE, 'shoes').includes('acne-studios%2Fshoes'));
t('shirt → tops 로 흡수 (실측: shirts 하위 경로 미검증)',
  applyItemCategory(BASE, 'Shirt').includes('%2Fclothing%2Ftops'));
t('모르는 품목(makeup) → 원본 그대로', applyItemCategory(BASE, 'makeup') === BASE);
t('빈 품목 → 원본 그대로', applyItemCategory(BASE, '') === BASE);
t("프로토타입 이름(constructor) → 원본 그대로 (hasOwnProperty 가드)",
  applyItemCategory(BASE, 'constructor') === BASE);
t('마이테레사가 아닌 링크 → 원본 그대로',
  applyItemCategory('https://example.com/designers/acne-studios', 'dress') === 'https://example.com/designers/acne-studios');
const deep = BASE + '%2Fclothing';
t('이미 카테고리가 붙은 murl → 더 붙이지 않는다', applyItemCategory(deep, 'dress') === deep);
const plain = 'https://www.mytheresa.com/int/en/women/designers/acne-studios';
t('비인코딩(수동 입력) 링크도 경로가 붙는다',
  applyItemCategory(plain, 'dress') === plain + '/clothing/dresses');
t('normalizeItemWord: "T-Shirt " → tshirt', normalizeItemWord('T-Shirt ') === 'tshirt');
t('맵의 clothing 하위 경로는 실측 8종만 쓴다 (미검증 경로 금지)',
  Object.values(ITEM_CATEGORY_PATHS).every(p =>
    ['clothing','shoes','bags','accessories'].includes(p) ||
    /^clothing\/(dresses|jackets|jeans|knitwear|pants|shorts|skirts|tops)$/.test(p)));

console.log('\n=== 배선 회귀 (SSR·SPA·리다이렉터) ===');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const go = rd('api/go/[id].js');
t('/go 가 ?item= 을 affiliate 목적지에만 적용한다',
  /destType === 'affiliate' && req\.query\.item/.test(go) && /applyItemCategory\(dest/.test(go));
const ssr = rd('api/_lib/seoRenderer.js');
t('SSR 칩이 ?item= 을 전달한다', /extractBrandItems/.test(ssr) && /\?item=/.test(ssr));
t('SSR 품목 게이트가 서버 맵을 쓴다 (표시-매핑 불일치 방지)',
  /hasOwnProperty\.call\(ITEM_CATEGORY_PATHS/.test(ssr));
const spa = rd('frontend/pap-content-editorial.js');
t('SPA 칩이 ?item= 을 전달한다', /_papShopItems/.test(spa) && /'\?item='/.test(spa));
t('SPA 화이트리스트가 서버 맵의 부분집합이다',
  (() => {
    const m = spa.match(/var _PAP_SHOP_ITEMS=\{([^}]+)\}/);
    if (!m) return false;
    return m[1].split(',').map(x => x.split(':')[0].trim()).every(k =>
      Object.prototype.hasOwnProperty.call(ITEM_CATEGORY_PATHS, k));
  })());
t('SPA 콜사이트가 imageCredits 를 넘긴다',
  (spa.match(/_papRenderShopRow\(det\.fashion, det\.imageCredits\)/g) || []).length === 2);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ affiliate-item-category tests FAILED'); process.exit(1); }
