/**
 * 기사 설명 폴백 (2026-10-07).
 *
 * 발행 기사 2,425편이 seo_description·description_en 둘 다 비어 있어
 * RSS·llms-full 에서 설명이 빠졌다. 페이지 렌더러는 이미
 * 본문에서 설명을 조립하므로, 같은 descFromBody 를 두 곳에도 건다.
 * public-content 는 제외 — 본문을 아예 조회하지 않는 원칙(geo-schema-trust)을 지킨다.
 * DB 일괄 백필은 하지 않는다(updated_at → sitemap lastmod·IndexNow 흔들림,
 * seo_title 은 한국어 페이지 전용이라 영어로 채우면 오히려 퇴보).
 *
 * 지키는 것:
 *   ① 두 엔드포인트가 seo_description → description_en → 본문 순으로 폴백할 것
 *   ② 폴백에 필요한 content 를 select 할 것
 *   ③ public-content 는 본문을 조회하지 않을 것(기존 원칙 유지)
 *   ④ 수동 seo_description 이 있으면 그대로 우선할 것
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const { descFromBody } = require(path.join(ROOT, 'api/_lib/seoRenderer.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const FILES = ['api/rss.js', 'api/llms-full.js'];

for (const f of FILES) {
  const src = read(f);
  t(`${f}: descFromBody 를 seoRenderer 에서 가져온다`, () => {
    assert.match(src, /const \{ descFromBody \} = require\('\.\/_lib\/seoRenderer'\)/);
  });
  t(`${f}: seo_description → description_en → 본문 순 폴백`, () => {
    assert.match(src, /a\.seo_description \|\| a\.description_en \|\| descFromBody\(a\.content\)/);
  });
  t(`${f}: articles select 에 content 포함`, () => {
    const m = src.match(/from\('articles'\)[\s\S]*?\.select\('([^']+)'\)/);
    assert.ok(m, 'articles select 를 찾지 못함');
    assert.ok(m[1].split(',').map(s => s.trim()).includes('content'), m[1]);
  });
}

t('public-content: articles 에서 본문(content)을 조회하지 않는다', () => {
  const src = read('api/public-content.js');
  const m = src.match(/from\('articles'\)[\s\S]*?\.select\('([^']+)'\)/);
  assert.ok(m);
  assert.ok(!m[1].split(',').map(s => s.trim()).includes('content'), m[1]);
});

t('descFromBody: 한국어 HTML 본문에서 설명을 만든다', () => {
  const body = '<p>신민아가 오메가의 아이코닉 워치 컨스텔레이션 캠페인에 나섰다. 퍼플과 그린 다이얼을 착용해 클래식하면서도 현대적인 스타일을 완성했다.</p>';
  const d = descFromBody(body);
  assert.ok(d.length >= 40, d);
  assert.ok(!/[<>]/.test(d), d);
  assert.ok(d.startsWith('신민아가'), d);
});

t('descFromBody: 본문이 없으면 빈 문자열(폴백 체인이 undefined 로 떨어짐)', () => {
  assert.strictEqual(descFromBody(null), '');
  assert.strictEqual(descFromBody(''), '');
});

t('수동 seo_description 이 있으면 그것이 우선', () => {
  const a = { seo_description: '수동 설명', description_en: null, content: '<p>' + '본문 '.repeat(40) + '</p>' };
  assert.strictEqual(a.seo_description || a.description_en || descFromBody(a.content), '수동 설명');
});

console.log(`article-desc-fallback: ${n} passed`);
