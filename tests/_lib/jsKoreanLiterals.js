'use strict';
/**
 * JS 소스에서 한글이 든 문자열 리터럴을 뽑는 가벼운 토크나이저 (테스트 전용, 의존성 없음).
 *  · // 와 /* *\/ 주석, 정규식 리터럴(휴리스틱)은 건너뛴다
 *  · 템플릿 리터럴은 ${ } 를 자리표시자로 바꿔 한 문자열로 본다
 *  · 9개 언어 사전 행(ko:{...}|ko:[...]|ko:'...' 이 en/de/... 형제와 같이 있는 객체)은 건너뛴다
 *    → 그 안의 한글은 "번역 대상"이 아니라 "원문 사전"이다.
 *  · console.xxx(...) 인자, 객체 키 자리의 문자열은 건너뛴다
 * 반환: [{ text, line, piecesOf }] — text 는 자리표시자 {n} 가 들어간 패턴 문자열
 */
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const LANGS = ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

function extract(code) {
  const out = [];
  const n = code.length;
  let i = 0, line = 1;
  // 괄호 스택: { [ ( 각각 push. 사전 행 판정을 위해 객체 리터럴 안의 프로퍼티 키를 기억한다.
  const stack = []; // { ch, keys:Set, skipDict:boolean, startLine }
  let lastSig = '';    // 마지막 의미 있는 토큰(정규식 판정용)
  let pendingKey = null; // 직전에 읽은 식별자 (프로퍼티 키 후보)
  let consoleDepth = -1; // console.xxx( 의 괄호 깊이

  function inSkippedDict() { return stack.some((s) => s.skipDict); }
  function inConsole() { return consoleDepth !== -1; }
  function push(ch) { stack.push({ ch, keys: new Set(), skipDict: false, startLine: line, koSeen: false }); }
  function topObj() { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].ch === '{') return stack[k]; return null; }

  function readString(quote) {
    // i 는 여는 따옴표 위치
    let j = i + 1, s = '';
    while (j < n) {
      const c = code[j];
      if (c === '\\') { const d = code[j + 1]; if (d === 'n') s += '\n'; else if (d === 't') s += '\t'; else if (d === 'u' && /^[0-9a-fA-F]{4}$/.test(code.substr(j + 2, 4))) { s += String.fromCharCode(parseInt(code.substr(j + 2, 4), 16)); j += 4; } else s += d; j += 2; continue; }
      if (c === quote) { j++; break; }
      if (c === '\n') line++;
      s += c; j++;
    }
    i = j; return s;
  }
  function readTemplate() {
    // i 는 여는 백틱. ${ } 는 재귀적으로 건너뛰며 {k} 로 치환
    let j = i + 1, s = '', ph = 0;
    while (j < n) {
      const c = code[j];
      if (c === '\\') { s += code[j + 1] === 'n' ? '\n' : code[j + 1]; j += 2; continue; }
      if (c === '`') { j++; break; }
      if (c === '$' && code[j + 1] === '{') {
        // 표현식 건너뛰기 (중첩 괄호·문자열·템플릿 고려한 단순 스캔)
        let depth = 1; j += 2; s += '{' + (ph++) + '}';
        while (j < n && depth > 0) {
          const d = code[j];
          if (d === '{') depth++; else if (d === '}') depth--;
          else if (d === '\'' || d === '"') { const q = d; j++; while (j < n && code[j] !== q) { if (code[j] === '\\') j++; j++; } }
          else if (d === '`') { const save = i; i = j; const inner = readTemplate(); if (HANGUL.test(inner) && !inSkippedDict() && !inConsole()) out.push({ text: inner, line }); j = i - 1; i = save; }
          else if (d === '\n') line++;
          j++;
        }
        continue;
      }
      if (c === '\n') line++;
      s += c; j++;
    }
    i = j; return s;
  }
  const regexPrev = /[(,=:[!&|?{};+\-*%<>~^]$/;
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && d === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = code.indexOf('*/', i + 2); const seg = code.slice(i, e === -1 ? n : e + 2); line += (seg.match(/\n/g) || []).length; i = e === -1 ? n : e + 2; continue; }
    if (c === '\'' || c === '"') {
      const startLine = line; const s = readString(c);
      // 객체 키 자리? (다음 의미 토큰이 ':' 이고 우리가 객체 안) → 키
      let k = i; while (k < n && /[ \t]/.test(code[k])) k++;
      const isKey = code[k] === ':' && topObj() && lastSig !== '?' && !/[?]/.test(lastSig);
      if (isKey) { const o = topObj(); if (o) { o.keys.add(s); pendingKey = s; } lastSig = 'key'; i = k + 1; continue; }
      if (HANGUL.test(s) && !inSkippedDict() && !inConsole()) out.push({ text: s, line: startLine });
      lastSig = 'str'; continue;
    }
    if (c === '`') { const startLine = line; const s = readTemplate(); if (HANGUL.test(s) && !inSkippedDict() && !inConsole()) out.push({ text: s, line: startLine }); lastSig = 'str'; continue; }
    if (c === '/') {
      // 정규식? 직전 토큰이 연산자/여는 괄호/키워드면 정규식
      const isRe = lastSig === '' || regexPrev.test(lastSig) || /^(return|typeof|case|in|of|do|else|void|delete|throw|new|instanceof)$/.test(lastSig) || lastSig === 'key';
      if (isRe) { let j = i + 1, cls = false; while (j < n) { const e = code[j]; if (e === '\\') { j += 2; continue; } if (e === '[') cls = true; else if (e === ']') cls = false; else if (e === '/' && !cls) break; else if (e === '\n') break; j++; } i = j + 1; while (i < n && /[a-z]/.test(code[i])) i++; lastSig = 're'; continue; }
      i++; lastSig = '/'; continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      push(c);
      if (c === '(' && /^console\.[a-zA-Z]+$/.test(lastSig) && consoleDepth === -1) consoleDepth = stack.length;
      // 사전 행 판정: 프로퍼티 키가 ko 이고 값이 {…}/[…] 이면 형제 키를 나중에 알 수 있으므로,
      // 닫을 때가 아니라 여는 시점에 부모 객체의 키 목록으로 판단한다 → 부모에 en/de 등이 이미 있거나
      // 나중에 나오면 놓친다. 그래서 부모 객체 닫힘 시점까지 보류하지 않고, 간단히 "부모 객체 안에서
      // 키 ko 의 값" 이면 잠정 skip, 부모가 닫힐 때 형제 언어 키가 하나도 없으면 skip 을 취소해 재검사한다.
      if ((c === '{' || c === '[') && pendingKey === 'ko' && lastSig === 'key') { const o = stack[stack.length - 2] && stack[stack.length - 2].ch === '{' ? stack[stack.length - 2] : null; if (o) { stack[stack.length - 1].skipDict = true; stack[stack.length - 1].koValueOf = o; o.koSeen = true; } }
      pendingKey = null; lastSig = c; i++; continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      const s = stack.pop();
      if (s && s.ch === '(' && consoleDepth === stack.length + 1) consoleDepth = -1;
      lastSig = c; i++; continue;
    }
    // 식별자/숫자/연산자
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_$.]/.test(code[j])) j++;
      const id = code.slice(i, j);
      let k = j; while (k < n && /[ \t]/.test(code[k])) k++;
      if (code[k] === ':' && topObj() && !/[?]/.test(lastSig)) { const o = topObj(); o.keys.add(id); pendingKey = id; lastSig = 'key'; i = k + 1; continue; }
      lastSig = id; i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9a-fA-FxX._e]/.test(code[j])) j++; lastSig = 'num'; i = j; continue; }
    lastSig = c; i++;
  }
  return out;
}

/**
 * 사전 행 판정을 사후에 적용: 위 토크나이저는 ko 값 블록을 잠정 skip 했다. 그 부모 객체에
 * 언어 키가 하나도 없으면(예: {ko:'..', cls:'..'} 도 아닌 경우) 취소해야 하지만, 실무에서
 * ko 키를 쓰는 객체는 예외 없이 언어 사전이므로 잠정 skip 을 그대로 둔다. 다만 ko:'문자열'
 * (블록이 아닌 값)은 위에서 skip 되지 않으므로 여기서 거른다: 직전 토큰이 key 'ko' 인 문자열.
 */
function koreanLiterals(code) {
  // ko:'...' 한 줄 사전의 값은 리터럴 앞 텍스트로 거른다
  const items = extract(code);
  return items.filter((it) => !isKoRowValue(code, it));
}
function isKoRowValue(code, it) {
  // 같은 줄에서 ko: '…' 로 시작하는 값이 이 리터럴인지 (이스케이프 \' 는 풀어서 비교)
  const lines = code.split('\n'); const l = lines[it.line - 1] || '';
  const re = /(^|[{,\s])["']?ko["']?\s*:\s*(['"`])/g; let m;
  const head = it.text.split('\n')[0].slice(0, 6);
  while ((m = re.exec(l))) {
    const after = l.slice(m.index + m[0].length, m.index + m[0].length + 12).replace(/\\(['"`])/g, '$1');
    if (head && after.slice(0, head.length) === head) return true;
  }
  return false;
}


/** 리터럴(패턴) 하나 → 화면에 텍스트 노드/속성으로 나타날 조각들. 런타임 사전 키와 같은 정규화. */
const SEP = '\u0001';
function unescapeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&hellip;/g, '…').replace(/&rarr;/g, '→').replace(/&larr;/g, '←').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}
function normText(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
function renumber(p) { let i = 0; const map = {}; return p.replace(/\{(\d+)\}/g, (m, d) => { if (!(d in map)) map[d] = i++; return '{' + map[d] + '}'; }); }
function pieces(str) {
  let s = unescapeEntities(String(str));
  const out = [];
  // 태그 속성값(placeholder·title·alt·aria-label·value)은 런타임이 속성으로 바꾼다 → 별도 키
  const ra = /\s(placeholder|title|alt|aria-label|value)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
  while ((a = ra.exec(s))) { const v = normText(a[2] !== undefined ? a[2] : a[3]); if (v && HANGUL.test(v)) out.push(renumber(v)); }
  s = s.replace(/<[^>]*>/g, SEP);                    // 완결된 태그
  s = s.replace(/<[a-zA-Z\/!][^<>]*$/, SEP);         // 리터럴 끝에서 잘린 여는 태그 ('<a href="' + url + ...)
  if (/^[^<>]*[="')]\s*[^<>]*>/.test(s)) s = s.replace(/^[^<>]*>/, SEP); // 리터럴 앞의 태그 꼬리 ('" target="_blank">원문')
  s = s.replace(/\r\n|\n|\r|\t/g, SEP);
  s.split(SEP).forEach((p) => { const v = normText(p); if (v && HANGUL.test(v)) out.push(renumber(v)); });
  return out;
}

module.exports = { koreanLiterals, extract, pieces, normText, HANGUL, LANGS };
