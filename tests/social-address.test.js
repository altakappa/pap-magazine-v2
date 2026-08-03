/**
 * 소셜 호칭·종결 규칙 테스트 — 스레드 + X (2026-08-03 도메니코 지시)
 * ═══════════════════════════════════════════════════════════════════
 * 지시 세 가지:
 *   1. 무조건 질문형으로 끝나지 않게. 꼭 필요할 때만 질문형.
 *   2. 상대방을 칭할 때 '너'가 아니라 '패퍼들'.
 *   3. '어떻게 봐?'는 어색하니 '어떻게 생각해?'로.
 *
 * ── 왜 프롬프트만으로 안 되나 ──────────────────────────────────────
 * 2와 3은 "무조건"이 붙은 규칙이다. 프롬프트는 확률이라 새기 때문에
 * 줄표(stripDashes) 때와 같은 구조를 쓴다 — 프롬프트로 지시하고,
 * 게시 직전에 기계적으로 한 번 더 확정한다.
 * 1은 문장의 뜻을 봐야 해서 기계 치환이 불가능하다. 프롬프트에서
 * "마지막은 열린 질문"이라는 강제 문구를 걷어내는 것이 실제 수정이다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 치환이 실제로 동작할 것 (문자열 검사 아닌 실행 검증)
 *  2. 낱말 안의 '너'(너무/너머/건너는)를 망가뜨리지 않을 것
 *  3. URL 이 손상되지 않을 것
 *  4. 길이 판정보다 먼저 걸릴 것 (치환으로 글자 수가 늘어난다)
 *  5. 프롬프트가 질문형을 강제하지 않을 것
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

console.log('\n=== 1. 독자 호칭이 패퍼들로 바뀌는가 ===');
t('너는 → 패퍼들은', N('너는 어떤 쪽이야?') === '패퍼들은 어떤 쪽이야?');
t('너도/너의/너를 조사가 맞게 붙는다',
  N('너도') === '패퍼들도' && N('너의 취향') === '패퍼들의 취향' && N('너를') === '패퍼들을');
t('너랑 → 패퍼들이랑 (받침 뒤 조사)', N('너랑 같이') === '패퍼들이랑 같이');
t('너가 → 패퍼들이', N('너가 골라봐') === '패퍼들이 골라봐');
t('너희들이 패퍼들들로 겹치지 않는다',
  N('너희들 생각은?') === '패퍼들 생각은?', N('너희들 생각은?'));
t('너희 / 너네 도 패퍼들', N('너희') === '패퍼들' && N('너네') === '패퍼들');
t('문장 중간에서도 잡힌다',
  N('그래서, 너는 어때') === '그래서, 패퍼들은 어때');

console.log('\n=== 2. 낱말 안의 너는 건드리지 않는가 ===');
/* 앞 글자가 한글이면 조사가 아니라 어간의 일부다. 여기서 새면
   "건너는 길"이 "건패퍼들 길"이 된다. */
for (const w of ['너무 예쁘다', '지평선 너머', '길을 건너는 사람', '강을 건너가면', '너그러운']) {
  t('그대로 둔다: ' + w, N(w) === w, N(w));
}

console.log('\n=== 3. 어떻게 봐 → 어떻게 생각해 ===');
t('어떻게 봐? → 어떻게 생각해?', N('다들 어떻게 봐?') === '다들 어떻게 생각해?');
t('존댓말 변형도 같이 잡는다 (반말 규칙 이중 방어)',
  N('어떻게 보세요?') === '어떻게 생각해?' && N('어떻게 봐요?') === '어떻게 생각해?');
t('과거형은 과거형으로', N('어떻게 봤어?') === '어떻게 생각했어?');
t('두 규칙이 한 문장에서 같이 걸린다',
  N('너는 이거 어떻게 봐?') === '패퍼들은 이거 어떻게 생각해?',
  N('너는 이거 어떻게 봐?'));

console.log('\n=== 4. URL 을 깨뜨리지 않는가 ===');
/* 링크가 깨지면 스레드 링크 프리뷰 카드까지 같이 죽는다. */
const withUrl = '패퍼들 생각은?\n\nhttps://www.pap-magazine.com/article/너무-좋은-슬러그';
t('URL 안의 글자는 손대지 않는다', N(withUrl) === withUrl, N(withUrl));

console.log('\n=== 5. 생성 경로에 실제로 걸려 있는가 ===');
t('papVoice 가 normalizeSocialAddress 를 export 한다',
  typeof papVoice.normalizeSocialAddress === 'function');
t('스레드가 normalize() 로 네 경로를 모두 통과시킨다',
  (threads.match(/normalize\(/g) || []).length >= 5,
  '대화형 / 일반 AI / 폴백 2곳 + 정의부');
/* 2026-08-03 채널별 어미 개편으로 이 호출이 두 번째 인자를 받게 됐다
   ({ polite: ... }). 이 테스트가 지키는 것은 인자 모양이 아니라 '정규화가
   길이 판정보다 먼저'라는 순서이므로, 인자 부분은 느슨하게 두고 순서만 본다. */
t('socialHook 이 길이 판정 전에 정규화한다',
  /const text = papVoice\.normalizeSocialAddress\(raw2[^;]*\);[\s\S]{0,120}text\.length > limit/.test(hook),
  '치환으로 글자 수가 늘기 때문에(너는→패퍼들은) 나중에 걸면 X 의 280자 판정이 어긋난다');
t('X 는 socialHook 을 거치므로 자동 적용된다',
  /generateConversationalPost/.test(read('api/_lib/xPost.js')));

console.log('\n=== 6. 프롬프트가 질문형을 강제하지 않는가 ===');
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
t('프롬프트가 패퍼들 호칭을 지시한다',
  /패퍼들/.test(voicePrompt),
  '기계 치환은 보험이고, 자연스러운 문장은 프롬프트가 만든다');
t('프롬프트에 "어떻게 봐" 예시가 남아있지 않다',
  !/어떻게 봐|어떻게 봤|어떻게 보세요/.test(voicePrompt + hookPrompt + threadsPrompt),
  '예시는 지시보다 강하게 작동한다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ social-address tests FAILED'); process.exit(1); }
console.log('✅ social-address tests passed');
