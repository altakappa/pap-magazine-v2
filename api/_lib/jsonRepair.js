/**
 * 모델이 낸 JSON 을 살려 파싱한다 — 공용 (2026-08-18 분리)
 *
 * 원래 seoTranslateBackfill.js 안에만 있었다. 2026-08-16 에 weekly-news 가
 * 똑같은 이유로 죽으면서(아래) 두 번째 사용처가 생겼고, 그때 복사했으면
 * 규칙이 두 벌이 됐을 것이다. 이 저장소가 반복해서 배운 교훈이라 옮긴다.
 *
 *   2026-08-16 21:31  weekly-news  ok=false
 *   주간 뉴스레터 생성 실패: Expected ',' or '}' after property value
 *   in JSON at position 3502 (line 65 column 91)
 *
 * 무엇을 고치나 — 모델이 JSON 을 낼 때 실제로 내는 두 가지 흠만 고친다.
 *   ① 문자열 안의 생 제어문자(개행·탭). JSON 규격 위반이지만 내용은 멀쩡하다
 *   ② 문자열 안의 이스케이프 안 된 따옴표. 이건 위험해서 deep 일 때만 손댄다
 *
 * 고치지 않는 것: 구조가 잘린 응답. 그건 복구가 아니라 창작이다.
 *
 * ⚠️ 이 함수들은 '망가진 JSON 을 고친다' 가 아니라 '고쳐서 한 번 더 시도한다'
 *    이다. 실패하면 null 을 돌려주고, 호출부는 원래 실패 경로를 그대로 탄다.
 *    조용히 성공한 척하지 않는다.
 */
'use strict';

/* 문자열 안의 생 제어문자를 이스케이프한다.
   문자열 밖의 개행은 건드리지 않는다 — 그건 정상이다. */
function escapeRawControls(s) {
  let out = '', inStr = false, esc = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; if (inStr) esc = true; continue; }
    if (c === '"') { out += c; inStr = !inStr; continue; }
    if (inStr && c < ' ') {
      out += (c === '\n') ? '\\n' : (c === '\r') ? '\\r' : (c === '\t') ? '\\t'
        : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
      continue;
    }
    out += c;
  }
  return out;
}

/* 값 안의 이스케이프 안 된 따옴표를 살린다.
   닫는 따옴표인지 내용인지는 **뒤에 오는 글자**로 판단한다:
   공백을 건너뛴 다음 글자가 , : } ] 또는 끝이면 진짜 경계다.
   완벽하지 않다 — 그래서 최후의 수단(deep)일 때만 쓴다. */
function escapeInnerQuotes(s) {
  let out = '', inStr = false, esc = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; if (inStr) esc = true; continue; }
    if (c !== '"') { out += c; continue; }
    if (!inStr) { out += c; inStr = true; continue; }
    let n = k + 1;
    while (n < s.length && (s[n] === ' ' || s[n] === '\n' || s[n] === '\r' || s[n] === '\t')) n++;
    const next = n < s.length ? s[n] : '';
    if (next === ',' || next === ':' || next === '}' || next === ']' || next === '') {
      out += c; inStr = false;                 // 진짜 경계
    } else {
      out += '\\"';                            // 내용이다
    }
  }
  return out;
}

/** 고쳐서 한 번 더 파싱. 실패하면 null (호출부가 원래 경로를 탄다).
 *  @param {string} chunk  JSON 조각
 *  @param {boolean} deep  따옴표까지 손댈지 (최후의 수단) */
function tryRepairedParse(chunk, deep) {
  try {
    const fixed = deep ? escapeInnerQuotes(escapeRawControls(chunk)) : escapeRawControls(chunk);
    return JSON.parse(fixed);
  } catch (e) { return null; }
}

/**
 * 균형 잡힌 덩어리를 전부 찾는다 — 문자열 안의 괄호는 세지 않는다. (2026-08-25)
 *
 * 왜 필요한가 — indexOf('[') ~ lastIndexOf(']') 로 한 덩어리를 자르는 방식은
 * 모델이 **답을 하나만** 낸다고 전제한다. 실제로는 자주 이렇게 낸다:
 *
 *   ```json [ …진짜 답… ] ```  그 뒤에 **분석 결과: 해당 없음** … (산문에 ] 가 섞임)
 *   ```json [ …초안… ] ```  **재검토 후 최종 답변:**  ```json [ …진짜 답… ] ```
 *
 * 두 경우 다 첫 여는 괄호부터 마지막 닫는 괄호까지 통째로 자르면
 * "Unexpected non-whitespace character after JSON at position N" 이 난다.
 * 복구 계단 세 칸은 **문법 흠**을 고치는 장치라 이 모양을 못 산다 —
 * 여기서 필요한 건 수리가 아니라 **덩어리 고르기**다.
 *
 * 실측: competitor-watch 2026-08-19(2회)·08-20(1회) 실패가 전부 이 모양이었다.
 */
function findBalancedChunks(s, open, close) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) { if (depth === 0) start = k; depth++; continue; }
    if (c === close && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) { out.push(s.slice(start, k + 1)); start = -1; }
    }
  }
  return out;
}

/* 덩어리 하나를 계단 세 칸으로 시도한다. 못 살리면 null — 삼키지 않는다. */
function ladderParse(chunk, wantArray) {
  const good = (v) => wantArray ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v);
  try { const v = JSON.parse(chunk); if (good(v)) return { value: v, repaired: 'none' }; } catch (e) { /* 다음 칸 */ }
  const ctrl = tryRepairedParse(chunk, false);
  if (good(ctrl)) return { value: ctrl, repaired: 'controls' };
  const deep = tryRepairedParse(chunk, true);
  if (good(deep)) return { value: deep, repaired: 'quotes' };
  return null;
}

/* 마지막 칸 — 덩어리를 다시 골라 본다.
   뒤에서부터 본다: 모델이 두 번 답하면 **나중 것이 최종 답변**이다
   ("재검토 후 최종 답변:" — 2026-08-19 실측). 이미 실패한 덩어리는 건너뛴다. */
function pickBalancedChunk(s, tried, wantArray) {
  const open = wantArray ? '[' : '{';
  const close = wantArray ? ']' : '}';
  const cands = findBalancedChunks(s, open, close);
  for (let i = cands.length - 1; i >= 0; i--) {
    if (cands[i] === tried) continue;
    const r = ladderParse(cands[i], wantArray);
    if (r) return { value: r.value, repaired: 'block' + (r.repaired === 'none' ? '' : '-' + r.repaired) };
  }
  return null;
}


/* ── 다섯째 칸: 활자 따옴표를 닫아 준다 (2026-09-03) ──────────────────────
 *
 * ■ 실측 — 독일어(de)가 3시간 내내 0건이었다
 *
 * 알림은 "차례가 안 돌아온다(회전이 죽었다)" 라고 했지만 cron_runs 노트를
 * 세어 보니 선두 언어는 매 회전 바뀌고 있었다(ru→zh→de→ja→es→fr→it).
 * **회전은 멀쩡했다. de 만 차례가 올 때마다 실패했다.**
 *
 * 런타임 로그의 응답 머리:
 *
 *     "a":"Ausgehend von Diego Riveras „Der Blumenträger" verbindet dieses …
 *                                       ↑ 여는 건 활자 따옴표   ↑ 닫는 건 ASCII "
 *
 * 독일어 관용 따옴표는 „ … “ 인데 모델이 닫는 쪽만 ASCII " 로 쓴다. 그 순간
 * JSON 문자열이 거기서 끝나 버린다. 프랑스어 «…», 러시아어 «…» 도 같은 위험.
 *
 * ■ 왜 기존 계단으로 못 살았나
 *
 * escapeInnerQuotes(셋째 칸)는 짧은 예제에서는 살린다. 그런데 한 응답에
 * 이런 짝이 여러 번 나오면 inStr 추적이 어긋난다. findBalancedChunks 도
 * 같은 이유로 덩어리 경계를 잘못 잡는다 — **따옴표가 깨지면 문자열을 세는
 * 모든 장치가 같이 깨진다.**
 *
 * ■ 규칙
 *
 * 여는 활자 따옴표 뒤에 오는 ASCII " 만, 그 언어의 닫는 활자 따옴표로 바꾼다.
 * 이스케이프된 \" 는 건드리지 않는다. 원문이 그대로 파싱될 때는 **아예 돌지
 * 않는다** — 마지막 칸에서만 부른다. 고쳐 놓고 성공한 척하지 않는다. */
const TYPO_CLOSER = {
  '„': '“',   // „ 독일어  → “
  '«': '»',   // « 프랑스어·러시아어 → »
  '‚': '‘',   // ‚ → ‘
  '‹': '›',   // ‹ → ›
  '“': '”',   // “ → ”
};
const TYPO_OPEN_RE = new RegExp(
  '([„«‚‹“])' +          // 여는 활자 따옴표
  '([^"„«‚‹“”»‘›\\n]{1,300}?)' +
  '(?<!\\\\)"', 'g');                              // 이스케이프 안 된 ASCII "
function closeTypographicQuotes(s) {
  return String(s).replace(TYPO_OPEN_RE,
    (m, open, inner) => open + inner + (TYPO_CLOSER[open] || '”'));
}


/* ── 여섯째 칸: 괄호 종류가 틀린 것을 바로잡는다 (2026-09-05) ──────────────
 *
 * ■ 실측 — 어제 붙인 '버린 이유' 로그가 바로 답을 줬다
 *
 *   [faq-i18n] fr 줄 버림 len=769
 *   | why=Expected ',' or ']' after array element in JSON at position 768
 *   | tail="…post-apocalyptique.\"}}"
 *
 * 꼬리가 `}}` 다. 정답은 `}]}`. 모델이 **배열 닫는 ] 자리에 } 를 썼다.**
 *
 *   {"i":4,"faq":[{…},{…}}      ← ] 가 } 로 바뀌었다
 *
 * 2026-09-02 에 기록한 "모델이 바깥 ] 를 빼먹는다" 와 같은 병인데, 이번엔
 * **한 줄 안쪽의 faq 배열**에서 났다. 앞의 다섯 칸(제어문자·따옴표·덩어리
 * 고르기·활자따옴표)은 전부 **문법 흠**을 고치는 장치라 이 모양을 못 산다.
 *
 * ■ 규칙 — 여는 괄호 스택을 보고, 짝이 틀린 닫는 괄호만 바로잡는다
 *
 *   여는 것을 쌓는다. 닫는 것이 오면 스택 맨 위와 맞춰 본다.
 *     맞으면      그대로 둔다
 *     안 맞으면   스택 맨 위에 맞는 글자로 **바꾼다** (} ↔ ])
 *   문자열 안은 세지 않는다. 이스케이프도 건너뛴다.
 *   스택이 비었는데 닫는 게 오면 **손대지 않는다** — 그건 구조가 깨진 것이지
 *   괄호 종류가 틀린 게 아니다. 모르는 건 고치지 않는다.
 *
 * 원문이 그대로 파싱되면 이 함수는 **아예 안 돈다** (마지막 칸에서만 부른다). */
const OPENERS = { '{': '}', '[': ']' };
function fixBracketKinds(input) {
  const s = String(input);
  let out = '';
  const stack = [];
  let inStr = false, esc = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      out += c;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { out += c; inStr = true; continue; }
    if (c === '{' || c === '[') { stack.push(OPENERS[c]); out += c; continue; }
    if (c === '}' || c === ']') {
      if (!stack.length) { out += c; continue; }   // 짝 없는 닫는 괄호 — 안 건드린다
      out += stack.pop();                          // 스택이 정답이다
      continue;
    }
    out += c;
  }
  /* ■ 실측을 다시 보니 '종류가 틀린' 게 아니라 **하나가 통째로 빠졌다**
     꼬리 `"}}` 의 정답은 `"}]}` 다. 글자 수가 하나 적다. 종류만 바로잡으면
     맨 바깥 { 가 안 닫힌 채로 끝난다(첫 시도에서 그대로 실패했다).

     그래서 남은 스택을 닫아 준다. 단, **아무 때나 닫지 않는다.**
       · 문자열 한가운데서 끝났으면 손대지 않는다
       · 마지막 글자가 닫는 괄호가 아니면 손대지 않는다
     이 두 가지가 '괄호만 모자란 응답' 과 '중간에 잘린 응답' 을 가른다.
     잘린 응답을 닫아 버리면 반쪽 FAQ 를 완성품으로 만든다 — 그건 복구가
     아니라 창작이고, 이 파일 머리말이 하지 말라고 못박은 짓이다. */
  if (stack.length && !inStr) {
    const tail = out.replace(/\s+$/, '');
    const last = tail.charAt(tail.length - 1);
    if (last === '}' || last === ']') {
      while (stack.length) out += stack.pop();
    }
  }
  return out;
}

/**
 * 객체 하나를 뽑는다 — 계단식. (2026-08-18 신설, weekly-news 용)
 *
 * seoTranslateBackfill 의 parseJsonArray 는 **배열** 전용이다. 뉴스레터는
 * 객체 하나를 받으므로 같은 계단을 객체용으로 만든다.
 *
 *   1) 그대로 파싱                  대부분 여기서 끝난다
 *   2) 제어문자만 고쳐서            생 개행 때문이면 여기서 산다
 *   3) 따옴표까지 고쳐서 (deep)     최후의 수단
 *
 * @returns {{value:object, repaired:('none'|'controls'|'quotes'|'block'|'block-controls'|'block-quotes')}}
 * @throws  세 칸 모두 실패하면 던진다. 삼키지 않는다.
 */
function parseJsonObject(text, label, _retry) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  const what = label || 'JSON';
  if (start === -1 || end <= start) {
    throw new Error(what + ' 응답에서 객체를 찾지 못함: ' + s.slice(0, 150));
  }
  const chunk = s.slice(start, end + 1);

  try { return { value: JSON.parse(chunk), repaired: 'none' }; } catch (e) { /* 다음 칸 */ }

  const ctrl = tryRepairedParse(chunk, false);
  if (ctrl && typeof ctrl === 'object') return { value: ctrl, repaired: 'controls' };

  const deep = tryRepairedParse(chunk, true);
  if (deep && typeof deep === 'object') return { value: deep, repaired: 'quotes' };

  /* 계단 넷째 칸 (2026-08-25): 응답에 객체가 여러 개거나 뒤에 산문이 붙은 모양.
     문법 수리로는 못 산다 — 균형 잡힌 덩어리를 다시 골라 본다. */
  const picked = pickBalancedChunk(s, chunk, false);
  if (picked) return picked;

  /* 다섯째 칸 (2026-09-03) — 활자 따옴표를 닫고 계단을 통째로 한 번 더. */
  if (!_retry) {
    for (const [고침, 이름] of [[closeTypographicQuotes, 'typo-quotes'], [fixBracketKinds, 'bracket-kind']]) {
      const fixed = 고침(s);
      if (fixed === s) continue;
      try {
        const r = parseJsonObject(fixed, label, true);
        return { value: r.value, repaired: (r.repaired === 'none' ? '' : r.repaired + '+') + 이름 };
      } catch (_) { /* 다음 고침으로 · 다 실패하면 원래 오류를 낸다 */ }
    }
  }

  /* 여기까지 오면 진짜 못 고친다. 무엇이 문제였는지를 오류에 싣는다 —
     2026-08-08 에 같은 자리에서 앞머리 50자만 잘라 남겨 87% 의 실패를 보고도
     원인을 못 가른 적이 있다. 위치 주변을 보여준다. */
  let detail = '';
  try { JSON.parse(chunk); } catch (e) {
    const m = /position (\d+)/.exec(String(e && e.message));
    const pos = m ? Number(m[1]) : -1;
    detail = String(e && e.message);
    if (pos >= 0) detail += ' :: …' + chunk.slice(Math.max(0, pos - 60), pos + 60) + '…';
  }
  throw new Error(what + ' 객체 파싱 실패 (제어문자·따옴표 복구도 실패): ' + detail);
}

/**
 * 배열 하나를 뽑는다 — 위 parseJsonObject 의 배열판. (2026-08-18)
 *
 * seoTranslateBackfill 에도 같은 이름의 함수가 있지만 그건 번역 배치 전용
 * 계약(살리기·센티넬)이 얽혀 있어 건드리지 않는다. 여기 것은 "AI 가 준
 * 배열 하나를 계단식으로 파싱한다" 만 한다. competitor-watch 처럼 배열을
 * 받는 크론이 각자 JSON.parse 를 한 번씩 쓰던 것을 이걸로 모은다.
 *
 * @returns {{value:Array, repaired:('none'|'controls'|'quotes'|'block'|'block-controls'|'block-quotes')}}
 * @throws  세 칸 모두 실패하면 던진다. 삼키지 않는다.
 */
function parseJsonArray(text, label, _retry) {
  const s = String(text || '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  const what = label || 'JSON';
  if (start === -1 || end <= start) {
    throw new Error(what + ' 응답에서 배열을 찾지 못함: ' + s.slice(0, 150));
  }
  const chunk = s.slice(start, end + 1);

  try {
    const v = JSON.parse(chunk);
    if (Array.isArray(v)) return { value: v, repaired: 'none' };
  } catch (e) { /* 다음 칸 */ }

  const ctrl = tryRepairedParse(chunk, false);
  if (Array.isArray(ctrl)) return { value: ctrl, repaired: 'controls' };

  const deep = tryRepairedParse(chunk, true);
  if (Array.isArray(deep)) return { value: deep, repaired: 'quotes' };

  /* 계단 넷째 칸 (2026-08-25): 배열이 두 개거나 뒤에 산문이 붙은 모양.
     competitor-watch 가 08-19·08-20 에 이걸로 3번 죽었다. */
  const picked = pickBalancedChunk(s, chunk, true);
  if (picked) return picked;

  /* 다섯째 칸 (2026-09-03) — 활자 따옴표를 닫고 계단을 통째로 한 번 더. */
  if (!_retry) {
    for (const [고침, 이름] of [[closeTypographicQuotes, 'typo-quotes'], [fixBracketKinds, 'bracket-kind']]) {
      const fixed = 고침(s);
      if (fixed === s) continue;
      try {
        const r = parseJsonArray(fixed, label, true);
        return { value: r.value, repaired: (r.repaired === 'none' ? '' : r.repaired + '+') + 이름 };
      } catch (_) { /* 다음 고침으로 · 다 실패하면 원래 오류를 낸다 */ }
    }
  }

  let detail = '';
  try { JSON.parse(chunk); } catch (e) {
    const m = /position (\d+)/.exec(String(e && e.message));
    const pos = m ? Number(m[1]) : -1;
    detail = String(e && e.message);
    if (pos >= 0) detail += ' :: \u2026' + chunk.slice(Math.max(0, pos - 60), pos + 60) + '\u2026';
  }
  throw new Error(what + ' 배열 파싱 실패 (제어문자·따옴표 복구도 실패): ' + detail);
}

/**
 * 줄 단위(JSONL) 파싱 — 온전한 최상위 객체만 골라낸다 (2026-09-02 신설)
 *
 * ■ 왜 만들었나 — 실측 (backfill-faq, 2026-09-02 08:33 런타임 로그)
 *
 *   [faq-en] articles   batch=4 stop_reason=end_turn len=3285
 *     tail=...since 2022."}]}}```
 *   [faq-en] editorials batch=8 stop_reason=end_turn len=5922
 *     tail=...beyond the clouds."}]```
 *
 * 세 가지가 동시에 참이었다.
 *   ① stop_reason=end_turn — **잘린 게 아니다.** 길이도 상한의 절반이 안 된다.
 *      "배치가 커서 잘렸다" 는 종전 진단이 여기서는 틀렸다.
 *   ② 응답에 **바깥 배열의 닫는 `]` 가 없다.** 기사는 그 자리에 `}` 가 왔고,
 *      화보는 원소 닫는 `}` 와 바깥 `]` 가 둘 다 없다.
 *   ③ 그게 확실한 이유: findBalancedChunks 는 대괄호 깊이가 0 으로 돌아오는
 *      구간만 모은다. 바깥 `]` 가 있었다면 전체 배열이 균형 덩어리로 잡혀
 *      **넷째 칸이 살렸을 것이다.** 넷째 칸도 실패했다 = 균형 잡힌 최상위
 *      배열이 응답에 아예 없다.
 *
 * 게다가 parseJsonArray 는 indexOf('[') ~ lastIndexOf(']') 로 자른다.
 * 바깥 `]` 가 없으면 마지막 `]` 는 **원소 안쪽 faq 배열**의 것이라, 자른 조각이
 * 반드시 깨진다. 파싱 실패 위치가 매번 끝에서 12~14자인 것도 이걸로 설명된다.
 *
 * ■ 무엇을 하나
 * 대괄호를 아예 세지 않고 **중괄호만** 센다. 최상위에서 균형 잡힌 `{...}` 를
 * 순서대로 모아 각각 계단 세 칸으로 파싱한다.
 *
 *   · 바깥 배열이 있든 없든 상관없다 — `[` 를 안 세니까.
 *   · 한 줄이 깨져도 **그 한 건만** 잃는다. 지금은 8건 중 하나만 어긋나도 전멸이다.
 *   · 구조를 지어내지 않는다. 닫는 괄호를 상상해서 채우지 않고, **온전한 것만**
 *     가져간다. 이 파일 머리말의 원칙("잘린 응답은 복구가 아니라 창작이다")을
 *     그대로 지킨다.
 *
 * ■ 삼키지 않는다
 * 하나도 못 건지면 빈 배열이 아니라 **던진다.** 0건을 조용히 성공으로 보고하면
 * 2026-08-04 에 FAQ 백필이 2주간 성실히 0건을 만들던 상태로 되돌아간다.
 *
 * @param {string} text   모델 응답 원문 (코드펜스·산문이 섞여 있어도 된다)
 * @param {string} label  오류 메시지에 찍을 이름
 * @returns {{value:object[], repaired:string, dropped:number}}
 *          dropped = 균형은 잡혔지만 파싱에 실패한 덩어리 수 (있으면 note 에 남길 것)
 * @throws  건진 게 하나도 없으면 던진다
 */
function _linesOnce(s, what) {
  const chunks = findBalancedChunks(s, '{', '}');
  if (!chunks.length) {
    throw new Error(what + ' 응답에서 객체를 하나도 찾지 못함: ' + s.slice(0, 150));
  }
  const value = [];
  const kinds = new Set();
  const droppedDetail = [];
  let dropped = 0;
  for (const c of chunks) {
    const r = ladderParse(c, false);
    if (r) { value.push(r.value); if (r.repaired !== 'none') kinds.add(r.repaired); }
    else {
      dropped++;
      /* 2026-09-04 — 버린 줄의 **이유**를 함께 낸다.
         전날 'de:4/5(none/버림1)' 을 보고 로그를 뒤졌는데 아무것도 없었다.
         세기만 하고 이유를 안 남기면 '뭔가 잃었다' 까지만 알고 끝난다.
         머리와 꼬리를 둘 다 남긴다 — 앞에 붙은 것과 잘린 끝은 서로 다른 병이다.
         3개까지만 남긴다(로그가 응답 전체가 되면 아무도 안 읽는다). */
      if (droppedDetail.length < 3) {
        let why = '';
        try { JSON.parse(c); } catch (e) { why = String((e && e.message) || e).slice(0, 120); }
        droppedDetail.push({ why, head: c.slice(0, 120), tail: c.slice(-120), len: c.length });
      }
    }
  }
  if (!value.length) {
    throw new Error(what + ' 객체 ' + chunks.length + '개를 찾았으나 전부 파싱 실패: '
      + s.slice(0, 150));
  }
  return {
    value,
    repaired: kinds.size ? Array.from(kinds).join('+') : 'none',
    dropped, droppedDetail,
  };
}

function parseJsonLines(text, label) {
  const s = String(text || '');
  const what = label || 'JSON';

  let first = null, firstErr = null;
  try { first = _linesOnce(s, what); } catch (e) { firstErr = e; }

  /* 활자 따옴표가 깨져 있으면 **덩어리 경계부터** 틀린다(머리말 참고).
     그래서 한 줄이 통째로 죽는 게 아니라 여러 줄이 함께 죽는다.

     ⚠️ 처음에는 `dropped > 0` 일 때만 다시 시도하게 짰다가 돌연변이 시험에서
        걸렸다. 깨진 줄은 **버려지는 게 아니라 아예 안 보인다** — 문자열 추적이
        어긋나면 findBalancedChunks 가 그 줄을 덩어리로 세지도 않는다.
        그래서 2줄 중 1줄만 살아도 dropped 는 0 이었다. 세는 값으로 판단하면
        '잃은 걸 못 셌다' 를 '잃은 게 없다' 로 읽는다(2026-09-02 '잔여 0' 과 같은 실수).
        그래서 **고칠 거리가 있으면 항상 한 번 더 해 보고, 더 많이 살렸을 때만
        채택한다.** 판단 기준을 셈이 아니라 결과로 바꾼다. */
  for (const [고침, 이름] of [[closeTypographicQuotes, 'typo-quotes'], [fixBracketKinds, 'bracket-kind']]) {
    const fixed = 고침(s);
    if (fixed === s) continue;
    let second = null;
    try { second = _linesOnce(fixed, what); } catch (_) { continue; }
    /* 더 많이 살렸을 때만 채택한다. 고친 쪽이 더 나쁘면 쓰지 않는다. */
    if (second && (!first || second.value.length > first.value.length)) {
      return {
        value: second.value,
        repaired: (second.repaired === 'none' ? '' : second.repaired + '+') + 이름,
        dropped: second.dropped, droppedDetail: second.droppedDetail,
      };
    }
  }

  if (first) return first;
  throw firstErr;
}

module.exports = { parseJsonLines, closeTypographicQuotes, fixBracketKinds, escapeRawControls, escapeInnerQuotes, tryRepairedParse, findBalancedChunks, pickBalancedChunk, parseJsonObject, parseJsonArray };
