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
 * ── 적용 범위 ───────────────────────────────────────────────────────
 * 1차 지시는 스레드였고, 이어진 "전부 반말로 통일" 지시로 X 까지 넓혔다.
 * 그래서 어투 규칙(SOCIAL_TONE)은 플랫폼 분기 없이 항상 붙고,
 * stripDashes 는 공용 모듈(socialHook.js)로 옮겨 스레드·X 가 함께 쓴다.
 *
 * 샤오홍슈·카카오톡(socialRepurpose.js)은 넣지 않았다. 중국어에는 반말/존댓말
 * 구분이 없고, 카톡 채널은 고객 공지 성격이라 별도 판단이 필요하다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 줄표가 실제로 제거될 것 (문자열 검사 아닌 실행 검증)
 *  2. URL 은 손상되지 않을 것 (슬러그의 '--' 가 깨지면 링크 프리뷰까지 죽는다)
 *  3. 생성 경로 전부에 필터가 걸려 있을 것 (한 경로라도 새면 의미 없다)
 *  4. 프롬프트가 반말을 지시하고, 존댓말 예시가 되살아나지 않을 것
 *  5. 스레드·X 양쪽에 적용될 것 (플랫폼 분기 부활 금지)
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
const stripped = (gen.match(/stripDashes\(/g) || []).length;
t('텍스트 반환 지점 수만큼 필터가 걸려 있다 (반환 ' + returns + ' / 필터 ' + stripped + ')',
  stripped >= 4,
  '경로 하나만 빠져도 그쪽으로 나간 글에 줄표가 남는다');

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

console.log('\n=== 5. 전 채널(스레드+X) 공통 적용인가 ===');
/* 2026-07-21 2차 지시 "전부 반말로 통일" — 처음엔 스레드에만 붙였다가
   X 를 포함한 전 채널 공통으로 올렸다. 플랫폼 분기가 되살아나면 안 된다. */
t('어투 규칙이 플랫폼 분기 없이 항상 붙는다',
  /system: SYSTEM \+ '\\n' \+ SOCIAL_TONE/.test(hook),
  "platform === 'threads' 분기가 되살아나면 X 가 다시 존댓말로 샌다");
t('SOCIAL_TONE 이 papVoice 단일 소스에서 온다',
  /const SOCIAL_TONE = papVoice\.SOCIAL_VOICE;/.test(hook) && /const SOCIAL_VOICE = \[/.test(voice),
  '어투 문자열을 socialHook 에 다시 하드코딩하면 채널마다 문체가 갈린다');
t('papVoice 의 반말 지시가 살아있다', /처음부터 끝까지 반말/.test(voice));
t('X 도 줄표 필터를 거친다', /stripDashes\(hook\.text\)/.test(xpost),
  '스레드만 걸면 X 에 줄표가 남는다');
t('X 는 길이 판정 전에 필터를 건다',
  /const body = stripDashes\(hook\.text\);[\s\S]{0,200}weightedLen\(measured\)/.test(xpost),
  '나중에 걸면 줄어든 길이가 반영 안 돼 멀쩡한 트윗을 280자 초과로 버린다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ social-tone tests FAILED'); process.exit(1); }
console.log('✅ social-tone tests passed');
