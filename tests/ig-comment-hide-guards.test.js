/**
 * 숨기기 엔드포인트의 안전장치가 실제로 있는지 본다.
 * 이 테스트가 지키는 것: 실수로도, 시켜도, 위험한 일이 안 일어난다.
 *
 * 소스를 문자열로 훑는 방식인 이유: 이 파일의 계약은 '무엇을 하는가'가
 * 아니라 '무엇을 절대 안 하는가'다. 삭제 경로가 생기면 즉시 깨져야 한다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../api/ops/ig-comment-hide.js'), 'utf8');
let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('IG 댓글 숨기기 안전장치');

t('삭제 경로가 존재하지 않는다', () => {
  assert.ok(!/method:\s*['"]DELETE['"]/i.test(SRC), 'DELETE 요청이 있다');
  assert.ok(!/\.delete\s*\(/.test(SRC), 'delete() 호출이 있다');
});

t('일괄 처리 경로가 없다', () => {
  // 배열을 돌며 여러 건을 쓰는 구조가 생기면 이 파일의 전제가 무너진다
  assert.ok(!/for\s*\(.*of\s+(comments|rows|targets|ids)/.test(SRC), '반복 쓰기 구조가 있다');
  assert.ok(!/Promise\.all/.test(SRC), '병렬 일괄 처리가 있다');
});

t('인증을 요구한다', () => {
  assert.ok(SRC.includes('requireAdmin'), 'requireAdmin 없음');
  assert.ok(SRC.includes('CRON_SECRET'), 'CRON_SECRET 경로 없음');
});

t('confirm=hide 없이는 실행되지 않는다', () => {
  assert.ok(/q\.confirm\s*!==\s*['"]hide['"]/.test(SRC), 'confirm 확인이 없다');
});

t('commentId 를 명시적으로 받는다 (알아서 고르지 않는다)', () => {
  assert.ok(SRC.includes('q.commentId'), 'commentId 파라미터 없음');
  assert.ok(/\^\[0-9\]\{5,\}\$/.test(SRC), 'commentId 형식 검증 없음');
});

t('판정기가 기준점 미만이면 숨기지 않는다', () => {
  assert.ok(/judged\.total\s*<\s*THRESHOLD/.test(SRC), '점수 하한 검사가 없다');
  assert.ok(SRC.includes('const THRESHOLD = 60'), '기준점 상수가 없다');
});

t('쓰기 후 실제 상태를 다시 읽어 검증한다', () => {
  // 2026-08-07 유튜브 사고: 응답만 보고 성공이라 믿었다가 실제로는 막혀 있었다
  assert.ok(SRC.includes('검증'), '사후 검증이 없다');
  assert.ok(/after\.hidden/.test(SRC), '변경 후 상태를 안 읽는다');
});

t('되돌리기 경로가 있다', () => {
  assert.ok(SRC.includes('unhide'), 'unhide 경로가 없다');
});

t('토큰을 응답에 흘리지 않는다', () => {
  assert.ok(SRC.includes('function scrub'), 'scrub 없음');
  assert.ok(/scrub\(err\.message, token\)/.test(SRC), '오류 메시지에 scrub 미적용');
});

t('권한 없음(403)을 다른 실패와 구분해 알려준다', () => {
  assert.ok(/instagram_manage_comments/.test(SRC), '권한 안내 문구가 없다');
});

console.log(`\n${n}개 테스트 통과`);
