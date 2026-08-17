/**
 * 주간 뉴스레터 JSON 복구 (2026-08-18 신설)
 *
 * 배경 — 실제 실패:
 *   2026-08-16 21:31  weekly-news  ok=false
 *   주간 뉴스레터 생성 실패: Expected ',' or '}' after property value
 *   in JSON at position 3502 (line 65 column 91)
 *
 * 옛 코드는 JSON.parse 한 번이 전부였다. 뉴스레터 본문은 한국어 3-4문장이
 * 10건이라 문자열이 길고, 그 안에 생 개행이나 따옴표가 섞이면 응답 전체가
 * 버려졌다. 주간 크론이라 다음 기회는 일주일 뒤다.
 *
 * 번역 백필이 2026-08-08 에 같은 문제(실패율 87%)를 겪고 만든 복구 계단이
 * 이미 있었다. **복사하지 않고** 공용 lib 으로 옮겨 규칙을 한 벌로 뒀다.
 *
 * 이 하네스가 지키는 것:
 *   ① 계단이 순서대로 동작한다 (그대로 → 제어문자 → 따옴표)
 *   ② 고칠 수 없는 것은 던진다 (조용히 성공한 척 금지)
 *   ③ 복구했으면 보이게 남긴다 (note · console)
 *   ④ 규칙이 한 벌이다 (번역 쪽이 같은 lib 을 쓴다)
 *   ⑤ 번역 쪽 export 표면이 안 깨졌다 (기존 호출부 보호)
 *   ⑥ 실제 실패 모양이 살아난다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* seoTranslateBackfill 은 최상단에서 supabase 클라이언트를 만든다.
   env 없이 require 하면 거기서 죽으므로, 기존 translate-json-repair 테스트와
   같은 방식으로 스텁을 꽂는다. */
const Module = require('module');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const _stub = new Module(SUPABASE);
_stub.exports = { supabaseAdmin: {} };
_stub.loaded = true;
require.cache[SUPABASE] = _stub;

const LIB = path.join(ROOT, 'api', '_lib', 'jsonRepair.js');
const R = require(LIB);
const WN = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'weekly-news.js'), 'utf8');
const BF = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 200)); }
}

/* 던져도 하네스가 죽지 않게 감싼다. 변이 시험에서 복구 단계를 지우면
   여기서 예외가 나는데, 그때 Node 가 통째로 죽으면 나머지 검사 결과를
   못 본다 — 무엇이 깨졌는지 알 수 있어야 고칠 수 있다. */
const P = (txt) => { try { return R.parseJsonObject(txt, 'T'); } catch (e) { return { repaired: 'THREW', value: {}, err: e.message }; } };

console.log('\n=== ① 복구 계단 ===');
{
  const ok = P('{"a":1,"b":"ok"}');
  t('정상 JSON 은 손대지 않는다', ok.repaired === 'none' && ok.value.a === 1, ok);

  const nl = P('{"a":"첫 줄\n둘째 줄","b":2}');
  t('문자열 안 생 개행을 살린다', nl.repaired === 'controls' && nl.value.a === '첫 줄\n둘째 줄', nl);

  const tab = P('{"a":"가\t나"}');
  t('생 탭도 살린다', tab.repaired === 'controls' && tab.value.a === '가\t나', tab);

  const q = P('{"t":"그는 "안녕" 이라 했다","u":1}');
  t('이스케이프 안 된 따옴표는 최후의 수단으로 살린다',
    q.repaired === 'quotes' && /안녕/.test(q.value.t), q);

  const noise = P('json 입니다\n{"a":1}\n끝');
  t('앞뒤 잡소리를 걷어낸다', noise.repaired === 'none' && noise.value.a === 1, noise);

  // 순서가 중요하다 — 정상 JSON 에 deep 복구를 먼저 걸면 멀쩡한 값을 망친다
  t('제어문자 복구가 따옴표 복구보다 먼저다',
    LIB && fs.readFileSync(LIB, 'utf8').indexOf("tryRepairedParse(chunk, false)")
        < fs.readFileSync(LIB, 'utf8').indexOf("tryRepairedParse(chunk, true)"));
}

console.log('\n=== ② 못 고치면 던진다 ===');
{
  const threw = (fn) => { try { fn(); return false; } catch (e) { return e.message; } };
  t('잘린 JSON 은 던진다', !!threw(() => R.parseJsonObject('{"a":1', 'T')));
  t('객체가 없으면 던진다', !!threw(() => R.parseJsonObject('객체 없음', 'T')));
  t('빈 입력도 던진다', !!threw(() => R.parseJsonObject('', 'T')));
  t('null 도 던진다', !!threw(() => R.parseJsonObject(null, 'T')));

  // 창작하지 않는다 — 구조가 잘린 응답을 복구했다고 말하면 안 된다
  t('잘린 응답을 살려내지 않는다', !!threw(() => R.parseJsonObject('{"a":"열린 문자열', 'T')));

  const msg = threw(() => R.parseJsonObject('{"a":1,,}', 'T'));
  t('오류에 라벨이 실린다', /T/.test(String(msg)), msg);
}

console.log('\n=== ③ 복구를 숨기지 않는다 ===');
{
  t('weekly-news 가 복구 종류를 기억한다', /lastRepair = parsed\.repaired/.test(WN));
  t('note 에 실린다', /JSON 복구함\('/.test(WN) || /⚠️ JSON 복구함/.test(WN));
  t('콘솔에도 남긴다', /\[weekly-news\] JSON 복구함/.test(WN));
  t("복구 안 했으면 note 에 안 붙는다", /lastRepair !== 'none' \?/.test(WN));
  // TDZ — 이 저장소가 한 번 데인 자리다
  t('선언이 사용보다 위에 있다',
    WN.indexOf("let lastRepair = 'none';") < WN.indexOf('lastRepair = parsed.repaired'));
}

console.log('\n=== ④ 규칙이 한 벌이다 ===');
{
  t('weekly-news 가 공용 lib 을 쓴다', /require\('\.\.\/_lib\/jsonRepair'\)/.test(WN));
  t('번역 백필도 같은 lib 을 쓴다', /require\('\.\/jsonRepair'\)/.test(BF));
  t('번역 백필에 정의가 남아 있지 않다 (복사본 금지)',
    !/^function escapeRawControls/m.test(BF) && !/^function escapeInnerQuotes/m.test(BF),
    '정의가 두 곳에 있다');
  t('weekly-news 에 자체 JSON.parse 잔재가 없다',
    !/return JSON\.parse\(m\[0\]\)/.test(WN));
}

console.log('\n=== ⑤ 번역 쪽 계약이 안 깨졌다 ===');
{
  const bf = require(path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js'));
  for (const name of ['escapeRawControls', 'escapeInnerQuotes', 'parseJsonArray', 'salvageObjects']) {
    t(name + ' 이 여전히 export 된다', typeof bf[name] === 'function');
  }
  t('escapeRawControls 동작이 그대로',
    bf.escapeRawControls('{"a":"1\n2"}') === '{"a":"1\\n2"}', bf.escapeRawControls('{"a":"1\n2"}'));
  t('parseJsonArray 가 여전히 배열을 낸다',
    Array.isArray(bf.parseJsonArray('[{"title":"t"}]')));
}

console.log('\n=== ⑥ 실제 실패 모양 재현 ===');
{
  /* 2026-08-16 실패는 뉴스레터 summary(한국어 3-4문장) 안에서 났다.
     그 모양을 그대로 만든다 — 긴 한국어 + 생 개행 + 따옴표. */
  const real = '{"subject":"PAP 이주의 뉴스 — August 16",'
    + '"newsItems":[{"title":"전시가 열렸다","summary":"서울에서 전시가 열렸다.\n'
    + '작가는 "경계" 를 주제로 삼았다.\n관람객이 몰렸다.","category":"ART","url":"https://x.test"}]}';
  const got = P(real);
  t('생 개행 + 따옴표가 섞여도 살아난다', got.value && Array.isArray(got.value.newsItems), got.repaired);
  const first = (got.value && Array.isArray(got.value.newsItems)) ? got.value.newsItems[0] : null;
  t('내용이 보존된다', !!first && /경계/.test(first.summary), first && first.summary);
  t('subject 도 온전하다', got.value && got.value.subject === 'PAP 이주의 뉴스 — August 16',
    got.value && got.value.subject);
  t('복구했다고 표시된다', got.repaired !== 'none', got.repaired);
}

console.log('\n' + (fail ? '✗' : '✓') + ' weekly-news-json-repair: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
