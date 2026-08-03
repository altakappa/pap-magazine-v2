/**
 * 보이스 검수 게이트 배선 테스트 (2026-08-03 도메니코 승인)
 * ═══════════════════════════════════════════════════════════════════
 * 배경: papVoice.lintKoreanBody 는 정의·export 만 되고 호출부가 한 곳도
 * 없는 죽은 게이트였다. 지문 §12 는 "게이트가 걸려 있다"고 적고 있었으니
 * 문서와 코드가 어긋나 있었던 것이다. 2bbcfcc 가 {style} 인자까지
 * 확장했지만 부르는 곳이 없어 그 확장도 실행되지 않았다.
 *
 * 이 테스트가 지키는 것:
 *  1. auditKoreanBody 가 존재하고, 텍스트를 절대 바꾸지 않을 것 (통과형 게이트)
 *  2. 이슈가 있어도 throw 하지 않을 것 — 발행을 막지 않는다
 *  3. 채널별 style 매핑이 실제 코드에 배선돼 있을 것
 *     (스레드 casual / X polite / 카카오 polite / 뉴스레터 polite / 에디토리얼 plain)
 *  4. lintKoreanBody 가 다시 고아가 되지 않을 것 — 호출부 존재를 강제
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const papVoice = require(path.join(ROOT, 'api/_lib/papVoice.js'));

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? '\n      → ' + detail : ''); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const voice    = read('api/_lib/papVoice.js');
const threads  = read('api/_lib/threadsAutopost.js');
const xpost    = read('api/_lib/xPost.js');
const repurp   = read('api/_lib/socialRepurpose.js');
const edai     = read('api/_lib/editorialAi.js');
const weekly   = read('api/cron/weekly-news.js');

console.log('\n[1] auditKoreanBody 계약');
t('papVoice 가 auditKoreanBody 를 export 한다',
  typeof papVoice.auditKoreanBody === 'function');

const dirty = '이건 문제다. 여러분 — 확인해 보세요';
t('텍스트를 바꾸지 않고 그대로 돌려준다',
  papVoice.auditKoreanBody(dirty, { style: 'polite', structure: false, where: 'test' }) === dirty,
  '검수용이지 수정용이 아니다');

let threw = false;
try { papVoice.auditKoreanBody(dirty, { style: 'polite', structure: false, where: 'test' }); }
catch (_) { threw = true; }
t('이슈가 있어도 throw 하지 않는다', !threw, '오탐 하나로 자동 발행이 멈추면 안 된다');

t('null/undefined 를 넣어도 죽지 않는다',
  papVoice.auditKoreanBody(null, { where: 'test' }) === null
  && papVoice.auditKoreanBody(undefined, { where: 'test' }) === undefined);

console.log('\n[2] 린터가 실제로 무언가를 잡는지');
t('존댓말 채널에서 평서체를 잡는다',
  papVoice.lintKoreanBody('이건 문제다.', { style: 'polite', structure: false }).length > 0);
t('반말 채널에서 존댓말을 잡는다',
  papVoice.lintKoreanBody('이건 문제입니다.', { style: 'casual', structure: false }).length > 0);
t('줄표를 잡는다',
  papVoice.lintKoreanBody('무대 위 — 가면', { style: 'casual', structure: false })
    .some((i) => /대시/.test(i)));
t('정상 반말 문장은 통과시킨다',
  papVoice.lintKoreanBody('패퍼들은 어떻게 생각해?', { style: 'casual', structure: false }).length === 0);

console.log('\n[3] 채널별 배선');
t('스레드 = casual, structure:false',
  /auditKoreanBody\([\s\S]{0,200}style: 'casual'[\s\S]{0,80}where: 'threads'/.test(threads),
  '네 갈래 반환 경로가 전부 통과하는 normalize() 안에 있어야 한다');
t('스레드 검수는 normalize() 안에 있다',
  /function normalize\(s\) \{[\s\S]{0,220}auditKoreanBody/.test(threads));
t('X = polite', /style: 'polite'[\s\S]{0,60}where: 'x'/.test(xpost));
t('X 검수는 길이 판정보다 먼저 걸린다',
  xpost.indexOf('auditKoreanBody') < xpost.indexOf('weightedLen(measured) > 280'),
  '치환·검수 순서가 뒤집히면 280자 판정이 어긋난다');
t('카카오 = polite', /where: 'kakao'/.test(repurp));
t('샤오홍슈는 한국어 린터를 태우지 않는다',
  /platform === 'kakao'/.test(repurp) && !/where: 'xiaohongshu'/.test(repurp),
  '중국어에는 반말/존댓말 구분이 없다');
t('뉴스레터 = polite', /style: 'polite'[\s\S]{0,60}where: 'newsletter'/.test(weekly));
t('에디토리얼 = plain (두 경로 모두)',
  (edai.match(/where: 'editorial/g) || []).length === 2);

console.log('\n[4] 고아 방지');
const callers = [threads, xpost, repurp, edai, weekly]
  .filter((s) => /auditKoreanBody/.test(s)).length;
t('auditKoreanBody 호출부가 5개 파일에 있다', callers === 5, '실제 ' + callers + '개');
t('lintKoreanBody 는 auditKoreanBody 를 통해서만 불린다',
  /function auditKoreanBody[\s\S]{0,400}lintKoreanBody\(text, opts\)/.test(voice));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ voice-lint-gate tests FAILED'); process.exit(1); }
console.log('✅ voice-lint-gate tests passed');
