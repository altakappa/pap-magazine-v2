/**
 * Claude 응답 JSON 파싱 회귀 (2026-08-03 신설).
 *
 * 왜 필요했나 — 실제 사고:
 *   서브미션을 승인해 에디토리얼을 만들 때 이탈리아어(description_it)가 비고,
 *   인스타그램 캡션이 훅·한국어 단락 없이 타이틀 줄부터 시작하는 일이 있었다.
 *   최근 45일 27건 중 2건('Bounty Law' 08-03, 'Being And Becoming' 07-30).
 *
 *   두 증상은 원인이 하나였다. Claude 응답의 JSON.parse 가 실패하면 _parseJson
 *   이 null 을 반환하고, 그러면 kr/en/it 이 전부 비어 fallback 이 원문(영어)을
 *   그대로 슬롯에 넣었다. 로그도 알림도 재시도도 없어 '성공'으로 기록됐다.
 *   입력 특성(길이·따옴표·개행)은 성공/실패를 가르지 못했다 — 모델 출력 변동이다.
 *
 * 여기서 지키는 것:
 *   ① 서두 산문·코드펜스·후행 텍스트가 붙어도 JSON 을 건져낸다
 *   ② 문자열 안 raw 개행이 있어도 죽지 않는다
 *   ③ 잘린 응답에서도 앞쪽 필드는 회수한다 (전량 손실 금지)
 *   ④ 진짜 실패는 조용히 넘어가지 않는다 — 로그·알림·재시도가 코드에 있다
 *   ⑤ 영어 원문이 한국어 칸(description·캡션 KR 단락)에 앉지 않는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service';

const { _parseAiJson, _guessLanguage } = require('../api/_lib/editorialAi');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

console.log('\n=== [1] 정상 응답 ===');
(function () {
  const ok = _parseAiJson('{"kr":"가","en":"a","it":"i","hook":"훅","moodTag":"태그"}');
  t('5개 슬롯을 모두 읽는다', ok && ok.kr === '가' && ok.en === 'a' && ok.it === 'i'
    && ok.hook === '훅' && ok.moodTag === '태그');
})();

console.log('=== [2] 모델이 JSON 만 주지 않았을 때 ===');
(function () {
  t('서두 산문이 붙어도 건진다',
    (_parseAiJson('Here is the JSON:\n{"kr":"가","en":"a"}') || {}).kr === '가',
    '가장 흔한 실패 모양. prefill 로 1차 차단하지만 파서도 견뎌야 한다');
  t('코드펜스를 벗겨낸다',
    (_parseAiJson('```json\n{"kr":"가"}\n```') || {}).kr === '가');
  t('산문 + 코드펜스 + 후행 텍스트 조합도 건진다',
    (_parseAiJson('Sure!\n```json\n{"kr":"가"}\n```\nHope this helps') || {}).kr === '가');
  t('뒤에 잡담이 붙어도 건진다',
    (_parseAiJson('{"kr":"가"} done.') || {}).kr === '가');
})();

console.log('=== [3] 깨진 JSON 복구 ===');
(function () {
  const nl = _parseAiJson('{"kr":"첫줄\n둘째줄","en":"a"}');
  t('문자열 안 raw 개행을 복구한다', nl && nl.kr === '첫줄\n둘째줄',
    'JSON.parse 는 여기서 Bad control character 로 죽는다');
  const cut = _parseAiJson('{"kr":"가나다","en":"abc","it":"ital');
  t('잘린 응답에서 완성된 필드는 회수한다', cut && cut.kr === '가나다' && cut.en === 'abc',
    '전량 손실보다 부분 회수가 낫다 — 남은 칸은 어드민에서 재생성하면 된다');
})();

console.log('=== [4] 진짜 실패는 실패로 ===');
(function () {
  t('JSON 이 아예 없으면 null', _parseAiJson('no json at all') === null,
    'null 을 반환해야 호출부가 재시도·알림으로 넘어간다');
  t('빈 입력도 null', _parseAiJson('') === null && _parseAiJson(null) === null);
})();

console.log('=== [5] 조용한 실패 금지 (editorialAi.js) ===');
(function () {
  const src = R('api/_lib/editorialAi.js');
  t('assistant prefill 로 서두 산문을 원천 차단',
    /role: 'assistant', content: '\{'/.test(src),
    '가장 흔한 실패 모양을 입구에서 막는다');
  t('파싱 실패를 로그로 남긴다',
    /console\.error\('\[editorialAi\] JSON 파싱 실패'/.test(src),
    '관측되지 않는 실패는 존재하지 않는 것처럼 보인다');
  t('stop_reason 을 함께 남긴다 (잘림/변동 구분용)', /stop_reason=/.test(src));
  t('1회 재시도한다', /attempt <= 2/.test(src),
    '원인이 출력 변동이므로 재시도만으로 실패율이 제곱으로 떨어진다');
  t('최종 실패는 텔레그램으로 알린다', /reportAiParseFailure\(label, lastHead\)/.test(src));
  t('실패 결과에 degraded 표식을 붙인다', /degraded: true/.test(src),
    "'성공처럼 보이는 빈 결과' 를 돌려주면 안 된다");
  t('max_tokens 여유 확보 (statement 4000)', /maxTokens: 4000/.test(src));
})();

console.log('=== [6] 알림 경로 (aiCreditWatch.js) ===');
(function () {
  const src = R('api/_lib/aiCreditWatch.js');
  const mod = require('../api/_lib/aiCreditWatch');
  t('reportAiParseFailure 를 내보낸다', typeof mod.reportAiParseFailure === 'function');
  t('HTTP 200 인데 파싱 실패인 경우를 별도 키로 다룬다',
    /anthropic-json-parse/.test(src),
    'classifyAiFailure 는 상태코드 기반이라 이 경우를 못 잡는다');
  t('쿨다운을 지킨다', /PARSE_ALERT_KEY[\s\S]{0,600}COOLDOWN_H \* 3600000/.test(src));
  t('알림에 조치가 적혀 있다', /AI 자동 생성을 다시 누르면/.test(src),
    '알림만 받고 뭘 해야 할지 모르면 무용지물이다');
  t('감시 실패가 호출부를 죽이지 않는다',
    /파싱실패 알림 실패/.test(src));
})();

console.log('=== [7] 언어 가드 — 영어가 한국어 칸에 앉지 않는다 ===');
(function () {
  const rv = R('api/submissions/[id]/review.js');
  t('description 원문 fallback 에 한국어 판정을 건다',
    /_guessLang\(description \|\| ''\) === 'kr'/.test(rv),
    "'Bounty Law'·'Being And Becoming' 이 정확히 이 자리에서 영어를 한국어 칸에 넣었다");
  t('캡션 KR 단락 fallback 에도 같은 가드',
    /_guessLang\(_rawKo\) === 'kr'/.test(rv));
  t('_guessLanguage 는 영문 원문을 kr 로 보지 않는다',
    _guessLanguage('Moving a body through space is never neutral.') === 'en');
  t('한국어 원문은 kr 로 판정', _guessLanguage('무대 위 가면과 얼굴 사이.') === 'kr');
  t('AI 를 못 쓸 때도 원문을 추정 슬롯에만 넣는다',
    /kr: slot === 'kr' \? rawText : ''/.test(R('api/_lib/editorialAi.js')));
})();

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
