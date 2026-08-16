/**
 * 기사 본문 길이 상향 (2026-08-17 신설)
 *
 * 배경 — GSC 30일 실측:
 *   · 노출의 89.6%가 4~10위에 갇혀 있다 (그 구간 CTR 1.27%)
 *   · 1~3위 키워드는 392개(10.5%)뿐인데 클릭의 56.5%를 만든다
 *   · 발행 기사 본문 평균 545자, 72.5%가 600자 미만
 *   · 네이버는 기사 스니펫으로 본문 대신 DOWNLOADS 멤버십 안내를 긁어갔다
 * 원인은 papVoice 의 "2단락 / 250~450자" 였고, 도메니코가 상향(안 '나')을 택했다.
 *
 * 이 하네스가 지키는 것 — 상향 자체보다 **번지지 않는 것**이 핵심이다:
 *   ① 웹 기사만 길어진다 (800~1,200자 / 3~4단락)
 *   ② 인스타·스레드·카카오·뉴스레터 규격은 한 글자도 안 변한다
 *   ③ 자가검증 문구가 본문 규격과 모순되지 않는다 (모순되면 모델이 짧게 회귀한다)
 *   ④ 영어 단락 수가 한국어와 맞는다 (body_en 은 body_ko 미러링이다)
 *   ⑤ 린터 기본 동작이 그대로다 — 기존 호출부 7곳이 영향받으면 안 된다
 *   ⑥ 분량을 지어내서 채우지 못하게 막는 문장이 살아 있다
 *   ⑦ max_tokens 가 늘어난 출력을 감당한다 (모자라면 JSON 이 잘려 게시물 유실)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const v = require(path.join(ROOT, 'api', '_lib', 'papVoice.js'));
const importSrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'instagramImport.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

console.log('\n=== ① 웹 기사 규격이 올라갔다 ===');
{
  t('본문 800~1,200자', /800~1,200자/.test(v.ARTICLE_VOICE));
  t('3~4단락', /단락은 3~4개/.test(v.ARTICLE_VOICE));
  t('옛 규격(250~450자)이 안 남아 있다', !/250~450자/.test(v.ARTICLE_VOICE));
  t('옛 규격(정확히 2개)이 안 남아 있다', !/단락은 정확히 2개/.test(v.ARTICLE_VOICE));
}

console.log('\n=== ② 다른 채널로 번지지 않는다 ===');
{
  // 인스타 캡션 등 짧은 표면 — 상향 전과 완전히 같아야 한다
  t('KO_BODY 는 여전히 2단락', /단락은 정확히 2개/.test(v.KO_BODY));
  t('KO_BODY 는 여전히 250~450자', /250~450자/.test(v.KO_BODY));
  t('KO_BODY 에 새 규격이 안 샜다', !/800~1,200자/.test(v.KO_BODY));
  t('SHORT_ARTICLE_VOICE 가 옛 규격 그대로', /250~450자/.test(v.SHORT_ARTICLE_VOICE)
    && /단락은 정확히 2개/.test(v.SHORT_ARTICLE_VOICE));

  // 짧은 카피 규격(뉴스레터·틱톡·푸시)은 분량 규정을 애초에 안 갖는다
  t('KO_MICRO 에 분량 규정이 안 생겼다',
    !/800~1,200자/.test(v.KO_MICRO) && !/250~450자/.test(v.KO_MICRO));
  t('EDITORIAL_VOICE 는 2단락 이내 유지', /2단락 이내/.test(v.EDITORIAL_VOICE));
  t('SOCIAL_VOICE 에 기사 분량이 안 샜다', !/800~1,200자/.test(v.SOCIAL_VOICE));
  t('X_VOICE 에 기사 분량이 안 샜다', !/800~1,200자/.test(v.X_VOICE));
  t('KAKAO_VOICE 에 기사 분량이 안 샜다', !/800~1,200자/.test(v.KAKAO_VOICE));
}

console.log('\n=== ③ 자가검증이 본문 규격과 모순되지 않는다 ===');
{
  // 본문엔 800~1,200 이라 해놓고 자가검증에 "500자를 넘는다" 가 남으면
  // 모델이 상충 지시를 받아 짧은 쪽으로 회귀한다 — 가장 흔한 실패 모드다.
  t('기사 자가검증에 500자 조항이 없다', !/500자를 넘는다/.test(v.SELF_CHECK_ARTICLE), v.SELF_CHECK_ARTICLE);
  t('기사 자가검증에 1,400자 상한이 있다', /1,400자를 넘는다/.test(v.SELF_CHECK_ARTICLE));
  t('ARTICLE_VOICE 안에도 500자 조항이 없다', !/500자를 넘는다/.test(v.ARTICLE_VOICE));
  t('짧은 자가검증은 그대로 500자', /500자를 넘는다/.test(v.SELF_CHECK));
  t('짧은 규격 안에도 500자 조항이 살아 있다', /500자를 넘는다/.test(v.SHORT_ARTICLE_VOICE));
}

console.log('\n=== ④ 영어 단락 수가 한국어와 맞는다 ===');
{
  t('기사 영문은 3~4단락', /3 to 4 paragraphs/.test(v.ARTICLE_VOICE));
  t('기사 영문에 Exactly 2 가 안 남았다', !/Exactly 2 paragraphs/.test(v.ARTICLE_VOICE));
  t('짧은 규격 영문은 그대로 2단락', /Exactly 2 paragraphs/.test(v.SHORT_ARTICLE_VOICE));
}

console.log('\n=== ⑤ 린터 기본 동작 불변 (기존 호출부 7곳 보호) ===');
{
  const long = '가'.repeat(600) + '다.';
  const dflt = v.lintKoreanBody(long, { structure: true });
  t('인자 없으면 600자를 여전히 위반으로 잡는다',
    dflt.some((i) => /본문 \d+자/.test(i)), dflt);
  t('기본 권장 상한 문구가 450자 그대로',
    dflt.some((i) => /450자 권장 상한/.test(i)), dflt);

  const threePara = '가다.\n\n나다.\n\n다다.';
  t('인자 없으면 3단락을 여전히 위반으로 잡는다',
    v.lintKoreanBody(threePara, { structure: true }).some((i) => /단락 3개/.test(i)));

  // 기사 한도를 넘기면 통과해야 한다
  const artOpts = { structure: true, maxParas: 4, maxLen: 1500 };
  t('기사 한도에서 600자는 통과', v.lintKoreanBody(long, artOpts).length === 0,
    v.lintKoreanBody(long, artOpts));
  t('기사 한도에서 4단락은 통과',
    v.lintKoreanBody('가다.\n\n나다.\n\n다다.\n\n라다.', artOpts).length === 0);
  t('기사 한도에서도 5단락은 잡는다',
    v.lintKoreanBody('가다.\n\n나다.\n\n다다.\n\n라다.\n\n마다.', artOpts)
      .some((i) => /단락 5개/.test(i)));
  t('기사 한도에서도 1,600자는 잡는다',
    v.lintKoreanBody('가'.repeat(1600) + '다.', artOpts).some((i) => /본문 \d+자/.test(i)));

  // structure:false 는 길이·단락을 아예 안 본다 (스레드·카카오·에디토리얼 경로)
  t('structure:false 면 길이를 안 본다',
    v.lintKoreanBody(long, { structure: false }).every((i) => !/본문 \d+자/.test(i)));

  // 문체 검사(존댓말·대시·번역투)는 길이와 무관하게 그대로여야 한다
  t('존댓말 감지 그대로', v.lintKoreanBody('이건 문제입니다.', { structure: false }).length > 0);
  t('대시 감지 그대로', v.lintKoreanBody('무대 위 — 가면이다.', { structure: false })
    .some((i) => /대시/.test(i)));
}

console.log('\n=== ⑥ 분량을 지어내서 채우지 못하게 막는다 ===');
{
  t('없는 사실 지어내기 금지가 명시돼 있다',
    /없는 사실을 지어내는 것은 절대 금지/.test(v.ARTICLE_VOICE));
  t('말 늘리기 금지가 명시돼 있다', /같은 말을 바꿔 쓰거나/.test(v.ARTICLE_VOICE));
  t('쓸 게 없으면 짧아도 된다는 탈출구가 있다',
    /지어내는 것보다 짧은 게 낫다/.test(v.ARTICLE_VOICE));
  t('전 채널 공통 사실성 가드가 살아 있다',
    /원문\/기사에 없는 사실을 만들어내지 않는다/.test(v.ARTICLE_VOICE));
}

console.log('\n=== ⑦ 생성기 배선 ===');
{
  t('프롬프트 body_ko 가 800~1,200자', /"body_ko".{0,120}800~1,200자/.test(importSrc));
  t('프롬프트 body_ko 가 3~4단락', /"body_ko".{0,80}3~4단락/.test(importSrc));
  /* 주석에는 "250~450자 → 800~1,200자" 라는 변경 이력이 남아 있어야 한다.
     지켜야 할 것은 "모델에게 가는 문자열"에 옛 규격이 없는 것이므로,
     따옴표로 시작하는 프롬프트 리터럴 줄만 본다. */
  const promptLiterals = importSrc.split('\n').filter((l) => /^\s*'/.test(l));
  t('모델에게 가는 프롬프트에 옛 250~450자가 없다',
    !promptLiterals.some((l) => /250~450자/.test(l)),
    promptLiterals.filter((l) => /250~450자/.test(l)));
  t('변경 이력 주석은 남아 있다', /250~450자 → 800~1,200자/.test(importSrc));
  t('프롬프트 body_en 이 3~4단락', /"body_en".{0,80}3 to 4 paragraphs/.test(importSrc));
  t('프롬프트에 옛 Exactly 2 가 안 남았다', !/Exactly 2 paragraphs in English/.test(importSrc));
  t('ARTICLE_VOICE 를 그대로 주입한다', /papVoice\.ARTICLE_VOICE/.test(importSrc));

  // 출력이 커졌는데 토큰이 모자라면 JSON 이 잘려 그 게시물이 통째로 유실된다
  const mt = parseInt((importSrc.match(/max_tokens:\s*(\d+)/) || [])[1], 10);
  t('max_tokens 가 5000 이상', mt >= 5000, mt);
}

console.log('\n' + (fail ? '✗' : '✓') + ' article-body-length: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
