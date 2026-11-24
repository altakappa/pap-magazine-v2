'use strict';
/* postTally — sync-instagram note 의 "X n/m건 · 스레드 n/m건" 을 정직하게 센다.

   2026-11-24 화요일 견고화. 실측(11/17~11/24 7일):
     sync-instagram note 가 주장한 X 성공 합계 30건(magazine 27 · fashion 2 · beauty 1)
     x_posts 의 실제 성공(ok=true)              0건 (전 계정 71행 전부 실패 — 402 크레딧 소진)
   원인: note 는 `'실패'` 로 시작하지 않는 항목을 전부 성공으로 셌다. 그런데 results.tweets 에는
   '건너뜀(셀럽아님:…)' · '건너뜀(같은주제:…)' · '마감초과(…)' 도 들어가고, results.threads 에는
   '스킵:…' · '이월:스위퍼(…)' · '마감초과(…)' 가 들어간다. 게시하지 않은 것을 게시했다고 적었다.
   교훈 1(돌았다≠했다)의 기록판 — 이번엔 "안 했다" 가 "했다" 로 찍혔다.

   분류 (보수적: 확인 안 된 것은 성공으로 세지 않는다)
     ok    — 게시 id 가 담긴 항목(그 외 전부)
     fail  — '실패…'
     carry — '마감초과…' · '이월…'  : 결과 미확인. 분모에 넣고 성공으로 세지 않는다(사유는 [..] 에 보인다)
     skip  — '건너뜀…' · '스킵…'    : 시도 자체를 안 했다. 분모에서 빼고 따로 적는다 */

function postOutcome(v) {
  const s = String(v == null ? '' : v);
  if (s.startsWith('실패')) return 'fail';
  if (s.startsWith('건너뜀') || s.startsWith('스킵')) return 'skip';
  if (s.startsWith('마감초과') || s.startsWith('이월')) return 'carry';
  return 'ok';
}

/* counted = 시도한 것(ok·fail·carry, 원래 순서) · notOk = fail·carry · skipped = skip */
function splitPosts(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const counted = [], notOk = [], skipped = [];
  for (const v of list) {
    const k = postOutcome(v);
    if (k === 'skip') { skipped.push(String(v)); continue; }
    counted.push(String(v));
    if (k !== 'ok') notOk.push(String(v));
  }
  return { counted, notOk, skipped };
}

function skipNote(label, skipped) {
  if (!Array.isArray(skipped) || !skipped.length) return '';
  return ' · ' + label + ' 건너뜀 ' + skipped.length + ' [' + skipped.join('; ').slice(0, 80) + ']';
}

module.exports = { postOutcome, splitPosts, skipNote };
