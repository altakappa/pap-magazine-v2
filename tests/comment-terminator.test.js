/**
 * 블록 주석 조기 종료 가드 (2026-08-05 신설).
 *
 * 실제 사고 — 오늘, 이 커밋 직전:
 *   에디토리얼 번역 중단 근거를 주석으로 적으면서 이렇게 썼다.
 *       *   · ..(별표둘)/es/editorial/* 는 전부 0클릭
 *   마크다운처럼 굵게 표시하려고 붙인 별표 두 개 뒤에 경로의 슬래시가 와서
 *   `*` + `/` = 주석 종료 기호가 만들어졌다. **주석이 거기서 끝났고 나머지
 *   설명문이 코드로 해석됐다.**
 *
 *   무서운 건 `node --check` 가 통과했다는 점이다. 문법 오류가 아니라 '다른
 *   유효한 코드'가 되어버렸기 때문이다. 잡아준 건 테스트 하나뿐이었고,
 *   그마저도 엉뚱한 곳("맞는 시크릿 200")이 깨져 원인을 찾는 데 시간이 걸렸다.
 *
 * 이 저장소는 이미 이 함정을 알고 있었다 — backfill-translations.js 의
 * vercel.json 인용 주석은 `api/(별표둘)\/(별표).js` 처럼 슬래시를 이스케이프해 두었다.
 * 아는 사람만 아는 규칙이었던 것을 기계가 강제하게 만든다.
 *
 * 규칙: api/** 의 .js 에서 문자열 밖에 `(별표)(별표)/` 가 나오면 실패.
 *       주석 안이라면 이스케이프(`\/`)하고, 코드라면 문자열로 감싼다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HAZARD = '*' + '*' + '/';          // 이 파일 자신이 걸리지 않도록 쪼개서 만든다

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

/** 문자열·템플릿 리터럴을 공백으로 지운 사본을 만든다 (주석은 그대로 둔다). */
function stripStrings(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i];
    // 줄 주석 / 블록 주석은 그대로 통과시킨다 (검사 대상이므로)
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out += src[i]; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      out += src[i] + src[i + 1]; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i]; i++; }
      if (i < n) { out += src[i] + src[i + 1]; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += ' '; i++; }
        if (i < n) { out += ' '; i++; }
      }
      out += ' '; i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(ROOT, 'api'), []);
console.log('\n=== api/ .js 파일 ' + files.length + '개 검사 ===');

const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(HAZARD)) continue;
  const stripped = stripStrings(src);
  if (!stripped.includes(HAZARD)) continue;      // 문자열 안이면 안전
  const line = src.slice(0, src.indexOf(HAZARD)).split('\n').length;
  offenders.push(path.relative(ROOT, f) + ':' + line);
}

t('문자열 밖에 주석 조기 종료를 만드는 자리가 없다', offenders.length === 0, offenders);

console.log('\n=== 검사기 자체가 동작하는지 (역검증) ===');
// 오늘 실제로 깨졌던 모양을 그대로 넣어 본다.
const bad = '/* 설명\n *   · ' + HAZARD + 'es/editorial/* 는 0클릭\n * 계속 */\nconst x = 1;';
t('사고 당시 코드를 넣으면 잡아낸다', stripStrings(bad).includes(HAZARD));
// 이스케이프한 형태(저장소의 기존 관행)는 통과해야 한다.
const okEscaped = '/* "api/*' + '*\\/*.js" 설정 */\nconst y = 2;';
t('이스케이프한 형태는 통과시킨다', !stripStrings(okEscaped).includes(HAZARD));
// 문자열 안의 글롭 패턴은 통과해야 한다 (vercel.json 키 등).
const okString = 'const g = "api/*' + '*/*.js";';
t('문자열 안 글롭 패턴은 통과시킨다', !stripStrings(okString).includes(HAZARD));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ comment-terminator tests passed');
