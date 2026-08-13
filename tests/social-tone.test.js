/**
 * 소셜 어투 규칙 테스트 — 스레드 + X (2026-07-21 도메니코 지시)
 * ═══════════════════════════════════════════════════════════════════
 * 지시 두 가지:
 *   1. 줄표('ㅡ')는 AI 티가 나니까 항상 뺀다
 *   2. 전체 반말. 지금은 본문은 반말인데 마지막 질문만 존댓말로 튄다
 *
 * ── 왜 이렇게 고쳤나 ────────────────────────────────────────────────
 * 존댓말이 튀던 원인은 프롬프트 예시 문구였다.
 * socialHook.js 의 '마지막은 열린 질문. "다들 어떻게 보세요?" 정도면 된다'
 * 를 모델이 그대로 따라 썼다. 예시는 지시보다 강하게 작동한다.
 *
 * 줄표는 프롬프트 금지만으로는 부족하다. 두 가지 이유가 겹친다.
 *   · 프롬프트는 확률이라 샌다. "항상"을 지시받았으면 확정적 장치가 필요하다.
 *   · 프롬프트 본문 자체가 줄표투성이였다. 모델은 지시 내용만이 아니라
 *     지시가 쓰인 문체까지 따라한다. 그래서 프롬프트에서도 줄표를 걷어냈다.
 * → 게시 직전 stripDashes() 로 기계적으로 한 번 더 거른다. 이게 마지막 관문.
 *
 * ── 적용 범위 (2026-08-03 개정) ────────────────────────────────────
 * 1차 지시는 스레드였고, 이어진 "전부 반말로 통일" 지시로 X 까지 넓혔다.
 * 그런데 2026-08-03 지시가 그것을 뒤집었다:
 *   인스타(기사·캡션) 평서체 / 스레드 반말 / 그 밖의 한국어 채널 존댓말.
 * 그래서 이제 스레드와 X 의 어투는 의도적으로 갈린다. 갈리는 것은 어미와
 * 호칭뿐이고, 문장 리듬 규칙과 줄표 필터는 여전히 양쪽 공통이다.
 *
 * 이 파일에서 지켜야 할 것이 하나 늘었다. 예전엔 "분기가 되살아나면 안 된다"
 * 였고 지금은 "분기가 있되 한 곳에만 있어야 한다"다. 분기가 호출부마다
 * 흩어지면 어느 한 경로만 어미가 달라지고, 그건 눈으로 안 잡힌다.
 *
 * 샤오홍슈·카카오톡(socialRepurpose.js)은 넣지 않았다. 중국어에는 반말/존댓말
 * 구분이 없고, 카톡은 처음부터 정중체 채널이었다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 줄표가 실제로 제거될 것 (문자열 검사 아닌 실행 검증)
 *  2. URL 은 손상되지 않을 것 (슬러그의 '--' 가 깨지면 링크 프리뷰까지 죽는다)
 *  3. 생성 경로 전부에 필터가 걸려 있을 것 (한 경로라도 새면 의미 없다)
 *  4. 스레드 프롬프트가 반말을 지시하고, 존댓말 예시가 되살아나지 않을 것
 *  5. 스레드=반말 / X=존댓말 로 갈리되, 분기가 한 곳에만 있을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const threads = fs.readFileSync(path.join(ROOT, 'api/_lib/threadsAutopost.js'), 'utf8');
const hook = fs.readFileSync(path.join(ROOT, 'api/_lib/socialHook.js'), 'utf8');
const xpost = fs.readFileSync(path.join(ROOT, 'api/_lib/xPost.js'), 'utf8');
/* 2026-08-03 — 어투 문자열이 papVoice.js 로 단일화됐다(인스타 실게시물 50개
   역설계 결과). 프롬프트 검사는 "모델에게 실제로 가는 문자열"을 봐야 하므로
   socialHook.js 원문이 아니라 papVoice 를 합쳐서 본다. 이걸 안 하면 문자열이
   옮겨갔을 뿐인데 테스트가 빨갛게 뜬다. */
const voice = fs.readFileSync(path.join(ROOT, 'api/_lib/papVoice.js'), 'utf8');
const hookEffective = hook + '\n' + voice;

/* 이 모듈들은 supabase 를 require 하므로 통째로 로드할 수 없다.
   함수만 떼어내 실제로 실행한다 — 정규식 검사만으로는 동작을 못 본다. */
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}

console.log('\n=== 1. 줄표가 실제로 제거되는가 (실행 검증) ===');
const fnSrc = extractFn(hook, 'stripDashes');
t('stripDashes 를 공용 모듈(socialHook)에서 추출했다', !!fnSrc,
  '스레드 전용이 아니라 X 도 함께 쓴다');
let strip = null;
if (fnSrc) { strip = new Function(fnSrc + '; return stripDashes;')(); }
t('stripDashes 를 실행 가능한 함수로 만들었다', typeof strip === 'function');

if (typeof strip === 'function') {
  const DASHES = ['—', '–', '―', '‒', 'ㅡ', '--'];
  DASHES.forEach((d) => {
    const out = strip('앞 문장 ' + d + ' 뒤 문장이야.');
    t('줄표 ' + JSON.stringify(d) + ' 가 사라진다 → ' + JSON.stringify(out),
      !/[‒–—―]/.test(out) && !/\sㅡ\s/.test(out) && !out.includes('--'));
  });
  t('줄표 자리는 쉼표로 이어진다 (문장이 붙어버리지 않게)',
    strip('키워드는 하나 — 실루엣이야.') === '키워드는 하나, 실루엣이야.',
    '실제=' + strip('키워드는 하나 — 실루엣이야.'));
  t('앞이 이미 문장부호면 쉼표를 겹치지 않는다',
    strip('끝났어. — 그래도 남아.') === '끝났어. 그래도 남아.',
    '실제=' + strip('끝났어. — 그래도 남아.'));
  t('줄표 없는 문장은 그대로 둔다',
    strip('평범한 문장이야.') === '평범한 문장이야.');
  t('문장 끝 줄표는 쉼표를 남기지 않는다',
    strip('끝에 줄표 —') === '끝에 줄표', '실제=' + strip('끝에 줄표 —'));
}

console.log('\n=== 2. URL 이 손상되지 않는가 ===');
if (typeof strip === 'function') {
  const url = 'https://pap-magazine.com/article/a--b-slug';
  const out = strip('본문 — 이어서\n\n' + url);
  t('슬러그의 -- 가 보존된다', out.includes(url),
    'URL 이 깨지면 링크 프리뷰 카드까지 죽는다. 실제=' + out);
  t('URL 밖의 줄표는 그래도 제거된다', !out.includes('—'));
}

console.log('\n=== 3. 생성 경로 전부에 필터가 걸렸는가 ===');
const gen = extractFn(threads, 'generateThreadsText') || '';
t('generateThreadsText 를 찾았다', gen.length > 0);
/* 텍스트를 만들어 돌려주는 지점이 여러 개다(대화형 / 일반 AI / 폴백 2곳).
   한 곳이라도 빠지면 그 경로로 나간 글에 줄표가 남는다. */
const returns = (gen.match(/text:\s*[^,\n]+|const text = /g) || []).length;
/* 2026-08-03 — 필터가 normalize() 로 묶였다. stripDashes(줄표) + 호칭 정규화를
   한 함수로 통과시켜, 경로마다 어느 한쪽만 걸리는 사고를 구조적으로 막는다. */
const stripped = (gen.match(/normalize\(/g) || []).length;
t('텍스트 반환 지점 수만큼 필터가 걸려 있다 (반환 ' + returns + ' / 필터 ' + stripped + ')',
  stripped >= 4,
  '경로 하나만 빠져도 그쪽으로 나간 글에 줄표·호칭이 남는다');
/* 2026-08-03 — normalize() 가 검수(auditKoreanBody)까지 감싸며 여러 줄이 됐다.
   원문 한 줄을 통째로 비교하던 방식은 배선이 늘 때마다 깨지므로, 지키려던
   것만 남긴다: 한 함수 안에서 줄표 제거와 호칭 정규화가 **함께** 걸릴 것. */
t('normalize 가 줄표 제거를 감싼다',
  /function normalize\(s\) \{[\s\S]{0,260}papVoice\.normalizeSocialAddress\(stripDashes\(s\)\)/.test(threads),
  '한쪽만 걸면 지시 하나가 통째로 샌다');

console.log('\n=== 4. 프롬프트가 반말을 지시하는가 ===');
t('스레드 프롬프트가 반말을 지시한다', /반말/.test(threads));
t('마지막 질문도 반말이라고 못박는다',
  /마지막 질문만 존댓말로 바꾸지 마/.test(threads) || /질문도 반말/.test(hookEffective));
/* 검사 대상은 "모델에게 실제로 가는 문자열"이다. 코드 주석은 전달되지 않으므로
   제외한다 — 처음엔 파일 전체를 봐서, 수정 경위를 적어둔 주석("해요체 → 반말")
   을 아직 남은 지시로 오인해 실패했다. */
const promptOnly = (src) => (src.match(/^\s*'.*',?$/gm) || []).join('\n');
const threadsPrompt = promptOnly(threads);
const hookPrompt = promptOnly(hookEffective);

t('해요체 지시가 프롬프트에 남아있지 않다', !/해요체/.test(threadsPrompt));
t('존댓말 예시 "다들 어떻게 보세요"가 프롬프트에서 사라졌다',
  !/어떻게 보세요/.test(hookPrompt),
  '예시는 지시보다 강하게 작동한다. 이게 존댓말이 튀던 원인이었다');
t('프롬프트가 줄표 금지를 명시한다',
  /줄표/.test(threadsPrompt) && /줄표/.test(hookPrompt));
/* 프롬프트 "본문"에 줄표가 있으면 모델이 문체를 따라한다. */
const promptLines = threadsPrompt;
t('스레드 프롬프트 본문에 줄표가 없다',
  !/[—–―]/.test(promptLines.replace(/줄표\([^)]*\)/g, '')),
  '지시가 쓰인 문체까지 따라한다');

console.log('\n=== 5. 스레드=반말 / X=존댓말 로 갈리는가 ===');
/* 2026-08-03 도메니코 지시. 2026-07-21 의 "전 채널 반말 통일"을 대체한다.
   분기 자체는 이제 정상이다. 문제는 분기가 여러 곳에 생기는 것이다. */
t('어투를 고르는 함수가 하나 있다',
  /function toneFor\(platform\) \{ return platform === 'x' \? X_TONE : SOCIAL_TONE; \}/.test(hook),
  '삼항을 호출부마다 흩뿌리면 한 곳이 빠졌을 때 그 경로만 어미가 달라진다');
t('프롬프트가 그 함수를 통해서만 어투를 붙인다',
  /system: SYSTEM \+ '\\n' \+ toneFor\(platform\)/.test(hook));
/* 세는 것은 '어투' 분기뿐이다. 같은 파일의
   `const limit = platform === 'x' ? 180 : 420;` 은 X 의 글자수 제한이라
   어미와 무관한 별개의 관심사다. platform 삼항을 전부 세면 그 줄까지 걸려서,
   테스트가 실패해도 어투가 샜다는 뜻이 아니게 된다. 그래서 어투 상수 쌍으로 센다. */
t('어투 분기가 socialHook 안에서 한 번만 나온다',
  (hook.match(/X_TONE : SOCIAL_TONE/g) || []).length === 1,
  '분기가 늘어나면 어느 경로가 어떤 어미인지 추적이 안 된다');
t('글자수 제한 분기는 어투와 별개로 남아 있다',
  /const limit = platform === 'x' \? 180 : 420;/.test(hook),
  '어투를 가르면서 X 의 180자 제한을 건드리지 않았는지 같이 확인한다');
t('두 어투 모두 papVoice 단일 소스에서 온다',
  /const SOCIAL_TONE = papVoice\.SOCIAL_VOICE;/.test(hook)
    && /const X_TONE = papVoice\.X_VOICE;/.test(hook)
    && /const SOCIAL_VOICE = \[/.test(voice) && /const X_VOICE = \[/.test(voice),
  '어투 문자열을 socialHook 에 다시 하드코딩하면 채널마다 문체가 갈린다');
t('papVoice 의 스레드 반말 지시가 살아있다', /처음부터 끝까지 반말/.test(voice));
t('papVoice 의 X 존댓말 지시가 있다', /처음부터 끝까지 존댓말/.test(voice));

/* papVoice 는 supabase 를 안 물어서 통째로 require 할 수 있다. 문자열 검사로
   끝내지 않고 실제 값을 본다 — 상수 이름만 맞고 내용이 뒤바뀌는 사고가 있다. */
const papVoice = require(path.join(ROOT, 'api/_lib/papVoice.js'));
t('SOCIAL_VOICE 안에 존댓말 지시가 섞여 있지 않다',
  !/존댓말로 끝/.test(papVoice.SOCIAL_VOICE) && !/처음부터 끝까지 존댓말/.test(papVoice.SOCIAL_VOICE));
t('X_VOICE 안에 반말 지시가 섞여 있지 않다',
  !/처음부터 끝까지 반말/.test(papVoice.X_VOICE));

console.log('\n=== 6. 존댓말 채널의 후처리가 반말로 되돌리지 않는가 ===');
/* 호칭 정규화(normalizeSocialAddress)는 원래 반말 전용이었다. X 가 존댓말이
   된 뒤에도 반말판을 그대로 걸면 마지막 문장만 반말로 튄다 — 2026-07-21 에
   고쳤던 사고가 방향만 뒤집혀 재발한다. */
t('X 는 존댓말 치환표를 쓴다',
  /normalizeSocialAddress\(raw2, \{ polite: isPolite\(platform\) \}\)/.test(hook));
t('스레드 호출부는 인자 없이 부른다 (기존 반말 동작 유지)',
  /papVoice\.normalizeSocialAddress\(stripDashes\(s\)\)/.test(threads));
/* 2026-08-13 — 호칭을 없앴다. 그전에는 '너' 를 '패퍼들' 로 바꿨지만, 실제
   반응 좋은 스레드 글은 독자를 아예 부르지 않는다. 이제 주어 자리의 호칭은
   지워진다(social-address.test.js 가 규칙 전체를 지킨다). 여기서 지키는 것은
   '어미 갈래(반말/존댓말)가 채널별로 유지되는가' 하나다. */
t('polite:true 면 물음이 존댓말로 정리된다',
  papVoice.normalizeSocialAddress('패퍼들은 어떻게 보세요?', { polite: true }) === '어떻게 생각하세요?',
  papVoice.normalizeSocialAddress('패퍼들은 어떻게 보세요?', { polite: true }));
t('인자 없이 부르면 반말 갈래다',
  papVoice.normalizeSocialAddress('너는 어떻게 봐?') === '어떻게 생각해?',
  papVoice.normalizeSocialAddress('너는 어떻게 봐?'));
t('호칭 제거는 어미와 무관하게 양쪽 다 걸린다',
  papVoice.normalizeSocialAddress('너는 이 룩 어떻게 봐요?', { polite: true }) === '이 룩 어떻게 생각하세요?',
  papVoice.normalizeSocialAddress('너는 이 룩 어떻게 봐요?', { polite: true }));

console.log('\n=== 7. 줄표 필터는 여전히 양쪽 공통인가 ===');
t('X 도 줄표 필터를 거친다', /stripDashes\(hook\.text\)/.test(xpost),
  '스레드만 걸면 X 에 줄표가 남는다');
t('X 는 길이 판정 전에 필터를 건다',
  /const body = papVoice\.auditKoreanBody\(stripDashes\(hook\.text\),[\s\S]{0,260}weightedLen\(measured\)/.test(xpost),
  '나중에 걸면 줄어든 길이가 반영 안 돼 멀쩡한 트윗을 280자 초과로 버린다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ social-tone tests FAILED'); process.exit(1); }
console.log('✅ social-tone tests passed');
