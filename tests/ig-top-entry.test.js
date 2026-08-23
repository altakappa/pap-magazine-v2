/**
 * 상단 IG 진입점 — 위가 나은지 '재게' 만든다 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "모든 파이프라인에서 웹이 아닌 인스타그램에 유입되는 걸 최우선.
 * 웹에서도 기사와 에디토리얼에서 인스타그램으로 넘어오기 좋은 디자인으로."
 *
 * [지금 구조] IG 진입점이 **전부 페이지 맨 아래**다. 갤러리·크레딧·별점·참여·
 *   SHOP·다운로드·브랜드·관련글·태그·FAQ 를 다 지나야 나온다. 모바일에서 수천 px.
 *   그런데도 웹→IG 아웃클릭 30일 1,950건의 3/4 를 SSR 화면이 만든다.
 *
 * [무엇을 근거로 게시물 링크인가] 같은 페이지·같은 방문자로 이미 비교돼 있다:
 *       게시물(to=post)    약 1,394   |   프로필(to=profile) 약 421   → 3.3 : 1
 *   노출이 같은 두 CTA 라 공정한 비교다. 원본 보유율도 높다(화보 95.0%·기사 87.7%).
 *
 * [왜 위인가 — 모른다. 그래서 잰다] 위가 나은지는 아무도 재본 적이 없다.
 *   src 를 따로 둔다: ssr_top(SSR 위) · spa_top(SPA 위).
 *   아래(ssr_article·article·editorial)와 나란히 놓으면 숫자로 판정된다.
 *   ⚠ 이 테스트는 "위가 낫다"를 주장하지 않는다. **비교가 가능한 상태**를 지킨다.
 *
 * [지키는 것]
 *   1. 위·아래가 서로 다른 라벨을 쓴다 (섞이면 판정 자체가 불가능)
 *   2. 원본이 있으면 게시물, 없으면 프로필 — 폴백이 있어야 빈 자리가 안 생긴다
 *   3. SSR·SPA 가 같은 문구·같은 모양 (규칙이 두 벌이 되면 한쪽만 고쳐진다)
 *   4. 본문을 가리지 않는다 (침입형 인터스티셜 = 순위 손실 = IG 로 보낼 사람 감소)
 *   5. ig-out 화이트리스트에 새 라벨이 있다 (없으면 'other' 로 뭉개진다)
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { renderSeoHtml } = require(path.join(ROOT, 'api/_lib/seoRenderer.js'));
const BASE = { id: '11111111-2222-3333-4444-555555555555', title: 't', slug: 's', status: 'published',
  published_date: '2026-08-01', description: 'd', cover_image: 'c.jpg' };
const WITH_IG = Object.assign({}, BASE, { source_instagram_url: 'https://www.instagram.com/p/ABC/?igsh=x' });

console.log('\n=== 1. 위·아래가 섞이지 않는다 (판정 가능성) ===');
{
  const h = renderSeoHtml('article', WITH_IG, { lang: 'ko' });
  t('상단이 ssr_top 라벨을 쓴다', /ig-out\?src=ssr_top&/.test(h));
  t('하단은 종전 라벨(ssr_article)을 그대로 쓴다', /ig-out\?src=ssr_article&/.test(h));
  t('상단이 하단보다 문서에서 먼저 온다', h.indexOf('src=ssr_top') < h.indexOf('src=ssr_article'));
  const src = read('api/ig-out.js');
  const wl = new Function(src.match(/const SRC_WHITELIST = new Set\(\[[\s\S]*?\]\);/)[0] + '; return SRC_WHITELIST;')();
  t('ssr_top 이 화이트리스트에 있다 (없으면 other 로 뭉개진다)', wl.has('ssr_top'));
  t('spa_top 이 화이트리스트에 있다', wl.has('spa_top'));
  t('기존 라벨이 사라지지 않았다',
    ['ssr_article', 'ssr', 'article', 'editorial', 'editorial_mid'].every((x) => wl.has(x)));
}

console.log('\n=== 2. 게시물 우선 · 없으면 프로필 폴백 ===');
{
  const withIg = renderSeoHtml('article', WITH_IG, { lang: 'ko' });
  const m = withIg.match(/ig-out\?src=ssr_top&to=(post|profile)&url=([^"]*)/);
  t('원본이 있으면 to=post', !!m && m[1] === 'post', m && m[1]);
  t('추적 쿼리(?igsh=)를 떼고 보낸다', !!m && m[2].indexOf('igsh') === -1, m && m[2].slice(0, 80));
  const noIg = renderSeoHtml('article', BASE, { lang: 'ko' });
  const m2 = noIg.match(/ig-out\?src=ssr_top&to=(post|profile)/);
  t('원본이 없으면 to=profile 로 떨어진다 (빈 자리 없음)', !!m2 && m2[1] === 'profile', m2 && m2[1]);
  t('화보에도 붙는다', /src=ssr_top/.test(renderSeoHtml('editorial', WITH_IG, { lang: 'ko' })));
}

console.log('\n=== 3. SSR 과 SPA 가 같은 말을 한다 (규칙 두 벌 방지) ===');
{
  const utils = read('frontend/pap-utils.js');
  const fn = utils.match(/function papIgTopHtml\(igUrl, opts\)\{[\s\S]*?\n\}/)[0];
  const make = new Function('localStorage', 'window', fn + '; return papIgTopHtml;');
  const LS = { getItem: () => 'ko' };
  const papIgTopHtml = make(LS, {});
  const spa = papIgTopHtml('https://www.instagram.com/p/ABC/?x=1', { src: 'spa_top' });
  t('SPA 헬퍼가 spa_top 을 쓴다', /src=spa_top/.test(spa));
  t('SPA 도 게시물 우선', /to=post/.test(spa));
  t('SPA 도 쿼리를 떼고 보낸다', spa.indexOf('%3Fx%3D1') === -1);
  const spaNo = papIgTopHtml('', { src: 'spa_top' });
  t('SPA 도 원본 없으면 프로필', /to=profile/.test(spaNo));

  /* 문구가 갈라지면 두 화면이 다른 약속을 한다 */
  const ssr = renderSeoHtml('article', WITH_IG, { lang: 'ko' });
  const koPost = '이 기사의 인스타그램 원본 보기';
  t('SSR·SPA 가 같은 한국어 문구를 쓴다', ssr.indexOf(koPost) > -1 && spa.indexOf(koPost) > -1);
  const en = make({ getItem: () => 'en' }, {})('https://www.instagram.com/p/A/', { src: 'spa_top' });
  const ssrEn = renderSeoHtml('article', WITH_IG, { lang: 'en' });
  const enPost = 'See the original post on Instagram';
  t('영어도 같은 문구', ssrEn.indexOf(enPost) > -1 && en.indexOf(enPost) > -1);
  t('9개 언어가 모두 있다',
    ['ko','en','ja','zh','it','fr','es','de','ru'].every((lg) => new RegExp("\\n    " + lg + ": \\{[\\s\\S]*?topPost:").test(read('api/_lib/seoRenderer.js'))));
}

console.log('\n=== 4. 본문을 가리지 않는다 ===');
{
  const s = read('api/_lib/seoRenderer.js');
  const css = (s.match(/\.ig-top\{[^}]*\}/) || [''])[0];
  t('상단 CTA CSS 가 있다', css.length > 0);
  t('고정 오버레이가 아니다 (침입형 인터스티셜 회피)',
    !/position:\s*(fixed|sticky)/.test(css), css.slice(0, 120));
  t('화면을 덮지 않는다 (전체 높이/뷰포트 단위 없음)', !/100vh|inset:/.test(css));
  t('인라인 크리티컬 CSS 에 있다 (늦게 오는 pap-styles.css 에 기대지 않는다)',
    (() => { const h = renderSeoHtml('article', WITH_IG, { lang: 'ko' }); return h.slice(0, h.indexOf('</head>')).indexOf('.ig-top{') > -1; })());
  t('모바일 대응이 있다', /@media\(max-width:600px\)\{\.ig-top\{/.test(s));
}

console.log('\n=== 5. SPA 자리와 배선 ===');
{
  const html = read('frontend/index.html');
  t('기사 상세에 자리가 있다', /id="artDetailIgTop"/.test(html));
  t('화보 상세에 자리가 있다', /id="edDetailIgTop"/.test(html));
  const art = read('frontend/pap-content-article.js');
  const ed = read('frontend/pap-content-editorial.js');
  t('기사 렌더러가 그 자리를 채운다', /artDetailIgTop[\s\S]{0,200}?papIgTopHtml/.test(art));
  t('화보 렌더러가 그 자리를 채운다', /edDetailIgTop[\s\S]{0,200}?papIgTopHtml/.test(ed));
  t('화보는 두 진입 경로 모두에서 채운다 (popstate 복원 포함)',
    (ed.match(/edDetailIgTop/g) || []).length >= 2);
  t('헬퍼가 없어도 화면이 깨지지 않는다', /typeof window\.papIgTopHtml === 'function'/.test(art));
  t('갤러리 중간 임베드(editorial_mid)를 없애지 않았다', /editorial_mid/.test(ed));
}

console.log('\n=== 6. 캐시버스트 ===');
{
  const v = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'frontend')).filter((x) => x.endsWith('.html'))) {
    const h = fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
    for (const name of ['pap-utils', 'pap-content-article', 'pap-content-editorial']) {
      const m = h.match(new RegExp(name + '\\.js\\?v=(\\d+)'));
      if (m) (v[name] = v[name] || new Set()).add(Number(m[1]));
    }
  }
  t('pap-utils 버전이 HTML 전부에서 같다', v['pap-utils'].size === 1, [...v['pap-utils']].join(','));
  t('pap-utils 가 6보다 크다 (헬퍼 추가)', [...v['pap-utils']].every((x) => x > 6));
  t('pap-content-article 가 50보다 크다', [...v['pap-content-article']].every((x) => x > 50));
  t('pap-content-editorial 가 77보다 크다', [...v['pap-content-editorial']].every((x) => x > 77));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-top-entry tests FAILED'); process.exit(1); }
console.log('✅ ig-top-entry tests passed');
