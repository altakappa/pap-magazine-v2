/**
 * IG 유입 표면 확장 회귀 (2026-07-30 신설, 도메니코 요청).
 *
 * 왜 이 세 곳인가 — 30일 아웃클릭 실측에서 나온 결론:
 *   ssr 8,139 / editorial 62 / nav 59 / article 54 / … 로 ssr 이 압도적인데,
 *   그 ssr 은 모바일 14%·고유 IP 1,553(7일)로 상당수가 크롤러다. 실제 사람
 *   유입은 하루 12건 수준. 즉 "채널을 더 늘리는 것" 보다 **길이 아예 없는
 *   표면을 여는 것** 이 남은 여지다. 그래서 계측이 0 이던 세 곳을 연다:
 *     ① 브랜드 허브 1,669페이지 (푸터 직링크뿐 — 계측 없음)
 *     ② 기사 SSR (CTA 는 있으나 에디토리얼과 src 를 공유해 기여도가 안 보임)
 *     ③ 투고 완료 화면 (가장 고관여 순간인데 IG 경로 없음)
 *
 * 여기서 지키는 것: 링크가 살아 있을 것, 계측을 경유할 것, 소스가 분리될 것,
 * 그리고 회원 대면 문구는 9개 언어일 것.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== ① 브랜드 허브 (1,669 페이지) ===');
(function () {
  const src = R('api/seo/brand/[id].js');
  t('IG CTA 버튼이 있다', /href="\/ig\/brand"/.test(src));
  t('푸터 링크도 계측 경유', (src.match(/\/ig\/brand/g) || []).length >= 2,
    '푸터 직링크를 남겨두면 그 유입이 영영 안 잡힌다');
  /* 남은 instagram.com 2건은 **브랜드사** 핸들(@zara 등)과 JSON-LD sameAs 다.
     그건 외부 브랜드의 공식 계정이라 계측 대상이 아니고 직링크가 맞다.
     여기서 막아야 하는 건 'PAP 계정으로 가는 직링크' 뿐이다. */
  t('PAP 계정 직링크는 없다 (계측 우회 금지)', !/instagram\.com\/pap_magazine/.test(src));
  t('브랜드사 핸들 링크는 보존', /instagram\.com\/' \+ igHandle/.test(src),
    '브랜드 공식 계정은 외부 링크가 맞다 — 지우면 페이지 정보가 준다');
  t('기존 CTA(문의·미디어킷)는 그대로', /inquiry=1&brand=/.test(src) && /\/mediakit\/ko\/brand_/.test(src));
})();

console.log('=== ② SSR 소스 분리 (기사 기여도 가시화) ===');
(function () {
  const src = R('api/_lib/seoRenderer.js');
  t('kind 별 소스 변수를 만든다', /const IG_SRC = kind === 'article' \? 'ssr_article'/.test(src));
  t('필름도 분리', /'ssr_film'/.test(src));
  t('에디토리얼은 ssr 유지 (과거 추세 보존)', /: 'ssr'\)/.test(src),
    '기존 소스명을 바꾸면 8,139건의 이력과 단절된다');
  t('하드코딩 src=ssr 이 남아 있지 않다', !/ig-out\?src=ssr&/.test(src));
  t('니치 채널 소스는 건드리지 않았다', /src=ssr_niche/.test(src));
})();

console.log('=== ③ 투고 완료 화면 (최고 관여 지점) ===');
(function () {
  const src = R('frontend/submission.html');
  t('완료 화면에 IG CTA', /href="\/ig\/submission_done"/.test(src));
  // 회원 대면 화면이므로 9개 언어 (frontend 규칙)
  const langs = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
  const have = langs.filter((l) => new RegExp(`\\b${l}:\\{[^\\n]*?successIgCta:'`).test(src));
  t('문구가 9개 언어 (' + have.length + '/9)', have.length === 9,
    '빠진 언어: ' + langs.filter((l) => !have.includes(l)).join(', '));
  t('성공 메시지 뒤에 온다 (안내가 먼저)', src.indexOf('successMsg') < src.indexOf('successIgCta'));
})();

console.log('=== 계측 화이트리스트 (없으면 other 로 뭉개진다) ===');
(function () {
  const src = R('api/ig-out.js');
  for (const s of ['brand', 'ssr_article', 'ssr_film', 'submission_done', 'youtube']) {
    t(s + ' 등록', new RegExp("'" + s + "'").test(src));
  }
  t('기존 소스를 지우지 않았다',
    ["'ssr'", "'editorial'", "'nav'", "'footer'", "'naverblog'"].every((s) => src.includes(s)),
    '지우면 과거 기록이 other 로 재분류돼 추세가 끊긴다');
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-funnel-surfaces tests FAILED'); process.exit(1); }
console.log('✅ ig-funnel-surfaces tests passed');
