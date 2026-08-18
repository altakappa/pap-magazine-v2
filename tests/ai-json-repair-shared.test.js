/*
 * ai-json-repair-shared.test.js  (2026-08-18)
 *
 * 막는 구멍: **같은 고장을 각자 따로 겪는 것.**
 *
 * AI 응답 JSON 파싱은 이 저장소에서 세 번 터졌다.
 *   2026-08-08  번역 백필      실패율 87%  → 복구 계단을 만들었다
 *   2026-08-16  주간 뉴스레터  통째로 사망 → 계단을 공용 lib 로 옮겼다
 *   2026-08-16~17 competitor-watch · sync-pepperit · sync-instagram
 *                  → 이들은 아직 JSON.parse 한 번(또는 두 번)이 전부였다
 *
 * 교훈 2번: **규칙이 두 벌이면 한쪽만 고쳐진다.** 그러니 새로 만들지 말고
 * 있는 계단을 쓰게 한다. 이 테스트는 (1) 배열용 계단이 실제로 복구하는지,
 * (2) 세 호출부가 자체 파싱으로 되돌아가지 않았는지를 본다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { parseJsonArray, parseJsonObject } = require('../api/_lib/jsonRepair');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
function eq(a, b, m) { ok(a === b, m + `  (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`); }

console.log('\n=== 1. 배열 계단 — 세 칸이 순서대로 동작한다 ===');
{
  const a = parseJsonArray('여기 있습니다: [{"t":"제목"}] 끝', 'x');
  eq(a.repaired, 'none', '멀쩡하면 그냥 파싱한다 (앞뒤 산문·펜스는 무시)');
  eq(a.value.length, 1, '값을 제대로 읽는다');
}
{
  // 실측 실패 모양: 한국어 본문 안에 생 개행
  const b = parseJsonArray('[{"title":"경쟁사 동향","body":"첫 줄\n둘째 줄"}]', 'x');
  eq(b.repaired, 'controls', '생 개행은 제어문자 칸에서 산다');
  ok(/둘째 줄/.test(b.value[0].body), '본문이 살아 있다');
}
{
  const c = parseJsonArray('[{"t":"그가 "좋다" 고 했다"}]', 'x');
  ok(c.repaired === 'quotes' || c.repaired === 'controls', '안 닫힌 따옴표도 최후 수단으로 건진다: ' + c.repaired);
}

console.log('\n=== 2. 구조가 깨진 응답은 고치지 않는다 (창작 금지) ===');
{
  let threw = false;
  // 대괄호는 닫혔는데 안이 깨진 응답 — 복구 세 칸이 다 실패하는 자리
  try { parseJsonArray('[{"a":1},{"b":]', 'competitor-watch'); } catch (e) {
    threw = true;
    ok(/competitor-watch/.test(e.message), '어느 자리에서 났는지 오류에 적힌다');
    /* 파서 원문 메시지를 그대로 싣는다. (위치를 주는 오류면 주변 조각까지 붙지만,
       Node 는 'Unexpected token' 처럼 위치 없는 메시지도 낸다 — 그건 붙일 게 없다) */
    ok(/Unexpected|position|JSON/.test(e.message), '파서가 뭐라 했는지 그대로 싣는다: ' + e.message.slice(0, 110));
  }
  ok(threw, '못 고치면 던진다 — 빈 배열로 삼키지 않는다');
}
{
  let threw = false;
  try { parseJsonArray('배열이 없는 산문', 'x'); } catch (e) { threw = true; }
  ok(threw, '배열이 아예 없으면 던진다 (호출부가 판단한다)');
}
{
  // 객체를 배열이라고 우기지 않는다
  let threw = false;
  try { parseJsonArray('[', 'x'); } catch (e) { threw = true; }
  ok(threw, '여는 괄호만 있어도 던진다');
}

console.log('\n=== 3. 세 호출부가 공용 계단을 쓴다 (각자 파싱 금지) ===');
const SITES = [
  ['api/cron/competitor-watch.js', 'parseJsonArray', 'competitor-watch — 08-16 실패'],
  ['api/_lib/pepperitImport.js', 'parseJsonObject', 'sync-pepperit — 2건 실패'],
  ['api/_lib/instagramImport.js', 'parseJsonObject', 'sync-instagram — 1건 실패'],
];
for (const [file, fn, why] of SITES) {
  const src = R(file);
  ok(new RegExp("require\\('\\.{1,2}/(_lib/)?jsonRepair'\\)").test(src), file + ' — 공용 lib 를 부른다 (' + why + ')');
  ok(src.indexOf(fn + '(') !== -1, file + ' — ' + fn + ' 계단을 쓴다');
  ok(/repaired !== 'none'/.test(src), file + ' — 복구했으면 로그를 남긴다 (조용한 복구 금지)');
}

console.log('\n=== 4. 되돌아가기 감시 — 원시 JSON.parse 재발 ===');
{
  const src = R('api/_lib/pepperitImport.js') + R('api/_lib/instagramImport.js');
  ok(!/JSON\.parse\(raw\)/.test(src), 'raw 를 그냥 JSON.parse 하는 옛 경로가 남아 있지 않다');
  // 주석에는 사고 기록으로 남아 있어도 된다. 사라져야 하는 건 **던지는 코드**다.
  ok(!/throw new Error\('Claude 응답 JSON 파싱 실패/.test(src),
    "원인을 안 알려주던 옛 오류('Claude 응답 JSON 파싱 실패.')를 더는 던지지 않는다");
}
{
  const cw = R('api/cron/competitor-watch.js');
  ok(!/items = m \? JSON\.parse/.test(cw), 'competitor-watch 의 한 방 파싱이 사라졌다');
  ok(/indexOf\('\['\) === -1/.test(cw), "배열이 없는 '없음' 응답은 종전대로 빈 목록 (거짓 실패 금지)");
}

console.log('\n=== 5. 감시 사각지대 — competitor-watch 가 note 를 남긴다 ===');
{
  const cw = R('api/cron/competitor-watch.js');
  /* 'cronNote 라는 글자가 있다' 로는 부족하다 — 껍데기만 남기고 대입을 지우면
     그대로 통과한다. **실제로 대입하는지**를 본다. */
  ok(/function note\(msg\)[^\n]*res\.locals\.cronNote = msg/.test(cw),
    '384회를 빈칸으로 돌던 크론이 이제 note 를 실제로 대입한다');
  /* 200 반환문 **하나하나**가 note 를 달고 있는지 본다. 하나라도 빈손으로
     끝나면 그 경로는 대시보드에서 '성공·빈칸' 으로 보인다 — 틱톡 21일 침묵이
     정확히 그 모양이었다. (drive-youtube-post 가 같은 규칙을 이미 쓴다) */
  const returns = cw.match(/return res\.status\(200\)\.json\(\{[\s\S]*?\}\);/g) || [];
  ok(returns.length >= 2, '200 반환이 2개 이상 있다 (' + returns.length + '개)');
  const bare = returns.filter((r) => !/note/.test(r));
  ok(bare.length === 0, '200 반환 전부가 note 를 단다' + (bare.length ? ' — 빈손: ' + bare[0].slice(0, 70) : ''));
  ok(/실패: ' \+ String/.test(cw), '실패 경로에도 사유를 남긴다');
}

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ ai-json-repair-shared tests passed');
