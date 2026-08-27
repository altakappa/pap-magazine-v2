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
 * 규칙 (도메니코 2026-08-27): 자기 범위는 전체, 바로 다음 단계는 앞 2장,
 * 그 너머는 아예 안 열린다(클릭하면 팝업).
 *
 *              최신 10편    6개월 안     옛 화보
 *   비회원     preview      blocked     blocked
 *   무료 회원  full         preview     blocked
 *   스탠다드   full         full        preview
 *   프리미엄   full         full        full
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
const LATEST10 = new Set(['top']);          // 무료 회원 열람 범위(최신 10편)
const O = { freeIds: LATEST10 };

/* 표 전체를 한 번에 못박는다. 한 칸이라도 바뀌면 여기서 걸린다. */
const TABLE = {
  anon:     { top: 'preview', mid: 'blocked', old: 'blocked' },
  free:     { top: 'full',    mid: 'preview', old: 'blocked' },
  standard: { top: 'full',    mid: 'full',    old: 'preview' },
  premium:  { top: 'full',    mid: 'full',    old: 'full' },
  admin:    { top: 'full',    mid: 'full',    old: 'full' },
};
const PD = { top: RECENT, mid: RECENT, old: OLD };
const SHOWN = { full: 13, preview: 2, blocked: 0 };

t('등급 × 화보 표가 정확하다 (15칸 전부)', () => {
  Object.keys(TABLE).forEach((tier) => {
    Object.keys(TABLE[tier]).forEach((key) => {
      const want = TABLE[tier][key];
      const out = ed.shapeGallery(rec(key, PD[key]), tier, O);
      assert.strictEqual(out.view_state, want, tier + ' × ' + key + ' 가 ' + out.view_state);
      assert.strictEqual((out.gallery || []).length, SHOWN[want],
        tier + ' × ' + key + ' 이미지 수');
    });
  });
});
t('막힌 화보는 이미지를 한 장도 안 내려준다', () => {
  const out = ed.shapeGallery(rec('old', OLD), 'anon', O);
  assert.strictEqual((out.gallery || []).length, 0, '한 장이라도 새면 팝업의 의미가 없다');
  assert.strictEqual(out.locked_reason, 'tier-blocked');
});
t('바로 다음 단계까지만 맛보여 준다 (두 칸 위는 안 보여준다)', () => {
  assert.strictEqual(ed.viewState('anon', rec('mid', RECENT), O), 'blocked',
    '비회원에게 6개월치를 미리 보여주면 가입 이유가 흐려진다');
  assert.strictEqual(ed.viewState('free', rec('old', OLD), O), 'blocked');
});
t('잠긴 화보는 어느 등급이 필요한지 함께 말한다', () => {
  assert.strictEqual(ed.shapeGallery(rec('top', RECENT), 'anon', O).required_tier, 'free');
  assert.strictEqual(ed.shapeGallery(rec('mid', RECENT), 'free', O).required_tier, 'standard');
  assert.strictEqual(ed.shapeGallery(rec('old', OLD), 'standard', O).required_tier, 'premium');
});
t('등급 눈금을 두 벌로 만들지 않았다', () => {
  const src = read('api/_lib/editorialAccess.js');
  assert.ok(/REQUIRED_RANK\[requiredTierFor\(row, opts\)\]/.test(src),
    '필요 등급 판정은 requiredTierFor 하나만 쓴다');
});
t('미리보기 단계에서 이미지가 2장 이하면 잠기지 않는다 (실측 34편)', () => {
  const out = ed.shapeGallery(rec('top', RECENT, ['x.jpg', 'y.jpg']), 'anon', O);
  assert.strictEqual(out.view_state, 'preview');
  assert.strictEqual(out.locked, false, '잘릴 것이 없는데 패널을 띄우면 거짓말이 된다');
});
t('막힌 단계는 2장짜리 화보라도 열지 않는다', () => {
  const out = ed.shapeGallery(rec('old', OLD, ['x.jpg', 'y.jpg']), 'anon', O);
  assert.strictEqual(out.locked, true, '장수가 적다고 등급을 건너뛰면 규칙이 무너진다');
  assert.strictEqual((out.gallery || []).length, 0);
});
t('총 장수는 잠겨도 알려준다 (무엇을 놓치는지 보여야 다음 등급으로 갈 이유가 생긴다)', () => {
  assert.strictEqual(ed.shapeGallery(rec('f', OLD), 'anon', O).gallery_count, 13);
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
    const block = new RegExp('\\n    ' + lg + ': \\{[\\s\\S]{0,900}?\\n    \\},');
    const m = src.match(block);
    assert.ok(m, lg + ' 문구 블록이 없다');
    ['headFree', 'headStandard', 'headPremium', 'ctaFree'].forEach((k) => {
      assert.ok(m[0].indexOf(k + ':') > -1, lg + ' 에 ' + k + ' 가 없다');
    });
  });
});
t('필요 등급에 따라 문구와 링크가 갈린다', () => {
  const mk = (tier) => renderSeoHtml('editorial', rec('g1', RECENT), { lang: 'ko', galleryLimit: 2, lockTier: tier });
  assert.ok(/가입하면 전체 이미지를/.test(mk('free')));
  assert.ok(/STANDARD 멤버부터/.test(mk('standard')));
  assert.ok(/PREMIUM 멤버부터/.test(mk('premium')));
});
t('무료로 열리는 화보는 결제가 아니라 가입으로 보낸다', () => {
  const free = renderSeoHtml('editorial', rec('g2', RECENT), { lang: 'ko', galleryLimit: 2, lockTier: 'free' });
  const paid = renderSeoHtml('editorial', rec('g3', RECENT), { lang: 'ko', galleryLimit: 2, lockTier: 'standard' });
  assert.ok(/\/auth\?utm_source=editorial_gallery_lock/.test(free),
    '돈 낼 필요가 없는 사람을 결제 페이지로 보내면 그냥 이탈한다');
  assert.ok(/\/subscribe\?utm_source=editorial_gallery_lock/.test(paid));
});
t('SSR 호출부가 필요 등급까지 계산해 넘긴다', () => {
  const src = read('api/seo/editorial/[slug].js');
  assert.ok(/requiredTierFor/.test(src) && /lockTier/.test(src),
    '안 넘기면 최신 10편에도 "PREMIUM부터"라고 말해 가입 동선이 끊긴다');
});

console.log('\n=== ④ 상세 API 와 SPA ===');
t('상세 API 가 images 블록(보인 장수·전체·필요 등급)을 내려준다', () => {
  const src = read('api/editorials/[id].js');
  assert.ok(/shapeGallery\(data, tier, \{ freeIds \}\)/.test(src),
    'freeIds 를 안 넘기면 무료 회원의 최신 10편이 열리지 않는다');
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

console.log('\n=== ⑤ 못 여는 화보 → 팝업 ===');
const SUB = read('frontend/pap-subscription.js');
t('클라이언트가 서버와 같은 3단계를 계산한다', () => {
  assert.ok(/function _papViewState\(d\)/.test(SUB));
  assert.ok(/have === want - 1\) return 'preview'/.test(SUB), '바로 다음 단계 규칙이 같아야 한다');
  assert.ok(/free: 1, standard: 2, premium: 3/.test(SUB), '눈금이 서버와 같아야 한다');
});
t('클라이언트 판정이 서버 판정과 실제로 일치한다 (돌려서 비교)', () => {
  // 클라 함수를 떼어내 서버와 같은 입력으로 돌린다. 문자열 검사만으로는
  // "같은 규칙처럼 보이는 다른 규칙"을 못 잡는다.
  const fn = SUB.slice(SUB.indexOf('function _papViewState(d)'),
                       SUB.indexOf('/* 못 여는 화보를 눌렀을 때'));
  const make = (tier) => new Function('isLoggedIn', 'isStandardOrAbove', 'isPremium', 'localStorage',
    fn + '; return _papViewState;')(
      () => tier !== 'anon',
      () => tier === 'standard' || tier === 'premium',
      () => tier === 'premium',
      { getItem: () => 'ko' });
  ['anon', 'free', 'standard', 'premium'].forEach((tier) => {
    const client = make(tier);
    Object.keys(TABLE[tier]).forEach((key) => {
      const server = ed.viewState(tier, rec(key, PD[key]), O);
      const got = client({ requiredTier: ed.requiredTierFor(rec(key, PD[key]), O) });
      assert.strictEqual(got, server, tier + ' × ' + key + ': 클라=' + got + ' 서버=' + server);
    });
  });
});
t('못 여는 화보를 누르면 상세로 안 가고 팝업이 뜬다', () => {
  const src = read('frontend/pap-content-editorial.js');
  const fn = src.slice(src.indexOf('function openEditorial('), src.indexOf('function _renderEditorialVideo'));
  assert.ok(/_papViewState\(_edMeta\) === 'blocked'/.test(fn), '진입점에서 막지 않으면 빈 상세가 열린다');
  assert.ok(/_papShowLockedPopup\(/.test(fn));
  assert.ok(fn.indexOf('return;') > fn.indexOf('_papShowLockedPopup('), '팝업만 띄우고 끝내야 한다');
});
t('팝업이 등급별로 다른 말을 하고 가입은 /auth 로 보낸다', () => {
  assert.ok(/가입하면 볼 수 있습니다/.test(SUB));
  assert.ok(/STANDARD 멤버부터 볼 수 있습니다/.test(SUB));
  assert.ok(/PREMIUM 멤버부터 볼 수 있습니다/.test(SUB));
  assert.ok(/\/auth\?utm_source=editorial_locked_popup/.test(SUB), '비회원을 결제 페이지로 보내면 이탈한다');
  assert.ok(/\/subscribe\?utm_source=editorial_locked_popup/.test(SUB));
});
t('팝업을 닫을 수 있다 (가둬두지 않는다)', () => {
  assert.ok(/papLockedPopupClose/.test(SUB) && /removeChild\(ov\)/.test(SUB));
});
t('2장만 보이는 화면에도 다음 단계 유도 문구가 있다', () => {
  const src = read('frontend/pap-content-editorial.js');
  assert.ok(/가입하면 전체 이미지를 볼 수 있습니다/.test(src));
  assert.ok(/최신 에디토리얼 10편은 회원이면 무료입니다/.test(src));
});

console.log('\n=== ⑥ 계측 (벽의 효과를 재는가) ===');
t('두 벽이 깔때기 단계로 기록된다', () => {
  const step = read('api/funnel/step.js');
  assert.ok(/gallery_lock_view/.test(step) && /locked_popup_view/.test(step),
    '화이트리스트에 없으면 서버가 400 으로 버린다');
  assert.ok(/_papFunnelStep\('gallery_lock_view'\)/.test(read('frontend/pap-content-editorial.js')));
  assert.ok(/_papFunnelStep\('locked_popup_view'\)/.test(SUB));
});
t('계측 실패가 화면을 막지 않는다', () => {
  const fn = SUB.slice(SUB.indexOf('function _papFunnelStep'), SUB.indexOf('/* 못 여는 화보를 눌렀을 때'));
  assert.ok(/\.catch\(function\(\)\{\}\)/.test(fn), '기록 실패로 잠금 화면이 안 뜨면 본말전도다');
  assert.ok(/try\{/.test(fn));
});

console.log('\n화보 미리보기: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
if (fail) process.exit(1);
