/**
 * GEO 절충안 — 기사 번역 크론이 FAQ 도 함께 번역한다 (2026-08-17)
 *
 * [결정] 도메니코: "절충안 진행, 2,300편×8언어 전량은 추후" — 신규 번역분부터
 * FAQ 를 같은 배치 호출에 태운다. 이 테스트는 그 배선이 끊기지 않게 지킨다.
 *
 * [무엇을 지키나]
 *  ① normalizeFaq — 형태 검증(문자열 JSON 허용, q/a 필수, 최대 5개, 길이 상한)
 *  ② article cfg.src 가 __faq 를 프롬프트 입력에 싣는다
 *  ③ 배치 프롬프트(article)에 faq 번역 규칙이 있다
 *  ④ 저장은 normalizeFaq 재검증 통과분만, 없으면 faq 컬럼을 건드리지 않는다
 *     (null 덮어쓰기로 수동 시드를 지우는 사고 방지)
 *  ⑤ attachFaqs 실패해도 본문 번역은 진행된다 (FAQ 는 관문이 아니다)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function inject(filePath, exports) {
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.loaded = true;
  m.exports = exports;
  require.cache[filePath] = m;
}

inject(SUPABASE, { supabaseAdmin: {} });
delete require.cache[HELPER];
const H = require(HELPER);
const src = R('api/_lib/seoTranslateBackfill.js');

console.log('\n[1] normalizeFaq 형태 검증');
{
  ok('내보내져 있다', typeof H.normalizeFaq === 'function');
  ok('정상 배열 통과', JSON.stringify(H.normalizeFaq([{ q: 'Q1', a: 'A1' }])) === '[{"q":"Q1","a":"A1"}]');
  ok('문자열 JSON 허용', Array.isArray(H.normalizeFaq('[{"q":"Q","a":"A"}]')));
  ok('q 없는 항목 제거', H.normalizeFaq([{ a: 'A' }]) === null);
  ok('빈 문자열 제거', H.normalizeFaq([{ q: ' ', a: 'A' }]) === null);
  ok('비배열 거부', H.normalizeFaq({ q: 'Q', a: 'A' }) === null && H.normalizeFaq('부서진{') === null);
  ok('최대 5개 상한', H.normalizeFaq([1, 2, 3, 4, 5, 6, 7].map(i => ({ q: 'q' + i, a: 'a' + i }))).length === 5);
  ok('길이 상한 (q 300 / a 1200)', (() => {
    const r = H.normalizeFaq([{ q: 'x'.repeat(500), a: 'y'.repeat(2000) }]);
    return r[0].q.length === 300 && r[0].a.length === 1200;
  })());
}

console.log('\n[2] 프롬프트 배선');
{
  ok('article src 가 __faq 를 싣는다', /faq: a\.__faq \|\| undefined/.test(src));
  ok('배치 프롬프트에 faq 번역 규칙', /If an input has "faq"/.test(src) && /same length, same order, no new items/.test(src));
  ok('출력 shape 에 faq 포함', /"faq":\[\{"q":"\.\.\.","a":"\.\.\."\}\]/.test(src));
  /* 2026-08-27 — 화보 FAQ 가 생기면서 attachFaqs 가 kind 무관이 됐다.
     지키려는 것은 '프롬프트 직전에 원문 FAQ 를 붙인다'이지 기사 전용이 아니다. */
  ok('프롬프트 직전에 attachFaqs 호출 (kind 무관)',
    /await attachFaqs\(items, cfg\);/.test(src));
}

console.log('\n[3] 저장 안전장치');
{
  ok('저장 전 normalizeFaq 재검증', /const trFaq = normalizeFaq\(t\.faq\);/.test(src));
  ok('유효할 때만 faq 컬럼 포함 (null 덮어쓰기 금지)', /if \(trFaq\) upPayload\.faq = trFaq;/.test(src));
  /* 2026-08-27 정책 변경 — 화보에도 FAQ 가 생겼으므로 editorial 경로도 저장한다.
     대신 '유효할 때만 저장'(바로 위 검사)이 null 덮어쓰기를 계속 막는다.
     화보 FAQ 언어판 배선 전체는 editorial-faq-i18n 이 지킨다. */
  ok('editorial src 도 __faq 를 싣는다 (화보 FAQ 언어판)',
    /faq: e\.__faq \|\| undefined/.test(src));
}

console.log('\n[4] 실패 격리');
{
  ok('attachFaqs 실패 시 본문 번역 계속 (catch 에서 null 폴백)', /faq 를 못 붙여도 본문 번역은 진행한다/.test(src));
}

console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ faq-translate-cron tests passed');
