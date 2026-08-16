/**
 * 영어로 저장된 다국어 제목 수리 (2026-08-16 신설).
 *
 * ── 무엇을 고치는 작업인가 ───────────────────────────────────────────
 * seo_translations 전수 실측 — 제목이 articles.title_en 과 완전히 동일한 행:
 *     es 653/2,372 (27.5%) · it 603/2,370 (25.4%)
 *     fr 510/2,370 (21.5%) · de 139/2,369 (5.9%)   ja·zh·ru 은 0
 * 재발 방지는 커밋 b71e75e 가 막았다. 여기는 **이미 저장된 1,905건의 수리**다.
 *
 * ── 이 테스트가 지키는 것 ────────────────────────────────────────────
 *   ① 본문을 다시 번역하지 않는다 (그게 이 경로의 존재 이유 — 비용)
 *   ② 기본이 dry-run 이다 (도메니코 돈이 드는 호출)
 *   ③ 발행 상태·삭제를 절대 건드리지 않는다
 *   ④ 못 고쳤으면 옛것을 그대로 둔다 (깨진 제목보다 영어 제목이 낫다)
 *   ⑤ 오탐이 없다 (브랜드명뿐인 제목은 원래 그대로가 정답)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const LIB = path.join(ROOT, 'api', '_lib', 'titleRepair.js');
const API = path.join(ROOT, 'api', 'admin', 'repair-english-titles.js');
const BACKFILL = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* supabase 를 스텁으로 갈아끼워 순수하게 불러온다. */
const m = new Module(SUPABASE, null);
m.filename = SUPABASE; m.loaded = true;
m.exports = { supabaseAdmin: { from() { throw new Error('no db in test'); } } };
require.cache[SUPABASE] = m;

const R = { needsRepair: null };
const { REPAIR_LANGS, needsRepair, buildTitlePrompt, parseTitles, rejectReason } = require(LIB);
const apiSrc = fs.readFileSync(API, 'utf8');
const libSrc = fs.readFileSync(LIB, 'utf8');
const backfillSrc = fs.readFileSync(BACKFILL, 'utf8');

const EN = "KATSEYE Teases Bold Transformation with 'ANIMAL' Single";
const KO = "캣츠아이, 싱글 'ANIMAL' 티저 공개로 강렬한 변신 예고";
const row = (over) => Object.assign({ lang: 'es', title: EN, title_en: EN, title_ko: KO }, over || {});

console.log('\n=== ① 대상 판정 ===');
t('영어 에코를 대상으로 잡는다', needsRepair(row()) === true);
t('it · fr · de 도 대상이다',
  needsRepair(row({ lang: 'it' })) && needsRepair(row({ lang: 'fr' })) && needsRepair(row({ lang: 'de' })));
t('ja · zh · ru 은 대상이 아니다 (이 사고가 안 나는 언어)',
  !needsRepair(row({ lang: 'ja' })) && !needsRepair(row({ lang: 'zh' })) && !needsRepair(row({ lang: 'ru' }))
  && !REPAIR_LANGS.includes('ja'));
t('이미 번역된 제목은 건드리지 않는다',
  !needsRepair(row({ title: "KATSEYE anticipa una transformación audaz con el sencillo 'ANIMAL'" })));
t('브랜드명뿐이라 원래 같은 제목은 잡지 않는다 (오탐 방지)',
  !needsRepair(row({ title: 'CRIMSON', title_en: 'CRIMSON' })));
t('영어 원문을 모르면 잡지 않는다', !needsRepair(row({ title_en: null })));
t('빈 입력에 죽지 않는다', needsRepair(null) === false && needsRepair({}) === false);

console.log('\n=== ② 프롬프트 — 제목만 보낸다 (이 경로의 존재 이유) ===');
const P = buildTitlePrompt([{ title_ko: KO, title_en: EN }], 'es');
t('한국어 원제와 영어판을 함께 준다', /korean_title/.test(P) && /english_title/.test(P));
t('본문을 싣지 않는다 (BODY·DESCRIPTION 없음)', !/BODY|DESCRIPTION/.test(P));
t('영어를 그대로 돌려주면 실패라고 못박는다',
  /REFERENCE ONLY/.test(P) && /Returning it unchanged is a failure/.test(P));
t('같은 알파벳이라 이렇게 틀렸다는 것까지 말한다', /same alphabet as English/.test(P));
t('한글 출력 금지 규칙이 실린다', /MUST NOT contain any Hangul/.test(P));
t('언어별 인명 표기 규칙이 실린다 (기존 규칙 재사용)', /Romanization/.test(P));
t('브랜드명은 그대로 두라고 한다', /Prada, Converse/.test(P));
t('lang 별로 프롬프트가 다르다', buildTitlePrompt([{ title_ko: KO, title_en: EN }], 'it') !== P);

console.log('\n=== ③ 응답 파싱 — 잡문이 섞여도 죽지 않는다 ===');
t('정상 JSON 배열을 읽는다',
  parseTitles('[{"i":0,"title":"Hola"}]').length === 1);
t('코드펜스·잡문이 앞뒤에 있어도 건져낸다',
  parseTitles('```json\n[{"i":0,"title":"Hola"}]\n```\n끝').length === 1);
t('깨진 JSON 은 빈 배열 (예외로 죽지 않는다)', parseTitles('{[nope').length === 0);
t('빈 제목·잘못된 i 는 버린다',
  parseTitles('[{"i":0,"title":"  "},{"i":"x","title":"Hola"},{"i":1,"title":"Ciao"}]').length === 1);
t('배열이 아니면 빈 배열', parseTitles('{"i":0}').length === 0);
t('null·빈 문자열에 죽지 않는다', parseTitles(null).length === 0 && parseTitles('').length === 0);

console.log('\n=== ④ 수용 판정 — 못 고쳤으면 옛것을 둔다 ===');
t('제대로 번역되면 통과',
  rejectReason("KATSEYE anticipa una transformación audaz con el sencillo 'ANIMAL'", row()) === null);
t('여전히 영어면 거부', rejectReason(EN, row()) === 'still_english');
t('한글이 섞이면 거부', rejectReason('KATSEYE 티저 공개', row()) === 'hangul');
t('빈 제목은 거부', rejectReason('   ', row()) === 'empty');
t('옛 제목과 똑같으면 거부', rejectReason(EN, row({ title: EN })) === 'still_english');
t('300자를 넘으면 거부', rejectReason('a'.repeat(301) + ' con el sencillo', row()) === 'too_long');

console.log('\n=== ⑤ 엔드포인트 — 안전 ===');
t('기본이 dry-run 이다 (apply 를 켜야 쓴다)',
  /const apply = req\.query\.apply === '1'/.test(apiSrc));
t('dry-run 일 때 update 를 호출하지 않는다',
  /if \(apply\) \{[\s\S]{0,200}\.update\(/.test(apiSrc));
t('관리자만 부를 수 있다', /requireAdmin\(req, res\)/.test(apiSrc));
t('seo_translations.title 만 UPDATE 한다', /\.update\(\{ title: clean, updated_at/.test(apiSrc));
t('발행 상태를 건드리지 않는다', !/status['"]?\s*:/.test(apiSrc) && !/'published'/.test(apiSrc));
t('삭제하지 않는다', !/\.delete\(/.test(apiSrc));
t('본문(content)을 건드리지 않는다', !/content['"]?\s*:/.test(apiSrc));
t('대상 판정은 needsRepair 한 곳만 쓴다 (규칙이 두 벌이면 한쪽만 고쳐진다)',
  /needsRepair\(row\)/.test(apiSrc) && (apiSrc.match(/isEnglishEcho/g) || []).length === 0);
t('Claude 호출은 백필과 같은 함수를 쓴다',
  /require\('\.\.\/_lib\/seoTranslateBackfill'\)/.test(apiSrc) && /callClaude/.test(apiSrc)
  && /callClaude,/.test(backfillSrc));
t('한 번에 보는 양에 상한이 있다 (사고로 전량 호출 방지)',
  /Math\.min\(200, parseInt\(req\.query\.limit/.test(apiSrc));
t('거부 사유를 응답에 담는다 (조용히 넘어가지 않는다)', /reject_reasons:/.test(apiSrc));
t('바뀐 예시를 보여준다 (눈으로 확인하고 결정할 수 있게)', /samples:/.test(apiSrc));
t('dry-run 이라고 응답이 분명히 말한다', /아무것도 저장하지 않았습니다/.test(apiSrc));

console.log('\n=== ⑥ 비용 — 본문을 다시 번역하지 않는다 ===');
t('lib 이 본문 필드를 아예 읽지 않는다',
  !/\bbody\b/.test(libSrc) && !/content_en/.test(libSrc));
t('엔드포인트가 기사 본문을 select 하지 않는다',
  !/select\('id, title, title_en, content/.test(apiSrc)
  && /select\('id, title, title_en'\)/.test(apiSrc));
t('max_tokens 를 작게 잡는다 (제목 한 줄짜리 응답)', /callClaude\(buildTitlePrompt\(items, lang\), 2000,/.test(apiSrc));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ title-repair tests FAILED'); process.exit(1); }
console.log('✅ title-repair tests passed');
