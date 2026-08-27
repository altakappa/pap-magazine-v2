/**
 * 화보 이미지 미리보기 2장 (2026-08-27 도메니코 결정)
 *
 * 왜 이 테스트가 있는가
 *   열람 게이트(editorialAccess)는 2026-08-21 에 만들어졌는데, 정작 사람이
 *   실제로 타는 경로인 SSR(/editorial/:slug → api/seo/editorial/[slug].js)에는
 *   그 게이트를 부르는 코드가 없었다. 그래서 **한 달 넘게 비회원이 모든 화보를
 *   전부 봤다.** JSON API 만 잠겨 있었고 그건 아무도 안 지나가는 문이었다.
 *
 *   같은 사고를 다시 내지 않으려면 "함수가 옳게 동작한다"만으로는 부족하다.
 *   **호출부가 그 함수를 실제로 부르는지**를 고정해야 한다. 아래 ②가 그것이다.
 *
 * 규칙: 전체 이미지는 스탠다드부터. 그 아래는 언제나 앞 2장.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test';

const ed = require(path.join(ROOT, 'api/_lib/editorialAccess.js'));
const { renderSeoHtml } = require(path.join(ROOT, 'api/_lib/seoRenderer.js'));

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

const G13 = Array.from({ length: 13 }, (_, i) => 'https://cdn.test/' + i + '.jpg');
const NOW = new Date();
const thisQuarter = new Date(Date.UTC(NOW.getUTCFullYear(), Math.floor(NOW.getUTCMonth() / 3) * 3, 1));
const RECENT = thisQuarter.toISOString().slice(0, 10);        // 스탠다드 창 안
const OLD = '2020-01-01';                                      // 창 밖
const rec = (id, pd, gallery) => ({ id, slug: 's-' + id, title: '테스트 화보',
  published_date: pd, gallery: gallery || G13, tags: ['mood'] });

console.log('\n=== ① 등급별 이미지 수 ===');
t('비회원·무료 회원은 어떤 화보든 2장', () => {
  for (const tier of ['anon', 'free']) {
    for (const pd of [RECENT, OLD]) {
      const out = ed.shapeGallery(rec('a', pd), tier);
      assert.strictEqual(out.gallery.length, 2, tier + '/' + pd);
      assert.strictEqual(out.locked, true);
    }
  }
});
t('스탠다드는 자기 창 안은 전체, 밖은 2장', () => {
  assert.strictEqual(ed.shapeGallery(rec('b', RECENT), 'standard').gallery.length, 13);
  assert.strictEqual(ed.shapeGallery(rec('c', OLD), 'standard').gallery.length, 2);
});
t('프리미엄·관리자는 전부', () => {
  for (const tier of ['premium', 'admin']) {
    assert.strictEqual(ed.shapeGallery(rec('d', OLD), tier).gallery.length, 13);
    assert.strictEqual(ed.shapeGallery(rec('d', OLD), tier).locked, false);
  }
});
t('이미지가 2장 이하인 화보는 잠기지 않는다 (실측 34편)', () => {
  const out = ed.shapeGallery(rec('e', OLD, ['x.jpg', 'y.jpg']), 'anon');
  assert.strictEqual(out.locked, false, '잘릴 것이 없는데 패널을 띄우면 거짓말이 된다');
});
t('총 장수는 잠겨도 알려준다 (무엇을 놓치는지 보여야 가입 이유가 생긴다)', () => {
  assert.strictEqual(ed.shapeGallery(rec('f', OLD), 'anon').gallery_count, 13);
});
t('미리보기 장수가 상수 한 곳에서 온다', () => {
  assert.strictEqual(ed.PREVIEW_IMAGES, 2);
  const src = read('api/_lib/editorialAccess.js');
  assert.ok(/PREVIEW_IMAGES = Number\(process\.env\.EDITORIAL_PREVIEW_IMAGES \|\| 2\)/.test(src),
    '숫자를 여러 곳에 박으면 화면과 서버가 갈린다');
});

console.log('\n=== ② SSR 호출부 (2026-08 사고 재발 방지) ===');
t('SSR 핸들러가 실제로 미리보기 제한을 넘긴다', () => {
  const src = read('api/seo/editorial/[slug].js');
  assert.ok(/PREVIEW_IMAGES/.test(src) && /galleryLimit/.test(src),
    'SSR 이 제한을 안 넘기면 게이트가 있어도 아무도 안 잠긴다 — 실제로 그랬다');
  assert.ok(/require\('\.\.\/\.\.\/_lib\/editorialAccess'\)/.test(src),
    '자체 숫자를 쓰지 말고 editorialAccess 의 상수를 쓸 것');
});

console.log('\n=== ③ SSR 렌더 결과 ===');
const LOCKED = renderSeoHtml('editorial', rec('g0', RECENT), { lang: 'ko', galleryLimit: 2 });
const FULL = renderSeoHtml('editorial', rec('g0', RECENT), { lang: 'ko' });
const imgCount = (h) => (((h.match(/class="seo-gallery"[\s\S]*?<\/section>/) || [''])[0]).match(/<img /g) || []).length;

t('제한을 주면 2장만 그린다', () => assert.strictEqual(imgCount(LOCKED), 2));
t('제한이 없으면 전부 그린다 (관리자 미리보기 등)', () => assert.strictEqual(imgCount(FULL), 13));
t('잘린 경우에만 잠금 패널이 붙는다', () => {
  assert.ok(/<section class="seo-gallery-locked"/.test(LOCKED));
  assert.ok(!/<section class="seo-gallery-locked"/.test(FULL));
});
t('패널이 남은 장수와 다음 행동을 말한다', () => {
  assert.ok(/11장이 더 있습니다/.test(LOCKED), '몇 장이 남았는지 안 알려주면 가입할 이유가 약해진다');
  assert.ok(/utm_source=editorial_gallery_lock/.test(LOCKED), '전환을 재지 않으면 효과를 알 수 없다');
});
t('안 보이는 이미지가 구조화 데이터로 새지 않는다', () => {
  const shown = ((LOCKED.match(/"image":\[[^\]]*\]/) || [''])[0].match(/https/g) || []).length;
  const all = ((FULL.match(/"image":\[[^\]]*\]/) || [''])[0].match(/https/g) || []).length;
  assert.ok(shown < all, '화면엔 2장인데 스키마엔 전부면 색인과 화면이 어긋난다');
});
t('페이월 마크업이 정확하다 (구글 규격)', () => {
  assert.ok(/"isAccessibleForFree":false/.test(LOCKED), '잠갔으면 무료라고 말하지 않는다');
  assert.ok(/"isAccessibleForFree":true/.test(FULL));
  const hp = (LOCKED.match(/"hasPart":\{[^}]*\}/) || [''])[0];
  assert.ok(/seo-gallery-locked/.test(hp), 'hasPart 의 cssSelector 가 실제 패널 클래스와 같아야 한다');
});
t('잠금 문구가 9개 언어에 있다', () => {
  const src = read('api/_lib/seoRenderer.js');
  ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'de', 'ru'].forEach((lg) => {
    assert.ok(new RegExp('\\n    ' + lg + ': \\{[\\s\\S]{0,600}?headStandard:').test(src), lg + ' 문구가 없다');
  });
});
t('오래된 화보는 프리미엄 문구, 최신 화보는 스탠다드 문구', () => {
  const old = renderSeoHtml('editorial', rec('g1', OLD), { lang: 'ko', galleryLimit: 2 });
  assert.ok(/PREMIUM 멤버부터/.test(old), old.match(/sgl-head">([^<]*)</) || '');
  assert.ok(/STANDARD 멤버부터/.test(LOCKED));
});

console.log('\n=== ④ 상세 API 와 SPA ===');
t('상세 API 가 images 블록(보인 장수·전체·필요 등급)을 내려준다', () => {
  const src = read('api/editorials/[id].js');
  assert.ok(/shapeGallery/.test(src), '이미지 컷을 적용하지 않는다');
  assert.ok(/images:\s*\{/.test(src) && /required_tier/.test(src));
});
t('열람 판정(canView)은 건드리지 않았다 — 다운로드 게이트가 딸려 바뀌면 안 된다', () => {
  const src = read('api/editorials/[id].js');
  assert.ok(/edAccess\.canView\(tier, data/.test(src), 'canView 를 없애면 다운로드 버튼 판정이 같이 죽는다');
});
t('SPA 가 access.allowed 가 아니라 images.locked 로 판단한다', () => {
  const src = read('frontend/pap-content-editorial.js');
  assert.ok(/_img \? !!_img\.locked/.test(src),
    '열람 허용과 이미지 잠금은 기준이 다르다 (무료 회원은 열람 허용이지만 이미지는 2장)');
});
t('SPA 잠금 패널이 미리보기 이미지를 지우지 않는다', () => {
  const src = read('frontend/pap-content-editorial.js');
  const fn = src.slice(src.indexOf('function _papEdApplyLock'), src.indexOf('function _editorialTitleToSlug'));
  assert.ok(/insertAdjacentHTML\('beforeend'/.test(fn), '패널은 이미지 뒤에 붙여야 한다');
  assert.ok(!/det\.images = \[\]/.test(fn), '이미지를 비우면 앞 2장도 사라진다');
});
t('SPA 도 utm 을 붙인다 (SSR 과 같은 이름)', () => {
  assert.ok(/utm_source=editorial_gallery_lock/.test(read('frontend/pap-content-editorial.js')));
});

console.log('\n화보 미리보기: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
if (fail) process.exit(1);
