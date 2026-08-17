/**
 * 법정 고지 문장 예외 (2026-08-18 신설)
 *
 * 배경 — 실제 오탐:
 *   본문 보강 초안 31편 중 '존댓말 감지' 경보가 3건 떴는데 2건이 거짓이었다.
 *
 *     "경고: 지나친 음주는 뇌졸중, 기억력 손상이나 치매를 유발합니다."
 *     "19세 이상의 법적 음주 허용 소비자를 위한 콘텐츠입니다."
 *
 *   국민건강증진법이 문안까지 정해 둔 문장이라 '~합니다' 를 '~한다' 로
 *   바꾸면 법정 문구가 아니게 된다. 고칠 수 없는 것을 계속 경보로 올리면
 *   사람이 경보를 안 보게 되고, **진짜 위반 1건이 거짓 2건에 묻힌다.**
 *
 * 이 하네스가 지키는 것:
 *   ① 법정 고지의 존댓말은 경보를 만들지 않는다
 *   ② 예외가 너무 넓지 않다 — 같은 본문의 진짜 위반은 여전히 잡힌다
 *   ③ 예외는 어미 검사에만 적용된다 (길이·단락·대시·불릿은 원문 그대로)
 *   ④ 존댓말 채널(polite)에서도 대칭으로 동작한다
 *   ⑤ 생성 쪽에도 '고치지 마라' 가 박혀 있다 (탐지만 끄면 모델이 지운다)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const v = require(path.join(ROOT, 'api', '_lib', 'papVoice.js'));
const BACKFILL = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'article-body-backfill.js'), 'utf8');
const IMPORT = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'instagramImport.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}
function P(fn) { try { return fn(); } catch (e) { return { __threw: String(e && e.message) }; } }

/* 실제 DB 에 들어 있는 문구 그대로. 바꾸지 말 것 — 이게 회귀 기준이다. */
const WARN_A = '경고: 지나친 음주는 뇌졸중, 기억력 손상이나 치매를 유발합니다. 임신 중 음주는 기형아 출생 위험을 높입니다.';
const WARN_B = '본 콘텐츠는 19세 이상의 법적 음주 허용 소비자를 위한 것입니다.';
const WARN_C = '19세 이상의 법적 음주 허용 소비자를 위한 콘텐츠입니다.';
const ART = 'ARTICLE_OPTS';
const artOpts = { style: 'plain', structure: true, maxParas: 4, maxLen: 1500 };

console.log('\n=== ① 법정 고지는 경보를 안 만든다 ===');
{
  const body = '에덴 보드카가 새 병을 냈다.<br><br>' + WARN_A;
  const got = P(() => v.lintKoreanBody(body, artOpts));
  t('과음 경고만 있는 본문은 존댓말 경보 없음',
    Array.isArray(got) && !got.some((i) => /존댓말/.test(i)), got);

  const body2 = '짐빔 하이볼 캠페인이 시작됐다.<br><br>' + WARN_B;
  t('19세 표기도 경보 없음',
    (P(() => v.lintKoreanBody(body2, artOpts)) || []).every((i) => !/존댓말/.test(i)));

  const body3 = '설날 선물로 좋다.<br><br>' + WARN_C;
  t('에덴 보드카 실제 문구 그대로 통과',
    (P(() => v.lintKoreanBody(body3, artOpts)) || []).every((i) => !/존댓말/.test(i)));

  t('경고 문장만 있어도 통과',
    (P(() => v.lintKoreanBody(WARN_A, { style: 'plain', structure: false })) || []).length === 0);
}

console.log('\n=== ② 예외가 너무 넓지 않다 ===');
{
  /* 같은 본문에 진짜 위반이 섞이면 그건 반드시 잡혀야 한다.
     문단째·본문째 들어내면 여기서 무너진다. */
  const mixed = '뷔가 쇼장에 나타났습니다.<br><br>' + WARN_A;
  const got = P(() => v.lintKoreanBody(mixed, artOpts)) || [];
  t('경고문 옆의 진짜 존댓말은 여전히 잡힌다', got.some((i) => /존댓말/.test(i)), got);

  const mixed2 = WARN_A + '<br><br>독자 여러분께 전해드리겠습니다.';
  t('경고문 뒤의 진짜 존댓말도 잡힌다',
    (P(() => v.lintKoreanBody(mixed2, artOpts)) || []).some((i) => /존댓말/.test(i)));

  t('술과 무관한 존댓말은 그대로 잡힌다',
    (P(() => v.lintKoreanBody('오늘 쇼가 열렸습니다.', { structure: false })) || [])
      .some((i) => /존댓말/.test(i)));

  /* 문장 하나만 지워야 한다 — 앞뒤 문장이 남아 있는지 직접 본다 */
  const stripped = P(() => v.stripLegalNotices('앞 문장이다. ' + WARN_C + ' 뒤 문장이다.'));
  t('앞 문장이 남는다', /앞 문장이다\./.test(String(stripped)), stripped);
  t('뒤 문장이 남는다', /뒤 문장이다\./.test(String(stripped)), stripped);
  t('고지 문장만 사라진다', !/19세/.test(String(stripped)), stripped);
}

console.log('\n=== ③ 어미 검사에만 적용된다 ===');
{
  /* 길이는 원문 그대로 세야 한다 — 경고문도 지면을 차지한다.
     예외를 길이 계산에까지 흘리면 짧은 기사가 통과해 버린다. */
  const filler = '가나다라마바사아자차'.repeat(20);      // 200자
  const long = [filler, filler, filler, filler, filler, filler, filler, filler].join('') + ' ' + WARN_A;
  const got = P(() => v.lintKoreanBody(long, { style: 'plain', structure: true, maxParas: 4, maxLen: 300 })) || [];
  t('길이 검사는 고지문까지 센다', got.some((i) => /본문 \d+자/.test(i)), got);

  const paras = ['가다.', '나다.', '다다.', '라다.', '마다.', WARN_A].join('<br><br>');
  t('단락 검사도 고지문을 센다',
    (P(() => v.lintKoreanBody(paras, artOpts)) || []).some((i) => /단락 6개/.test(i)));

  t('대시 검사는 원문 기준', (P(() => v.lintKoreanBody('무대 위 — 가면.', { structure: false })) || [])
    .some((i) => /대시/.test(i)));
  t('불릿 검사는 원문 기준 (줄바꿈이 안 뭉개졌다)',
    (P(() => v.lintKoreanBody('머리다.\n- 항목', { structure: false })) || [])
      .some((i) => /불릿/.test(i)));
}

console.log('\n=== ④ 존댓말 채널에서도 대칭 ===');
{
  /* polite 채널은 반대로 평서체를 잡는다. 고지문은 존댓말이라 원래
     안 걸리지만, 예외가 방향과 무관하게 문장을 들어내는지 본다. */
  t('polite 채널에서 고지문만 있으면 조용하다',
    (P(() => v.lintKoreanBody(WARN_A, { style: 'polite', structure: false })) || []).length === 0);
  t('polite 채널에서 진짜 평서체는 잡힌다',
    (P(() => v.lintKoreanBody(WARN_A + ' 쇼가 열렸다.', { style: 'polite', structure: false })) || [])
      .some((i) => /평서체/.test(i)));
}

console.log('\n=== ⑤ 생성 쪽도 막아 뒀다 ===');
{
  /* 탐지만 끄면 반쪽이다. 모델이 경고문을 평서체로 고치거나 지우면
     그건 법정 문구가 아니게 되는데, 이제 린터는 조용하다. */
  t('보강 프롬프트에 고지 보존 규칙이 있다', /법으로 문안이 정해진 고지 문장은 한 글자도 바꾸지 마라/.test(BACKFILL));
  t('삭제도 금지라고 못 박았다', /삭제도 금지/.test(BACKFILL));
  t('ARTICLE_VOICE 보다 아래에 예외 선언이 있다',
    BACKFILL.indexOf('papVoice.ARTICLE_VOICE') < BACKFILL.indexOf('위 문체 규칙의 유일한 예외는'));
  t('인스타 수입 프롬프트에도 있다', /법정 고지 문장\(주류 과음/.test(IMPORT));
  t('인스타 쪽은 body_ko 규격 바로 뒤에 붙어 있다',
    IMPORT.indexOf('"body_ko"') < IMPORT.indexOf('// 예외: 캡션에 법정 고지 문장'));

  t('stripLegalNotices 가 export 된다', typeof v.stripLegalNotices === 'function');
  t('빈 입력에도 안 죽는다', v.stripLegalNotices('') === '' && typeof v.stripLegalNotices(null) === 'string');
}

console.log('\n' + (fail ? '✗' : '✓') + ' voice-legal-notice: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
