/**
 * 확장전략55 Ⅱ·Ⅲ 잔여분 가드 (2026-08-27)
 * Ⅱ-18 Person 엔티티 · Ⅱ-23 RSS 풀텍스트 · Ⅱ-24 llms-full.txt · Ⅱ-25 공개 JSON API
 * Ⅲ-31 편집·정정 정책
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const renderer = rd('api/_lib/seoRenderer.js');
const rss = rd('api/rss.js');
const llmsFull = rd('api/llms-full.js');
const pubApi = rd('api/public-content.js');
const policy = rd('frontend/editorial-policy.html');
const vercel = JSON.parse(rd('vercel.json'));
const sitemap = rd('api/sitemap.js');
const llms = rd('frontend/llms.txt');

console.log('=== Ⅱ-18 Person 엔티티 ===');
t('extractPersonEntities 존재 + instagram → sameAs',
  /function extractPersonEntities/.test(renderer) && /instagram\.com\/' \+ ig/.test(renderer));
t('핸들 검증 (임의 문자열을 URL 로 만들지 않는다)', /\[A-Za-z0-9._\]\{1,60\}/.test(renderer));
t('author 와 이미지 creator 에 Person 엔티티 사용',
  /author: personEntities\.length/.test(renderer) && /imgCreator = personEntities\.length/.test(renderer));
t('roles → jobTitle', /jobTitle/.test(renderer));

console.log('\n=== Ⅱ-23 RSS 풀텍스트 ===');
t('content:encoded + content 네임스페이스',
  /content:encoded/.test(rss) && /xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/.test(rss));
t('CDATA 이스케이프 (]]> 분할)', /\]\]>/.test(rss) && /split\(']\]>'\)/.test(rss));
t('크기 상한 (피드 폭주 방지)', /40000/.test(rss));
t('기사 content 를 select 에 포함', /custom_url, published_date, description, content,/.test(rss));

console.log('\n=== Ⅱ-24 llms-full.txt ===');
t('라우트 (/llms-full.txt → /api/llms-full)',
  (vercel.rewrites || []).some(r => r.source === '/llms-full.txt' && r.destination === '/api/llms-full'));
t('발행 콘텐츠 verbatim 만 — 생성 호출 없음',
  !/anthropic\.com/.test(llmsFull) && /eq\('status', 'published'\)/.test(llmsFull));
t('전체 상한 + 캐시', /400000/.test(llmsFull) && /s-maxage=3600/.test(llmsFull));
t('llms.txt 에서 참조', /llms-full\.txt/.test(llms));

console.log('\n=== Ⅱ-25 공개 JSON API ===');
t('라우트 (/api/public/content.json)',
  (vercel.rewrites || []).some(r => r.source === '/api/public/content.json'));
t('본문·비공개 필드 미노출 (메타데이터만)',
  !/content/.test(pubApi.match(/from\('articles'\)[\s\S]*?limit\(50\)/)[0])
  && /published'\)/.test(pubApi));
t('CORS 개방 + 캐시 + 저작권 고지',
  /Access-Control-Allow-Origin/.test(pubApi) && /s-maxage=3600/.test(pubApi) && /editorial-policy/.test(pubApi));

console.log('\n=== Ⅲ-31 편집·정정 정책 ===');
t('정책 페이지 4대 섹션 (편집·광고·AI·정정) + 이미지 사용',
  /id="editorial"/.test(policy) && /id="ads"/.test(policy) && /id="ai"/.test(policy)
  && /id="corrections"/.test(policy) && /id="images"/.test(policy));
t('AI 활용 고지 — 최종 판단은 사람', /최종 판단은 항상 편집부/.test(policy));
t('정정 접수 경로 명시', /contact@pap-magazine\.com/.test(policy));
t('라우트 + 사이트맵 + llms.txt',
  (vercel.rewrites || []).some(r => r.source === '/editorial-policy')
  && /['"]\/editorial-policy['"]/.test(sitemap) && /editorial-policy/.test(llms));
t('Organization 스키마에 publishingPrinciples·correctionsPolicy',
  /publishingPrinciples: SITE \+ '\/editorial-policy'/.test(renderer)
  && /correctionsPolicy: SITE \+ '\/editorial-policy#corrections'/.test(renderer));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ geo-schema-trust tests passed');
