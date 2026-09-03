/**
 * X 말투 폴백 — 가드 (2026-09-03 신설, 도메니코 "1번")
 *
 * ■ 왜 만들었나 — 어제 붙인 x_posts 기록이 하루 만에 답을 줬다
 *
 *   본문 트윗 12건 중 PAP 말투는 **1건**. 나머지는 이렇게 나갔다:
 *
 *     입생로랑 뷰티가 성수에 연 특별한 아지트
 *
 *     입생로랑 뷰티(YSL Beauty)가 성수동에 새로운 부띠크를 열었다.
 *
 *     #YSLBEAUTY #SEONGSU #PAPMAGAZINE
 *
 *   제목 + 기사 첫 문장 + 태그. socialHook 의 SYSTEM 이 "매체 공지 어투를 쓰지
 *   마라" 고 못박은 바로 그 문체이고, 종결도 존댓말이 아니다.
 *
 *   원인: generateConversationalPost 가 hookScore 문턱을 못 넘으면 null 을 주고
 *   호출부가 기계식 폴백으로 갔다. 대부분의 기사가 문턱을 못 넘는다.
 *
 *   2026-09-02 에 "말투는 이미 입히고 있다" 고 보고했는데 **반만 맞았다.**
 *   코드 경로는 있었고 실제로는 12분의 1만 그 경로를 탔다.
 *   눈금(x_posts)이 없었으면 이번에도 몰랐다.
 *
 * ■ 도메니코 판단
 *   문턱은 "말을 걸 만한 기사인가" 를 보는 것이지 "말투를 쓸 자격" 이 아니다.
 *   대화거리가 없어도 PAP 말투로는 쓴다. 억지 질문을 만들지 않을 뿐이다.
 *
 * 여기서 지키는 것:
 *   ① 문턱을 못 넘어도 말투 생성기가 받는다
 *   ② 말투형은 **묻지 않는다** (억지 질문 금지)
 *   ③ 차단 소재(사망·사고·소송)는 말투형도 막는다 — 문턱만 없앴지 안전선은 그대로
 *   ④ 둘 다 실패해도 트윗은 나간다 (기계식 폴백)
 *   ⑤ 말투형을 **필요할 때만** 부른다 (대화형이 성공하면 안 부른다)
 *   ⑥ 어투는 여전히 papVoice 단일 소스에서 온다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HOOK = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'socialHook.js'), 'utf8');
const XP = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'xPost.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const hook = require(path.join(ROOT, 'api', '_lib', 'socialHook.js'));

console.log('[1] 문턱을 못 넘어도 말투로 쓴다  ← ①');
t('말투 생성기가 있다', typeof hook.generateVoicePost === 'function');
t('호출부가 대화형 실패 뒤에 말투형을 부른다',
  /const conv = build\(await generateConversationalPost\(art, 'x'\)\);[\s\S]{0,200}generateVoicePost\(art, 'x'\)/.test(XP));
t('말투형을 필요할 때만 부른다 (대화형 성공이면 먼저 반환)  ← ⑤',
  /if \(conv\) return conv;/.test(XP));

console.log('\n[2] 말투형은 묻지 않는다  ← ②');
t('억지 질문을 금지한다', /\*\*묻지 않는다\.\*\*/.test(hook.VOICE_SYSTEM), hook.VOICE_SYSTEM.slice(0, 60));
t('"어떻게 생각하세요" 를 쓰지 말라고 못박는다', /어떻게 생각하세요/.test(hook.VOICE_SYSTEM));
t('매체 공지 어투를 금지한다 (지금 나가는 문체가 그것이다)',
  /매체 공지 어투/.test(hook.VOICE_SYSTEM) && /공개했다/.test(hook.VOICE_SYSTEM));
t('제목 복붙을 막는다 (제목이 이미 있는 자리다)', /제목을 그대로 옮기지 않는다/.test(hook.VOICE_SYSTEM));
t('구체적인 장면을 앞에 두라고 한다', /구체적인 한 장면|손에 잡히는/.test(hook.VOICE_SYSTEM));

console.log('\n[3] 안전선은 그대로  ← ③');
/* 사망·사고·소송 기사는 가볍게 말할 자리가 아니다. 대화형이든 전달형이든 같다. */
t('말투형도 차단 소재를 막는다', /if \(gate\.blocked\) return null;/.test(HOOK));
t('미확인 인물 지목 금지가 있다', /미확인 인물을 실명으로 지목하지 않는다/.test(hook.VOICE_SYSTEM));
t('지어내기 금지가 있다', /지어내지 않는다/.test(hook.VOICE_SYSTEM));
t('외모 평가 금지가 있다', /외모·신체를 평가하지 않는다/.test(hook.VOICE_SYSTEM));

console.log('\n[4] 실패해도 트윗은 나간다  ← ④');
t('둘 다 실패하면 기계식 폴백이 받는다',
  /const voice = build\(await generateVoicePost[\s\S]{0,200}\} catch \(_\) \{[\s\S]{0,60}\}\s*const title = _clampTitle/.test(XP));
t('길이 초과면 버리고 다음 후보로 간다 (280자 계약 유지)',
  /if \(weightedLen\(body\) > 280\) return null;/.test(XP));

console.log('\n[5] 규칙을 두 벌로 만들지 않았다  ← ⑥');
t('모델 호출이 한 곳이다 (_ask)', (HOOK.match(/await fetch\('https:\/\/api\.anthropic\.com/g) || []).length === 1,
  '생성기마다 fetch 를 두면 파싱·호칭 정규화가 갈린다');
t('두 생성기가 같은 호출을 쓴다',
  /_ask\(SYSTEM,/.test(HOOK) && /_ask\(VOICE_SYSTEM,/.test(HOOK));
t('어투는 여전히 papVoice 에서 온다 (여기 하드코딩 금지)',
  !/처음부터 끝까지 존댓말/.test(hook.VOICE_SYSTEM),
  'VOICE_SYSTEM 에 어미 지시를 또 적으면 papVoice 와 갈린다');
t('길이 상한도 한 곳이다', (HOOK.match(/platform === 'x' \? 180 : 420/g) || []).length === 1);

console.log('\n' + (fail ? '✗' : '✓') + ' x-voice-fallback: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
