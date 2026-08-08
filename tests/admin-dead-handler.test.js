/**
 * 관리자 콘솔의 '죽은 참조' 금지 (2026-08-08 신설).
 *
 * ── 실제 사고 ────────────────────────────────────────────────────────
 * 「긴 글 번역」 버튼을 눌러도 아무 일도 일어나지 않았다. 서버 로그에는
 * 요청이 **한 건도** 없었다. 브라우저 콘솔을 열어 보니 원인은 엉뚱한 곳:
 *
 *     ReferenceError: addCoverSlide is not defined   (pap-admin.js:15009)
 *
 * pap-admin.js 15009행이 이렇게 돼 있었다:
 *     var _origAddCoverSlide = addCoverSlide;   // ← 이 함수가 파일에 없다
 *
 * 커버 기능이 슬라이드 모델에서 그룹 모델(addCoverGroup / deleteCoverGroup /
 * addCoverImage)로 바뀔 때 원본 함수는 지워졌는데 이 래퍼만 남았다.
 * admin.html 의 「+ 슬라이드 추가」 버튼도 같은 죽은 이름을 부르고 있었다.
 *
 * ── 왜 이렇게까지 안 보였나 ─────────────────────────────────────────
 * 최상위에서 예외가 나면 **그 아래 최상위 실행문이 전부 안 돈다.** 그런데
 * 함수 선언은 hoisting 되어 이미 존재하므로, `typeof fn === 'function'` 은
 * 전부 true 다. 겉으로는 멀쩡하고 `var` 로 만드는 상태값만 undefined 다.
 *
 * 실측으로 죽어 있던 것 (15009행 이후 최상위 var):
 *     _originalGo        새 섹션용 go() 오버라이드
 *     intAds · editAdId  인터스티셜 광고
 *     _papDlState        다운로드 이력
 *     LT_LANGS · _ltState 긴 글 번역 ← 이걸로 발견했다
 * 즉 한 줄이 파일 뒤쪽 전부를 조용히 무력화하고 있었다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① admin.html 의 인라인 핸들러가 부르는 함수는 **정의돼 있을 것**
 *   ② 최상위에서 '없는 함수'를 감싸지 말 것 — 파일 전체가 죽는다
 *   ③ 래퍼는 대상이 없어도 죽지 않고 경고만 남길 것
 *   ④ 15009행 이후에서 살아났어야 할 상태값이 실제로 최상위에 있을 것
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');

/* 주석은 코드가 아니다 — 사고를 설명하는 주석에 죽은 이름이 나온다고
   실패로 세면 기록을 남길수록 테스트가 깨진다. 그렇다고 `/*…*/` 를 정규식
   하나로 걷어내면 안 된다: 문자열·정규식 리터럴 안의 `/*` 에 걸려 **진짜
   코드를 통째로 삼킨다**(이 테스트를 쓰다 실제로 당했다 — 멀쩡한 함수
   17개가 '없다'고 나왔다). 그래서 줄 단위로만, 확실한 것만 지운다. */
function stripJsComments(s) {
  return s.split('\n')
    .map(line => {
      const trimmed = line.trim();
      // 주석 '본문' 줄: //… 또는 블록 주석 안쪽의 * … 로 시작하는 줄
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
      return line;
    })
    .join('\n');
}
/* HTML 주석은 <!-- --> 로 명확해 통째로 지워도 안전하다. */
function stripHtmlComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ' '); }
const JS_CODE = stripJsComments(JS);
const HTML_CODE = stripHtmlComments(HTML);

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* 정의처를 모은다 — pap-admin.js + 함께 로드되는 파일 + admin.html 인라인 스크립트. */
function collectDefined() {
  const out = new Set();
  const scan = (s) => {
    for (const m of s.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[1]);
    for (const m of s.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g)) out.add(m[1]);
    for (const m of s.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]);
  };
  scan(JS);   // 정의 수집은 원문 그대로 — 놓치는 쪽이 훨씬 나쁘다
  for (const f of ['frontend/pap-admin-campaigns.js', 'frontend/pap-api.js']) {
    try { scan(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (_) { /* 없으면 통과 */ }
  }
  for (const m of HTML.matchAll(/<script(?![^>]*\ssrc)[^>]*>([\s\S]*?)<\/script>/g)) scan(m[1]);
  return out;
}

/* 정규식이 함수 이름으로 오인하는 것들. 진짜 함수가 아니라 문법이다. */
const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'alert', 'confirm']);

console.log('\n=== ① 인라인 핸들러가 부르는 함수는 정의돼 있어야 한다 ===');
const defined = collectDefined();
const called = new Set();
for (const m of HTML_CODE.matchAll(/\son(?:click|change|input|submit|blur|focus)="([A-Za-z_$][\w$]*)\(/g)) {
  if (!NOT_FUNCTIONS.has(m[1])) called.add(m[1]);
}
const missing = [...called].filter(n => !defined.has(n)).sort();
t('죽은 인라인 핸들러가 0개다', missing.length === 0, missing.join(', '));
t('검사가 실제로 돌았다 (핸들러를 50개 이상 확인)', called.size >= 50, called.size);
t('addCoverSlide 를 부르는 곳이 없다 (2026-08-08 사고 당사자)',
  !/addCoverSlide/.test(HTML_CODE), 'admin.html 에 아직 남아 있다');

console.log('\n=== ② 없는 함수를 최상위에서 감싸지 않는다 ===');
/* `var _origX = someFn;` 형태는 someFn 이 없으면 로드 시점에 던진다.
   이 패턴이 남아 있다면 대상이 반드시 정의돼 있어야 한다. */
const LITERALS = new Set(['null', 'undefined', 'false', 'true']);   // 래핑이 아니라 초기화
const bare = [...JS_CODE.matchAll(/^var\s+(_orig[A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gm)];
const badWrap = bare
  .filter(m => !LITERALS.has(m[2]) && !defined.has(m[2]))
  .map(m => m[2] + ' (' + m[1] + ')');
t('맨 참조로 감싸는 래퍼의 대상이 전부 존재한다', badWrap.length === 0, badWrap.join(', '));
t('addCoverSlide / deleteCover 래퍼가 제거됐다',
  !/_origAddCoverSlide|_origDeleteCover\b/.test(JS_CODE));

console.log('\n=== ③ 래퍼는 대상이 없어도 죽지 않는다 ===');
t('_wrapWithPersist 헬퍼가 있다', /function _wrapWithPersist\(name, wrap\)/.test(JS));
t('대상이 함수가 아니면 건너뛴다', /typeof orig !== 'function'/.test(JS));
t('건너뛸 때 조용하지 않다 (경고를 남긴다)', /console\.warn\('\[pap-admin\] 래핑 대상이 없습니다/.test(JS));
t('살아 있는 셋은 계속 감싼다',
  /_wrapWithPersist\('saveBanner'/.test(JS)
  && /_wrapWithPersist\('saveCat'/.test(JS)
  && /_wrapWithPersist\('deleteBanner'/.test(JS));

console.log('\n=== ④ 죽어 있던 최상위 상태값이 살아 있다 ===');
/* 이 값들은 사고 당시 undefined 였다. 최상위 `var` 로 남아 있는지 본다 —
   하나라도 사라지면 그 기능이 다시 조용히 죽는다. */
for (const v of ['_originalGo', 'intAds', 'editAdId', '_papDlState', 'LT_LANGS', '_ltState']) {
  t(v + ' 가 최상위에 선언돼 있다',
    new RegExp('^var\\s+' + v.replace('$', '\\$') + '\\s*=', 'm').test(JS));
}
/* 그리고 그 선언들이 예외를 던지는 줄보다 뒤에 있어도 안전해야 한다 —
   즉 파일에 '맨 참조 최상위 할당'이 더 없어야 한다(위 ②가 그걸 지킨다). */

console.log('\n=== 캐시버스트 ===');
const ver = (HTML_CODE.match(/pap-admin\.js\?v=(\d+)/) || [])[1];
t('pap-admin.js 버전이 141 이상', Number(ver) >= 141, ver);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ admin-dead-handler tests passed');
