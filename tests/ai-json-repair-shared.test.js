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

console.log('\n=== 6. 덩어리 고르기 — 답이 여러 개거나 뒤에 산문이 붙을 때 (2026-08-25) ===');
/* 왜 추가했나 — 08-18 에 계단을 공용화하고도 competitor-watch 가 08-19(2회)·
   08-20(1회) 또 죽었다. 남은 사유는 전부 같은 문장이었다:
   'Unexpected non-whitespace character after JSON at position N'.
   계단 세 칸은 **문법 흠**을 고치는 장치인데, 이건 문법이 아니라
   **자르는 범위**가 틀린 것이다 (indexOf('[') ~ lastIndexOf(']')).
   교훈 4번: 규칙을 만들면 그 규칙의 가장자리를 테스트하라. */
{
  // 실측 모양 ① — 배열 뒤에 산문이 오고, 그 산문에 ] 가 섞여 있다
  const real = [
    '```json',
    '[',
    '  {"title":"공유 브라운 NEVO","score":1.4,"reason":"PAP이 이미 다룬 건과 유사"}',
    ']',
    '```',
    '',
    '**분석 결과: 해당 없음 (빈 배열 권장)**',
    '경쟁사 게시물 대부분이 [브라운 네보 x 공유] 캠페인이다.',
  ].join('\n');
  const r = parseJsonArray(real, 'competitor-watch');
  ok(/^block/.test(r.repaired), '뒤에 산문이 붙어도 배열을 건진다 (repaired=' + r.repaired + ')');
  eq(r.value.length, 1, '진짜 답 한 건을 읽는다');
  eq(r.value[0].title, '공유 브라운 NEVO', '내용이 온전하다');
}
{
  // 실측 모양 ② — 모델이 두 번 답한다. 뒤엣것이 최종 답변이다
  const two = '[{"title":"초안"}]\n\n**재검토 후 최종 답변:**\n```json\n[{"title":"구교환 부활남"}]\n```';
  const r = parseJsonArray(two, 'competitor-watch');
  eq(r.value.length, 1, '두 블록 중 하나만 고른다');
  eq(r.value[0].title, '구교환 부활남', "뒤엣것을 고른다 — '재검토 후 최종 답변' 이 진짜다");
}
{
  // 객체판도 같은 구멍이 있었다 (weekly-news)
  const r = parseJsonObject('{"subject":"초안"}\n최종: {"subject":"이번 주 PAP","body":"끝"}', 'weekly-news');
  eq(r.value.subject, '이번 주 PAP', '객체도 뒤엣것을 고른다');
}
{
  // 문자열 **안의** 괄호는 세지 않는다 — 세면 덩어리가 엉뚱하게 잘린다
  const r = parseJsonArray('[{"t":"제목 [단독] 이야기","u":"a]b"}] 그리고 산문 ]', 'x');
  eq(r.value[0].t, '제목 [단독] 이야기', '따옴표 안의 괄호는 무시한다');
}
{
  // 못 살리면 여전히 던진다 — 덩어리 고르기가 '창작' 으로 번지면 안 된다
  let threw = false;
  try { parseJsonArray('[{"a":1},{"b":]\n그리고 산문', 'cw'); } catch (e) { threw = true; }
  ok(threw, '고를 덩어리가 없으면 그대로 던진다 (빈 배열로 삼키지 않는다)');
}
{
  // 종전 성공 경로가 그대로여야 한다 — 넷째 칸은 **덧붙이기**지 교체가 아니다
  eq(parseJsonArray('여기: [{"t":"x"}] 끝', 'x').repaired, 'none', '멀쩡한 응답은 첫 칸 그대로');
  eq(parseJsonArray('[{"t":"첫\n둘"}]', 'x').repaired, 'controls', '생 개행은 둘째 칸 그대로');
}
{
  const { findBalancedChunks } = require('../api/_lib/jsonRepair');
  eq(findBalancedChunks('[1] 산문 [2]', '[', ']').length, 2, '덩어리를 전부 센다');
  eq(findBalancedChunks('[[1],[2]]', '[', ']').length, 1, '중첩은 바깥 하나로 센다');
  eq(findBalancedChunks('닫는 괄호만 ] 있다', '[', ']').length, 0, '짝 없는 괄호는 세지 않는다');
}

console.log('\n=== 7. 넷째 칸도 조용히 복구하지 않는다 ===');
{
  const r = parseJsonArray('[{"t":"a"}]\n최종: [{"t":"b"}]', 'x');
  ok(r.repaired !== 'none', "덩어리를 골랐으면 repaired 가 'none' 이 아니다 — 호출부가 로그를 남길 수 있다");
}


console.log('\n=== 8. 다섯째 칸 — 활자 따옴표 (2026-09-03 de 실측) ===');
{
  const { parseJsonLines, parseJsonObject } = require('../api/_lib/jsonRepair');

  /* 런타임 로그에서 그대로 옮긴 모양. „ 로 열고 ASCII " 로 닫는다. */
  const de1 = '{"i":0,"faq":[{"q":"Welche Kunstwerke haben LIENZO Y SURCO inspiriert?",'
    + '"a":"Ausgehend von Diego Riveras „Blumenträger" verbindet diese Editorial die leere Leinwand."},'
    + '{"q":"Was ist das Konzept?","a":"Avantgarde-Beauty mit „milchigen" Cremetexturen und „rohen" Oberflächen."}]}';
  const de2 = '{"i":1,"faq":[{"q":"Wer stand hinter der Produktion?","a":"Das Team um „Studio Nord" in Berlin."}]}';

  const r = parseJsonLines(de1 + '\n' + de2, 'faq-i18n/de');
  eq(r.value.length, 2, '두 줄 다 살린다 (종전에는 통째로 실패했다)');
  eq(r.dropped, 0, '버린 줄이 없다');
  ok(/typo-quotes/.test(r.repaired), "복구했으면 repaired 에 남긴다 — 조용히 고치지 않는다 (" + r.repaired + ")");
  ok(r.value[0].faq[1].a.indexOf('„milchigen“') !== -1,
    '독일어 닫는 따옴표를 제대로 넣는다 („…“)');
  ok(r.value[1].faq[0].a.indexOf('Studio Nord') !== -1, '내용이 잘리지 않는다');

  /* 프랑스어·러시아어 «…» 도 같은 위험. 짝이 하나뿐이면 셋째 칸(escapeInnerQuotes)이
     먼저 살린다 — 어느 칸이 살리든 **내용이 남는 것**이 계약이다. */
  const fr = parseJsonObject('{"a":"Le défilé «Printemps" était complet."}', 'x');
  ok(fr.value.a.indexOf('Printemps') !== -1 && fr.value.a.indexOf('complet') !== -1,
    '« 로 연 인용도 내용을 잃지 않는다', fr.value.a);

  /* 닫는 짝을 넣는 규칙 자체는 따로 잰다 (어느 칸이 먼저 잡든 무관하게). */
  const { closeTypographicQuotes } = require('../api/_lib/jsonRepair');
  ok(closeTypographicQuotes('«Printemps" ').indexOf('«Printemps»') !== -1, '« 는 » 로 닫는다');
  ok(closeTypographicQuotes('„Nord" ').indexOf('„Nord\u201C') !== -1, '„ 는 \u201C 로 닫는다');
  eq(closeTypographicQuotes('그냥 "보통" 따옴표'), '그냥 "보통" 따옴표',
    '활자 따옴표가 없으면 아무것도 안 바꾼다');

  /* 이스케이프된 따옴표가 든 **멀쩡한** JSON 은 건드리지 않는다 */
  const 정상 = '{"a":"Riveras „Blumenträger“ ist gut"}';
  eq(parseJsonObject(정상, 'x').repaired, 'none', '멀쩡하면 다섯째 칸이 아예 안 돈다');
  const 이스케이프 = '{"a":"er sagte \\"hallo\\" laut"}';
  eq(parseJsonObject(이스케이프, 'x').value.a, 'er sagte "hallo" laut',
    '이스케이프된 ASCII 따옴표는 그대로 둔다');

  /* 깨진 줄은 '버려지는' 게 아니라 **아예 안 보인다**. 문자열 추적이 어긋나면
     findBalancedChunks 가 그 줄을 덩어리로 세지도 않아 dropped 가 0 으로 남는다.
     그래서 '얼마나 버렸나' 로 재시도를 결정하면 안 된다. 아래가 그 회귀 고정이다.
     같은 줄에 이스케이프된 \" 가 있어도 그건 건드리면 안 된다. */
  {
    const 멀쩡 = '{"i":0,"faq":[{"q":"a","a":"Das Album „Nord\\" ist gut."}]}';
    const 깨짐 = '{"i":1,"faq":[{"q":"b","a":"Team um „Studio Nord" in Berlin."}]}';
    const r2 = parseJsonLines(멀쩡 + '\n' + 깨짐, 'faq-i18n/de');
    eq(r2.value.length, 2, "안 보이는 줄도 되찾는다 (dropped 는 0 이어도 잃은 게 있다)");
    eq(r2.value[0].faq[0].a, 'Das Album „Nord" ist gut.',
      '이스케이프된 \\" 가 든 멀쩡한 줄을 망가뜨리지 않는다');
    ok(r2.value[1] && r2.value[1].faq[0].a.indexOf('Studio Nord') !== -1, '깨진 줄의 내용도 살아난다');
  }

  /* 2026-09-04 — 버린 줄은 **이유까지** 낸다.
     전날 노트에 'de:4/5(none/버림1)' 이 찍혔는데 런타임 로그에 아무것도 없어서
     그 한 줄이 왜 깨졌는지 알 수가 없었다. 세는 것과 아는 것은 다르다. */
  {
    const 온전 = '{"i":0,"faq":[{"q":"a","a":"b"}]}';
    /* 괄호는 짝이 맞아서 '덩어리' 로는 잡히는데, 값이 비어 파싱은 안 되는 모양.
       괄호까지 어긋난 것은 애초에 덩어리로 안 잡혀 dropped 에 안 들어간다 —
       그건 다섯째 칸이 맡는다(위 절). 여기서 재는 건 '잡혔는데 못 읽은 줄' 이다. */
    const 못살림 = '{"i":1,"faq":[{"q":"c","a":}]}';
    const r3 = parseJsonLines(온전 + '\n' + 못살림, 'faq-i18n/de');
    ok(r3.dropped > 0, '못 살린 줄을 센다 (' + r3.dropped + ')');
    ok(Array.isArray(r3.droppedDetail) && r3.droppedDetail.length > 0,
      '버린 줄의 내역을 함께 낸다');
    const d0 = r3.droppedDetail[0];
    ok(d0 && typeof d0.why === 'string' && d0.why.length > 0, '왜 깨졌는지 적는다: ' + (d0 && d0.why));
    ok(d0 && d0.head && d0.tail, '머리와 꼬리를 둘 다 남긴다 (앞에 붙은 것과 잘린 끝은 다른 병이다)');
    ok(d0 && d0.head.length <= 120 && d0.tail.length <= 120, '길이를 자른다 (로그가 응답 전체가 되면 안 읽는다)');
    ok(r3.value.length === 1, '멀쩡한 줄은 그대로 살린다');
  }
  {
    /* 다 살렸으면 내역이 비어 있어야 한다 — 헛것을 남기지 않는다 */
    const ok2 = parseJsonLines('{"i":0,"faq":[]}\n{"i":1,"faq":[]}', 'x');
    eq(ok2.dropped, 0, '버린 게 없으면 0');
    eq((ok2.droppedDetail || []).length, 0, '버린 게 없으면 내역도 비어 있다');
  }

  /* 못 고치는 것은 여전히 던진다 — 고쳐 놓고 성공한 척하지 않는다 */
  let threw = false;
  try { parseJsonObject('{"a":„망가짐", "b":', 'x'); } catch (e) { threw = true; }
  ok(threw, '구조가 잘린 응답은 다섯째 칸으로도 살리지 않는다');
}

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ ai-json-repair-shared tests passed');
