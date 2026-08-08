/**
 * 필름·숏츠의 언어 프리픽스 URL (2026-08-09 신설).
 *
 * ── 실제 상태 ────────────────────────────────────────────────────────
 * 번역 현황을 훑다 라이브에서 확인했다:
 *
 *     /film/jequitiba-film       200  (한국어)
 *     /en/film/jequitiba-film    200  (영어)
 *     /ja/film/jequitiba-film    **404**
 *     /zh/film/jequitiba-film    **404**
 *
 * 아티클·에디토리얼은 번역이 없으면 `/en/` 으로 **302** 를 준다
 * (api/seo/article/[slug].js — "빈 번역 페이지를 색인시키지 않는다").
 * 필름만 404 였다. 이유는 vercel.json 에 `/film/:slug` 와 `/en/film/:slug`
 * 두 개만 있고 다른 언어 라우트가 없어서, 요청이 핸들러까지 가지도 못했다.
 *
 * ── 왜 지금 고치나 (검색 손실은 없다) ───────────────────────────────
 * 사이트맵은 필름을 다국어로 광고하지 않으므로 색인 손실은 없었다.
 * 고치는 이유는 **정합성**이다 — 같은 사이트에서 같은 상황(번역 없음)에
 * 아티클은 영어로 보내고 필름은 막다른 404 를 준다. 사용자가 일본어로
 * 보다가 필름 링크를 밟으면 페이지가 없다고 나온다.
 *
 * ── 왜 301 이 아니라 302 인가 ───────────────────────────────────────
 * 필름은 지금 번역 대상이 아니지만(seo_translations 에 film 행 0건),
 * 나중에 들어올 수 있다. 301 은 브라우저·검색엔진이 영구 캐시해서
 * 그때 그 URL 을 되살리기 어렵다. 아티클이 302 를 쓰는 이유와 같다.
 * (`/:lang/about` 같은 '영원히 번역 안 할' 경로는 301 을 쓴다 — 구분이 있다.)
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 7개 언어 × film·short 가 /en/ 으로 갈 것
 *   ② 302(임시)일 것 — 301 로 바뀌면 되돌리기 어렵다
 *   ③ ko·en 원래 경로는 **그대로**일 것 (리다이렉트로 덮지 말 것)
 *   ④ 슬래시 유무 둘 다 다룰 것
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 220)); }
}

const redirects = cfg.redirects || [];
const rewrites = cfg.rewrites || [];
const LANGS = 'ja|fr|it|es|de|ru|zh';

console.log('\n=== ①② 언어 프리픽스 → /en/ 302 ===');
for (const kind of ['film', 'short']) {
  for (const suffix of ['', '/']) {
    const src = `/:lang(${LANGS})/${kind}/:slug${suffix}`;
    const r = redirects.find(x => x.source === src);
    t(`${src} 규칙이 있다`, !!r, redirects.filter(x => x.source.includes(`/${kind}/`)).map(x => x.source).join(' | '));
    if (!r) continue;
    t(`  → /en/${kind}/:slug 로 보낸다`, r.destination === `/en/${kind}/:slug`, r.destination);
    t('  → 302(임시)다 — 301 이면 되돌리기 어렵다', r.permanent === false, r.permanent);
  }
}
/* 아티클이 쓰는 정책과 같은지 — 문서가 아니라 코드로 확인한다. */
const artSrc = fs.readFileSync(path.join(ROOT, 'api/seo/article/[slug].js'), 'utf8');
t('아티클도 번역 없으면 302 를 쓴다 (같은 정책)',
  /res\.status\(302\)\.end\(\)/.test(artSrc) && /Location', '\/en\/article\//.test(artSrc));

console.log('\n=== ③ 원래 경로는 그대로다 ===');
for (const kind of ['film', 'short']) {
  t(`/${kind}/:slug rewrite 가 살아 있다`,
    rewrites.some(x => x.source === `/${kind}/:slug` && x.destination === `/api/seo/${kind}/:slug`));
  t(`/en/${kind}/:slug rewrite 가 살아 있다`,
    rewrites.some(x => x.source === `/en/${kind}/:slug`
      && x.destination === `/api/seo/${kind}/:slug?lang=en`));
  /* 새 리다이렉트가 ko·en 을 삼키면 안 된다 — 언어 목록에 ko·en 이 없어야 한다. */
  const swallow = redirects.filter(x =>
    x.source.includes(`/${kind}/:slug`) && /\(ko\||\|ko\)|\(en\||\|en\)/.test(x.source));
  t(`  ${kind}: ko·en 을 삼키는 규칙이 없다`, swallow.length === 0, swallow.map(x => x.source).join(' | '));
}

console.log('\n=== 설정 파일이 성해 있다 ===');
t('redirects 가 배열이고 비어 있지 않다', Array.isArray(redirects) && redirects.length > 50, redirects.length);
t('rewrites 가 배열이고 비어 있지 않다', Array.isArray(rewrites) && rewrites.length > 50, rewrites.length);
t('모든 redirect 에 source·destination 이 있다',
  redirects.every(r => typeof r.source === 'string' && typeof r.destination === 'string'));
/* 같은 규칙이 두 번 있으면 뒤엣것이 죽는다 — 조용한 사고의 씨앗.
   다만 **키는 source 만이 아니다**: `/:path*` 는 5번 나오지만 각각 `has`(호스트)가
   달라 정상이다(papkorea.com·m.pap-magazine.com … → www.pap-magazine.com 통합).
   source 만으로 세면 그 정상 규칙을 사고로 오인한다 — 실제로 처음 그렇게 짰다가
   걸렸다. source + has 조합으로 센다. */
const keyOf = (r) => r.source + '|' + JSON.stringify(r.has || null);
const dup = redirects.map(keyOf).filter((k, i, a) => a.indexOf(k) !== i);
t('완전히 같은 규칙(source+has)이 중복되지 않는다', dup.length === 0, [...new Set(dup)].join(' | '));
t('호스트 통합 규칙은 살아 있다 (검사가 이걸 지우지 않았는지)',
  redirects.filter(r => r.source === '/:path*' && r.has).length >= 4,
  redirects.filter(r => r.source === '/:path*').length);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ film-lang-redirect tests passed');
