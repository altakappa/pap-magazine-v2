/**
 * fashion 크레딧 파서 회귀 (2026-07-29, GEO 감사).
 *
 * 배경: editorials.fashion 에 두 형태가 섞여 있는데 브랜드 링크(SSR)와
 * brand-sync 크론이 신형만 읽고 있었다.
 *   신형 { brands:[{name,instagram}] } 105건 / 구형 [{n,id}] 2,373건 (실측)
 * 그래서 실제 브랜드 크레딧을 가진 발행 기사 788건, 고유 브랜드 4,970개
 * (brands 미등록 1,475개)가 링크·등록 대상에서 통째로 빠져 있었다.
 *
 * 더미 크레딧 [{"n":"Brand","id":"@brand"}] 1,559건도 함께 걸러야 한다 —
 * 안 걸르면 /brand/brand 가짜 페이지가 생기고 모든 기사가 그것을 가리킨다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseBrandCredits, toBrandId } = require('../api/_lib/fashionCredits');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d){ if(cond){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }
const ids = (x) => parseBrandCredits(x).map(b => b.id);

console.log('\n=== 두 형태 모두 파싱 ===');
t('구형 배열 [{n,id}] — 이게 다수(2,373건)인데 여태 무시됐다',
  JSON.stringify(ids([{ n: 'Isseymiyakeofficial', id: '@isseymiyakeofficial' }, { n: 'Prada', id: '@prada' }]))
  === JSON.stringify(['isseymiyakeofficial', 'prada']));
t('신형 오브젝트 { brands:[{name,instagram}] }',
  JSON.stringify(ids({ brands: [{ name: 'CONSTASY', instagram: '@constasy' }] })) === JSON.stringify(['constasy']));
t('문자열로 저장된 JSON 도 파싱', JSON.stringify(ids(JSON.stringify([{ n: 'Zara', id: '@zara' }]))) === JSON.stringify(['zara']));
t('null·빈값·깨진 JSON 은 빈 배열',
  ids(null).length === 0 && ids('').length === 0 && ids('{not json').length === 0 && ids(undefined).length === 0);

console.log('=== 더미 크레딧 차단 (초기 임포트 잔재 1,559건) ===');
t('[{n:"Brand",id:"@brand"}] 은 0건', ids([{ n: 'Brand', id: '@brand' }]).length === 0);
t('표기명만 "Brand" 인 경우도 제외', ids([{ n: 'Brand', id: '@brand' }, { n: 'Prada', id: '@prada' }]).length === 1);
t('/brand/brand 가짜 페이지가 생기지 않는다', !ids([{ n: 'Brand', id: '@brand' }]).includes('brand'));

console.log('=== 핸들 정규화 ===');
t('@ 제거', toBrandId('@prada') === 'prada');
t('인스타 URL → 핸들', toBrandId('https://www.instagram.com/miumiu/') === 'miumiu');
t('대문자 → 소문자', toBrandId('@ZARA') === 'zara');
t('밑줄·마침표 핸들 허용', toBrandId('@2ndstreet_official') === '2ndstreet_official' && toBrandId('@neith.tokyo') === 'neith.tokyo');
t('한글 표기·공백은 제외 (브랜드 페이지가 없다)', toBrandId('꼼데가르송') === '' && toBrandId('Comme des') === '');
t('1자 핸들 제외', toBrandId('@a') === '');

console.log('=== 이름 폴백 금지 (2026-07-28 a2ff820 규칙 유지) ===');
t('핸들 없이 표기명만 있으면 등록하지 않는다',
  ids({ brands: [{ name: 'VINTAGE' }] }).length === 0,
  '이름으로 핸들을 지어내면 크레딧 상용어(vintage·via·edition)가 브랜드 페이지가 된다');
t('구형에서도 동일 — id 없으면 제외', ids([{ n: 'Edition' }]).length === 0);

console.log('=== 중복 제거 ===');
t('대소문자만 다른 핸들은 1건', ids([{ n: 'A', id: '@zara' }, { n: 'B', id: '@ZARA' }]).length === 1);

console.log('=== 호출부가 공용 파서를 쓴다 ===');
const ssr = R('api/seo/editorial/[slug].js');
const cron = R('api/cron/brand-sync.js');
t('editorial SSR 이 parseBrandCredits 사용', /parseBrandCredits\(data\.fashion\)/.test(ssr));
t('brand-sync 크론이 parseBrandCredits 사용', /parseBrandCredits\(row\.fashion\)/.test(cron));
t('구형 전용 파서(parseFashion)는 제거됨', !/function parseFashion/.test(cron));

/* 얇은 페이지 방지 (2026-07-29): 구형 크레딧까지 읽으면 미등록 브랜드가 1,475개가
 * 되는데 그중 1,246개가 한 편에만 등장한다(실측). 그대로 등록하면 항목 1개짜리
 * 페이지를 1,246개 만드는 셈이고, 이는 구글 scaled content abuse 정책의 표적이자
 * Ahrefs 가 이미 /brand/* 1,359건을 orphan 으로 잡던 문제를 키우는 일이다. */
console.log('=== 얇은 브랜드 페이지 방지 게이트 ===');
t('brand-sync 에 최소 등장 편수 기준이 있다', /MIN_EDITORIALS = 2/.test(cron));
t('등장 편수를 세어 게이트에 쓴다',
  /v\.count >= MIN_EDITORIALS/.test(cron) && /cur\.count \+= 1/.test(cron));
t('응답에 scanned 와 eligible 을 구분해 보고', /eligible: ids\.length/.test(cron));
// 게이트 동작 재현 — 한 편짜리·더미는 등록 대상에서 빠지고 2편짜리만 남는다
(function(){
  const rows = [
    { fashion: [{ n: 'Prada', id: '@prada' }, { n: 'Solo', id: '@onlyonce' }] },
    { fashion: [{ n: 'Prada', id: '@prada' }] },
    { fashion: [{ n: 'Brand', id: '@brand' }] },
  ];
  const cand = new Map();
  rows.forEach(r => parseBrandCredits(r.fashion).forEach(b => {
    const c = cand.get(b.id); if (c) c.count++; else cand.set(b.id, { name: b.name, count: 1 });
  }));
  const eligible = [...cand.entries()].filter(([, v]) => v.count >= 2).map(([id]) => id);
  t('2편 이상만 등록 대상', JSON.stringify(eligible) === JSON.stringify(['prada']));
  t('한 편짜리는 제외 (나중에 한 편 더 실리면 자동 편입)', !eligible.includes('onlyonce'));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ fashion-credits tests FAILED'); process.exit(1); }
console.log('✅ fashion-credits tests passed');
