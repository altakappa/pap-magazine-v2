/**
 * 소셜 호칭·종결 규칙 테스트 — 스레드 + X
 * ═══════════════════════════════════════════════════════════════════
 * 2026-08-03 지시 (유지):
 *   1. 무조건 질문형으로 끝나지 않게. 꼭 필요할 때만 질문형.
 *   2. '어떻게 봐?'는 어색하니 '어떻게 생각해?'로.
 *
 * 2026-08-13 지시 (변경):
 *   3. **호칭은 채널마다 다르다 (2026-08-17 최종).**
 *      스레드 → "스치니들" (스친 = 스레드 친구의 애칭. 스레드 안에서 쓰는 말)
 *      X      → "다들"
 *      X 는 인용·재게시로 우리를 모르는 사람에게 먼저 닿는 자리라 내부 은어가
 *      벽이 된다. 어미를 갈랐던 것과 같은 이유다.
 *      조사 결합이 다르다: "스치니들"은 명사(조사 붙음), "다들"은 부사(조사 없음).
 *      호칭 이력: 패퍼들(08-03) → 없음(08-13) → 다들(08-13) → 채널별(08-17).
 *   4. **설명조 반말 금지.** "~야/~거든/~지/~잖아" 로 닫는 문장이
 *      "AI 가 쓴 티" 의 실체였다. 친구 말투가 아니라 가르치는 말투다.
 *
 * ── 왜 프롬프트만으로 안 되나 ──────────────────────────────────────
 * 2·3 은 "무조건"이 붙은 규칙이다. 프롬프트는 확률이라 새기 때문에
 * 줄표(stripDashes) 때와 같은 구조를 쓴다 — 프롬프트로 지시하고,
 * 게시 직전에 기계적으로 한 번 더 확정한다.
 * 1·4 는 문장의 뜻·리듬을 봐야 해서 기계 치환이 불가능하다. 프롬프트가
 * 실제 수정이고, 여기서는 그 지시가 남아 있는지만 지킨다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 치환이 실제로 동작할 것 (문자열 검사 아닌 실행 검증)
 *  2. 낱말 안의 '너'(너무/너머/건너는)를 망가뜨리지 않을 것
 *  3. URL 이 손상되지 않을 것
 *  4. 길이 판정보다 먼저 걸릴 것
 *  5. 프롬프트가 질문형을 강제하지 않을 것
 *  6. 옛 호칭(패퍼들·페퍼들)이 되살아나지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const papVoice = require(path.join(ROOT, 'api/_lib/papVoice.js'));
const N = papVoice.normalizeSocialAddress;

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? '\n      → ' + detail : ''); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const voice   = read('api/_lib/papVoice.js');
const hook    = read('api/_lib/socialHook.js');
const threads = read('api/_lib/threadsAutopost.js');

console.log('\n=== 1. 스레드 — "스치니들" (명사, 조사 결합) ===');
t('너는 → 스치니들은', N('너는 어떤 쪽이야?') === '스치니들은 어떤 쪽이야?', N('너는 어떤 쪽이야?'));
t('너도 → 스치니들도', N('너도 봤어?') === '스치니들도 봤어?', N('너도 봤어?'));
t('너가 → 스치니들이 (주격 조사)', N('너가 골라봐') === '스치니들이 골라봐', N('너가 골라봐'));
t('너의 / 너를 / 너만', N('너의 취향') === '스치니들의 취향'
  && N('너를') === '스치니들을' && N('너만') === '스치니들만');
t('너랑 → 스치니들이랑 (받침 뒤 조사)', N('너랑 같이') === '스치니들이랑 같이');
t('너희들 → 스치니들 (겹치지 않는다)', N('너희들 생각은?') === '스치니들 생각은?', N('너희들 생각은?'));
t('문장 중간에서도 잡힌다',
  N('그래서, 너는 어때') === '그래서, 스치니들은 어때', N('그래서, 너는 어때'));

console.log('\n=== 2. X — "다들" (부사, 조사 없이) ===');
const P = (x) => N(x, { polite: true });
t('너는 → 다들 (다들은 아님)', P('너는 어떻게 보세요?') === '다들 어떻게 생각하세요?',
  P('너는 어떻게 보세요?'));
t('너도 → 다들', P('너도 보셨어요?') === '다들 보셨어요?', P('너도 보셨어요?'));
t('스레드 호칭이 X 로 새면 되돌린다',
  P('스치니들은 어떻게 생각해?') === '다들 어떻게 생각해?', P('스치니들은 어떻게 생각해?'));
t('격조사 자리는 다들+조사', P('너의 취향') === '다들의 취향' && P('너랑') === '다들이랑');

console.log('\n=== 3. 옛 호칭·일반 부사 처리 ===');
/* 프롬프트에서 뺐어도 학습된 습관은 한동안 샌다. 기계 관문이 마지막 방어다. */
t('패퍼들 → 스치니들 (스레드)', N('패퍼들 생각은?') === '스치니들 생각은?', N('패퍼들 생각은?'));
t('페퍼들도 같이 잡는다 (스레드)', N('페퍼들 생각은?') === '스치니들 생각은?');
t('패퍼들 → 다들 (X)', P('패퍼들 생각은?') === '다들 생각은?', P('패퍼들 생각은?'));
/* "다들" 은 일반 부사이기도 하다. 이걸 치환하면 멀쩡한 문장을 망친다. */
t('일반 부사 "다들" 은 스레드에서도 건드리지 않는다',
  N('다들 모였다') === '다들 모였다', N('다들 모였다'));
t('프롬프트에 옛 호칭 지시가 남아 있지 않다',
  !/독자를 부를 때는 "패퍼들"/.test(voice) && !/"패퍼들은 어떻게/.test(voice),
  '지시가 남아 있으면 기계 치환과 프롬프트가 서로 싸운다');

console.log('\n=== 4. 낱말 안의 너는 건드리지 않는가 ===');
/* 앞 글자가 한글이면 조사가 아니라 어간의 일부다. 여기서 새면
   "건너는 길"이 "건 길"이 된다. */
for (const w of ['너무 예쁘다', '지평선 너머', '길을 건너는 사람', '강을 건너가면', '너그러운']) {
  t('그대로 둔다: ' + w, N(w) === w, N(w));
}

console.log('\n=== 5. 어떻게 봐 → 어떻게 생각해 ===');
t('어떻게 봐? → 어떻게 생각해?', N('스치니들 어떻게 봐?') === '스치니들 어떻게 생각해?');
t('존댓말 변형도 같이 잡는다 (반말 규칙 이중 방어)',
  N('어떻게 보세요?') === '어떻게 생각해?' && N('어떻게 봐요?') === '어떻게 생각해?');
t('과거형은 과거형으로', N('어떻게 봤어?') === '어떻게 생각했어?');
t('두 규칙이 한 문장에서 같이 걸린다',
  N('너는 이거 어떻게 봐?') === '스치니들은 이거 어떻게 생각해?',
  N('너는 이거 어떻게 봐?'));

console.log('\n=== 6. URL 을 깨뜨리지 않는가 ===');
const withUrl = '스치니들 생각은?\n\nhttps://www.pap-magazine.com/article/너무-좋은-슬러그';
t('URL 안의 글자는 손대지 않는다', N(withUrl) === withUrl, N(withUrl));
const withUrl2 = '스치니들 어떤 쪽이야?\n\nhttps://www.pap-magazine.com/article/너는-누구인가';
t('URL 안의 "너는"은 치환되지 않는다', N(withUrl2) === withUrl2, N(withUrl2));

console.log('\n=== 7. 생성 경로에 실제로 걸려 있는가 ===');
t('papVoice 가 normalizeSocialAddress 를 export 한다',
  typeof papVoice.normalizeSocialAddress === 'function');
t('스레드가 normalize() 로 네 경로를 모두 통과시킨다',
  (threads.match(/normalize\(/g) || []).length >= 5,
  '대화형 / 일반 AI / 폴백 2곳 + 정의부');
t('socialHook 이 길이 판정 전에 정규화한다',
  /const text = papVoice\.normalizeSocialAddress\(raw2[^;]*\);[\s\S]{0,120}text\.length > limit/.test(hook),
  '치환으로 글자 수가 달라지므로 나중에 걸면 X 의 280자 판정이 어긋난다');
t('X 는 socialHook 을 거치므로 자동 적용된다',
  /generateConversationalPost/.test(read('api/_lib/xPost.js')));

console.log('\n=== 8. 프롬프트 지시 ===');
const promptOnly = (src) => (src.match(/^\s*'.*',?$/gm) || []).join('\n');
const hookPrompt    = promptOnly(hook);
const threadsPrompt = promptOnly(threads);
const voicePrompt   = promptOnly(voice);

t('"마지막은 열린 질문" 강제 문구가 사라졌다',
  !/마지막은 열린 질문/.test(hookPrompt),
  '이 한 줄이 모든 글을 물음표로 끝나게 만들던 원인이다');
t('질문이 기본값이 아니라고 명시한다',
  /질문으로 끝내는 것은 기본값이 아니다/.test(voicePrompt)
  && /질문으로 끝내는 것은 기본값이 아니다/.test(threadsPrompt)
  && /꼭 질문으로 끝내지 않는다/.test(hookPrompt));
t('질문 아닌 종결의 대안을 준다 (여운·관찰)',
  /여운|관찰/.test(voicePrompt) && /여운|관찰/.test(hookPrompt));
t('스레드 프롬프트가 "스치니들" 호칭을 지시한다',
  /독자를 부를 때는 "스치니들"이라고 한다/.test(voicePrompt),
  '기계 치환은 보험이고, 자연스러운 문장은 프롬프트가 만든다');
t('X 프롬프트는 "다들" 을 유지한다 (내부 은어가 밖에서 벽이 된다)',
  /독자를 부를 때는 "다들"이라고 한다/.test(voicePrompt));
t('스치니가 무슨 말인지 프롬프트가 설명한다 (모델이 오용하지 않게)',
  /스친\(스레드 친구\)의 애칭/.test(voicePrompt));
t('설명조 반말 금지를 지시한다 (AI 티의 실체)',
  /설명조 반말을 쓰지 않는다/.test(voicePrompt));
t('끊긴 문장·줄바꿈·쉼표 절약을 지시한다',
  /끊긴 문장이 자연스럽다/.test(voicePrompt)
  && /줄바꿈으로 나눈다/.test(voicePrompt)
  && /쉼표를 아낀다/.test(voicePrompt));
t('프롬프트에 "어떻게 봐" 예시가 남아있지 않다',
  !/어떻게 봐|어떻게 봤|어떻게 보세요/.test(voicePrompt + hookPrompt + threadsPrompt),
  '예시는 지시보다 강하게 작동한다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ social-address tests FAILED'); process.exit(1); }
console.log('✅ social-address tests passed');
