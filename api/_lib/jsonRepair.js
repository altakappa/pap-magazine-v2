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
function parseJsonObject(text, label) {
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
function parseJsonArray(text, label) {
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

  let detail = '';
  try { JSON.parse(chunk); } catch (e) {
    const m = /position (\d+)/.exec(String(e && e.message));
    const pos = m ? Number(m[1]) : -1;
    detail = String(e && e.message);
    if (pos >= 0) detail += ' :: \u2026' + chunk.slice(Math.max(0, pos - 60), pos + 60) + '\u2026';
  }
  throw new Error(what + ' 배열 파싱 실패 (제어문자·따옴표 복구도 실패): ' + detail);
}

module.exports = { escapeRawControls, escapeInnerQuotes, tryRepairedParse, findBalancedChunks, pickBalancedChunk, parseJsonObject, parseJsonArray };
