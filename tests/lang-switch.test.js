/**
 * 언어 전환 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨): 언어를 바꿔도 화면이 그대로고, 아티클 제목이 영문으로 고정되며,
 * /en/ 페이지인데 선택기엔 "한국어"가 떠 있다.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * 기사·에디토리얼 상세는 SSR 이 곧 화면이고, 서버가 URL 접두어로 언어를
 * 정해 렌더한다(/article=ko, /en/article, /ja/article …).
 * 그런데 헤더 언어 선택기는 localStorage 만 보고 UI 문자열(data-i18n)만
 * 바꿨다. 그래서
 *   · 본문·제목은 서버가 그린 언어 그대로 → "선택해도 변화 없음"
 *   · URL 이 /en/ 이어도 선택기는 저장값(ko)을 표시 → 상태 불일치
 * URL 이 실제 언어이므로 URL 을 진실로 삼고, 전환 시 해당 언어 URL 로
 * 이동해 서버가 다시 렌더하게 한다.
 *
 * ⚠ SSR 이 렌더하는 언어만 이동 대상이다. vercel.json 의 rewrite 가
 *   2026-07-27 부터 9개 언어(en / it|fr|es|ja|de|zh|ru)를 전부 받는다 —
 *   번역이 없는 건은 서버가 /en/ 으로 302 (의도된 폴백).
 *
 * ── 참고: 콘텐츠 번역 보유 현황 (이 테스트 범위 밖, 데이터 문제) ──────
 *   아티클     ko / en(486건 제목·본문 완비) / it·fr·es·ja 0건
 *   에디토리얼 ko / en(제목) / it·fr·es 각 2,449 / ja 748
 *   → 아티클은 ko·en 외 요청 시 서버가 /en/ 으로 302 (의도된 폴백)
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. SSR 상세에서 언어 전환이 URL 이동을 일으킬 것 (UI 문자열만 바꾸지 말 것)
 *  2. SSR 미지원 언어로는 이동하지 말 것 (404 방지)
 *  3. 현재 언어를 URL 에서 읽을 것 (선택기 표시 불일치 방지)
 *  4. 이동 전에 저장·프로필 동기화 부수효과가 실행될 것
 *  5. 이동 대상 경로가 vercel.json 에 실제로 존재할 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const header = fs.readFileSync(path.join(ROOT, 'frontend/pap-header.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

console.log('\n=== 1. 언어 전환이 URL 이동을 일으키는가 ===');
t('_papSeoLangHref 헬퍼가 있다', /window\._papSeoLangHref\s*=\s*function/.test(header));
t('setLang 이 이동 대상을 계산한다', /_navTo\s*=\s*\(typeof window\._papSeoLangHref/.test(header));
t('setLang 이 실제로 이동한다', /if \(_navTo\) location\.href = _navTo;/.test(header));
t('현재 언어를 URL 에서 읽는 헬퍼가 있다', /window\._papCurrentLang\s*=\s*function/.test(header));
t('선택기 초기값이 저장값이 아니라 _papCurrentLang() 이다',
  /var saved = window\._papCurrentLang\(\);/.test(header),
  'localStorage 만 보면 /en/ 페이지에서 "한국어"가 표시된다');

console.log('\n=== 2. 부수효과가 이동보다 먼저 실행되는가 ===');
const setLangBody = (header.match(/window\.setLang = function \(l\) \{[\s\S]*?\n    \};/) || [''])[0];
t('setLang 본문을 찾았다', setLangBody.length > 0);
const ixProfile = setLangBody.indexOf("fetch('/api/auth/language'");
const ixNav = setLangBody.indexOf('location.href = _navTo');
t(`프로필 언어 동기화(${ixProfile}) 가 이동(${ixNav}) 보다 먼저다`,
  ixProfile > -1 && ixNav > -1 && ixProfile < ixNav,
  '조기 return 으로 이동하면 뉴스레터 언어 동기화가 통째로 건너뛰어진다');
t('이동 전에 언어를 저장한다', /localStorage\.setItem\('pap-lang'/.test(setLangBody));

console.log('\n=== 3. URL 계산 로직 (실제 경로로 검산) ===');
/* pap-header.js 와 같은 규칙을 여기서 재현해 교차검증한다. */
const PAP_SEO_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];
function seoPath(p) { return p.match(/^\/(?:([a-z]{2})\/)?(article|editorial)\/(.+?)\/?$/); }
function href(p, lang) {
  if (PAP_SEO_LANGS.indexOf(lang) === -1) return null;
  const m = seoPath(p); if (!m) return null;
  const cur = m[1] || 'ko'; if (lang === cur) return null;
  const tail = m[2] + '/' + m[3];
  return lang === 'ko' ? '/' + tail : '/' + lang + '/' + tail;
}
const cases = [
  ['/article/gym', 'ja', '/ja/article/gym'],
  ['/article/gym', 'ko', null],                    // 같은 언어면 이동 없음
  ['/en/article/gym', 'ko', '/article/gym'],       // ko 는 접두어 제거
  ['/en/article/gym', 'it', '/it/article/gym'],
  ['/ja/editorial/x', 'ko', '/editorial/x'],
  ['/editorial/x', 'fr', '/fr/editorial/x'],
  ['/article/a-b-c/', 'en', '/en/article/a-b-c'],  // 끝 슬래시 정리
  ['/en/article/gym', 'zh', '/zh/article/gym'],    // 2026-07-27 — 9개어 전부 이동
  ['/en/article/gym', 'ru', '/ru/article/gym'],
  ['/en/article/gym', 'de', '/de/article/gym'],
  ['/magazine', 'en', null],                       // 상세가 아니면 이동 없음
  ['/', 'en', null],
  ['/mypage', 'en', null],
];
cases.forEach(([p, l, want]) => {
  const got = href(p, l);
  t(`${p} + ${l} → ${want === null ? '이동없음' : want}`, got === want, `실제: ${got}`);
});
t('헬퍼의 지원 언어 목록이 코드와 같다',
  /PAP_SEO_LANGS = \['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'\]/.test(header),
  '여기가 바뀌면 위 검산도 함께 고쳐야 한다');

console.log('\n=== 4. 이동 대상 경로가 vercel.json 에 실제로 있는가 ===');
const sources = (vercel.rewrites || []).map((r) => r.source);
[['en', 'article'], ['en', 'editorial']].forEach(([l, kind]) => {
  t(`/${l}/${kind}/:slug rewrite 존재`, sources.indexOf(`/${l}/${kind}/:slug`) > -1);
});
['article', 'editorial'].forEach((kind) => {
  const re = sources.find((s) => s.indexOf(`/${kind}/:slug`) > -1 && s.indexOf(':lang(') > -1);
  t(`${kind} 다국어 rewrite 존재 (${re || '없음'})`, !!re);
  if (re) {
    const langs = (re.match(/:lang\(([^)]+)\)/) || [])[1] || '';
    // 헬퍼가 이동시키는 언어(ko·en 제외)는 전부 rewrite 가 받아야 404 가 안 난다
    ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'].forEach((l) => {
      t(`  ${kind} — ${l} 가 rewrite 에 포함`, langs.split('|').indexOf(l) > -1);
    });
  }
});

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ lang-switch tests FAILED'); process.exit(1); }
console.log('✅ lang-switch tests passed');
