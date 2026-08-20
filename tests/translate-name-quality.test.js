/**
 * 번역 표기 품질 가드 (2026-08-06 신설).
 *
 * ── 실측 사고 ────────────────────────────────────────────────────────
 * seo_translations 8,030건 전수 검사에서 두 종류의 결함이 나왔다.
 *
 * ① 한글이 그대로 남은 제목 **356건 (4.4%)**
 *      zh 60/511 (11.7%) · ja 91/1,335 (6.8%) · fr 63 · it 55 · es 51 · ru 28 · de 8
 *    실물: ja 제목 `척추를 따라 세운 드레イ프`
 *          — '이' 한 글자만 `イ` 로 바뀌고 나머지는 한글 그대로다.
 *
 * ② 한국 인명을 억지 한자로 음차 — 한글 검사로는 안 잡힌다.
 *    실물: ja 제목 `変愚錫が手にしたパープルリップバームの正体`
 *          변우석의 일본 매체 표기는 `ピョン・ウソク`. `変愚錫` 는
 *          '愚'(어리석을 우)가 들어가 무례하게 읽힌다. 셀럽 이름 오역은
 *          브랜드 사고다.
 *
 * ── 원인 ─────────────────────────────────────────────────────────────
 * 프롬프트가 이렇게 지시하고 있었다:
 *     "Keep proper nouns, brand names, and stylized titles unchanged"
 * 한국어 제목 전체가 '고유명사' 로 읽히면 모델은 그대로 둔다(①).
 * 그리고 현지 표준 표기를 쓰라는 지시가 없으니 소리대로 한자를 만든다(②).
 *
 * ── 이 테스트가 지키는 것 ────────────────────────────────────────────
 *   ① 프롬프트에 '한글 출력 금지' 와 언어별 인명 표기 규칙이 실릴 것
 *   ② 배치·단건 프롬프트가 **같은** 규칙을 쓸 것 (한쪽만 고치는 사고 방지)
 *   ③ hasHangul / hangulRatio / validateTranslation 이 실제 사고 사례를 잡을 것
 *   ④ 본문의 소량 한글 인용은 통과시킬 것 (오탐이 poison pill 을 만든다)
 *   ⑤ 검증 실패가 '영구 거부' 가 아니라 '재시도 후 통과' 로 설계될 것
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const CRON = path.join(ROOT, 'api', 'cron', 'backfill-translations.js');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* supabase 를 스텁으로 갈아끼워 helper 를 순수하게 불러온다. */
const m = new Module(SUPABASE, null);
m.filename = SUPABASE; m.loaded = true;
m.exports = { supabaseAdmin: { from() { throw new Error('no db in test'); }, rpc() { throw new Error('no rpc'); } } };
require.cache[SUPABASE] = m;

const H = require(HELPER);
const { hasHangul, hangulRatio, validateTranslation, nameRule, styleRules, buildBatchPrompt, KINDS, TITLE_MAX, TITLE_HARD } = H;

/* ── ③ 실제 사고 사례를 잡는가 ─────────────────────────────────────── */
console.log('\n=== ③ 실제 사고 사례 (DB 실물) ===');

t('한글 제목을 잡는다 — `척추를 따라 세운 드레イ프`',
  validateTranslation({ title: '척추를 따라 세운 드レイプ'.replace('レイプ', 'レイ프') }, 'ja') === 'hangul_title');

t('한 글자만 남아도 잡는다',
  validateTranslation({ title: 'コンバースの新たなアイコン、카리나と共に' }, 'ja') === 'hangul_title');

t('정상 일본어 제목은 통과',
  validateTranslation({ title: 'コンバースの新たなアイコン、KARINAと共に', body: '<p>ストリートカルチャー</p>' }, 'ja') === null);

t('정상 독일어 제목은 통과',
  validateTranslation({ title: 'Converse enthüllt seine neue Ikone mit KARINA' }, 'de') === null);

t('제목이 없으면 잡는다', validateTranslation({ body: 'x' }, 'it') === 'no_title');
t('null 도 잡는다', validateTranslation(null, 'it') === 'no_title');

/* ── ④ 오탐이 없어야 한다 (poison pill 방지) ───────────────────────── */
console.log('\n=== ④ 오탐 방지 — 본문의 소량 한글 인용은 통과 ===');

const longIt = '<p>' + 'Clara Cipriano presenta drappeggi scultorei che seguono la colonna vertebrale. '.repeat(6) + '</p>';
t('본문에 한국어 곡명 한 개 병기 → 통과',
  validateTranslation({ title: 'Un drappeggio lungo la spina dorsale', body: longIt + '<p>(원제: 척추)</p>' }, 'it') === null);

t('본문 전체가 한글이면 잡는다',
  validateTranslation({ title: 'Titolo Italiano', body: '<p>척추를 따라 세운 드레이프. 파리에서 활동하는 디자이너.</p>' }, 'it') === 'hangul_body');

t('HTML 속성 안의 한글은 세지 않는다 (태그 제거 후 판정)',
  hangulRatio('<img alt="한국 디자이너 인터뷰 사진 원본 캡션" src="/a.jpg"><p>' + 'Testo italiano. '.repeat(10) + '</p>') === 0);

t('URL 안의 문자열도 세지 않는다',
  hangulRatio('<p>Vedi https://ex.com/a?q=x ' + 'testo '.repeat(20) + '</p>') === 0);

t('빈 문자열은 0', hangulRatio('') === 0 && hangulRatio(null) === 0);
t('hasHangul 은 자모도 잡는다', hasHangul('ᄀ') && hasHangul('가') && !hasHangul('カ') && !hasHangul('邊'));

t('ko 는 검증 대상이 아니다 (원본 언어)',
  validateTranslation({ title: '척추를 따라 세운 드레이프' }, 'ko') === null);

/* ── ① 프롬프트에 규칙이 실리는가 ──────────────────────────────────── */
console.log('\n=== ① 언어별 인명 표기 규칙 ===');

t('ja 규칙은 가타카나를 요구하고 한자 음차를 금지한다',
  /KATAKANA/i.test(nameRule('ja')) && /変愚錫/.test(nameRule('ja')) && /ピョン・ウソク/.test(nameRule('ja')));
t('zh 규칙은 통용 한자 표기를 요구한다',
  /Chinese rendering/i.test(nameRule('zh')) && /邊佑錫|边佑锡/.test(nameRule('zh')));
t('ru 규칙은 키릴 전사를 요구한다', /Cyrillic/i.test(nameRule('ru')));
t('라틴어권 규칙은 로마자 표기를 요구한다',
  /Romanization/i.test(nameRule('it')) && /Romanization/i.test(nameRule('fr'))
  && /Romanization/i.test(nameRule('es')) && /Romanization/i.test(nameRule('de')));

for (const l of ['it', 'fr', 'es', 'ja', 'zh', 'ru', 'de']) {
  const r = styleRules(l);
  t(`${l}: '한글 출력 금지' 가 들어 있다`, /MUST NOT contain any Hangul/i.test(r), r.slice(0, 80));
  t(`${l}: '한국어 제목은 보존 대상이 아니다' 가 들어 있다`,
    /Korean title is NOT a proper noun/i.test(r));
}

/* ── ② 배치와 단건이 같은 규칙을 쓰는가 ────────────────────────────── */
console.log('\n=== ② 배치·단건 프롬프트가 같은 규칙을 쓴다 ===');

const artItems = [{ id: 'a', title: '변우석이 손에 든 퍼플 립밤', content_en: '<p>Body text here.</p>' }];
const ediItems = [{ id: 'e', title: '척추를 따라 세운 드레이프', description_en: 'A sculptural drape.' }];

for (const l of ['ja', 'zh', 'it']) {
  const pa = buildBatchPrompt(artItems, KINDS.article, l);
  const pe = buildBatchPrompt(ediItems, KINDS.editorial, l);
  t(`${l} 아티클 배치 프롬프트에 규칙이 실린다`, pa.includes(styleRules(l)));
  t(`${l} 에디토리얼 배치 프롬프트에 규칙이 실린다`, pe.includes(styleRules(l)));
  t(`${l} 아티클 프롬프트에 옛 규칙(Keep proper nouns ... unchanged)이 남아 있지 않다`,
    !/Keep proper nouns, brand names, and stylized titles unchanged/.test(pa));
}

const src = fs.readFileSync(HELPER, 'utf8');
t('단건 재시도(translateOne)도 같은 styleRules 를 쓴다',
  /translateOne[\s\S]{0,900}styleRules\(lang\)/.test(src));
/* 옛 문구는 '주석에는 남아 있어도 된다'(왜 바꿨는지의 기록이다).
   프롬프트 문자열로 다시 살아나는 것만 막는다 — 백틱이 있는 줄에 있으면 실패. */
t('옛 문구가 프롬프트 문자열로 되살아나지 않았다',
  !src.split('\n').some(l => l.includes('`') && /Keep proper nouns/.test(l)),
  src.split('\n').filter(l => l.includes('`') && /Keep proper nouns/.test(l)));

/* ── ⑤ 실패 처리 설계 — 거부가 아니라 재시도 후 통과 ───────────────── */
console.log('\n=== ⑤ poison pill 방지 설계 ===');

t('배치에서 걸린 건은 재시도로 넘긴다 (qualityRetried)',
  /if \(bad\) \{ qualityRetried\+\+;[^}]*continue; \}/.test(src));
t('재시도 후에도 실패하면 저장은 한다 (영구 차단 금지)',
  /if \(validateTranslation\(one, lang[\s\S]{0,60}?\) qualityFlagged\+\+;[\s\S]{0,60}got\.set\(it\.id, one\)/.test(src));
t('결과에 quality_retried / quality_flagged 를 보고한다',
  /quality_retried:/.test(src) && /quality_flagged:/.test(src));

/* 2026-08-08 — 위 원칙("재시도 후에도 못 지키면 그래도 저장")에 구멍이 있었다.
   **재시도 자체를 못 하는 경우**를 안 다뤄서, 시간이 없으면 검증에 걸린 건이
   통째로 버려졌다. ru 가 그 구멍에 빠져 7시간(잔여 706건) 저장 0건이었다 —
   웨이브 순서상 늘 마지막이라 재시도할 시간이 남지 않는다. */
t('검증에 걸린 번역을 버리지 않고 쥐고 있는다 (rejected)',
  /const rejected = new Map\(\);/.test(src)
  && /if \(bad\) \{ qualityRetried\+\+; rejected\.set\(srcItem\.id, t\); continue; \}/.test(src));
t('재시도할 시간이 없으면 쥐고 있던 것을 저장한다',
  /if \(!canCall\(deadlineAt, timeoutMs\)\) \{[\s\S]{0,400}rejected\.get\(rest\.id\)[\s\S]{0,120}got\.set\(rest\.id, held\)/.test(src));
t('그렇게 저장한 건도 flagged 로 센다 (눈에 보이게)',
  /if \(held\) \{ qualityFlagged\+\+; got\.set\(rest\.id, held\); \}/.test(src));
t('시간 부족은 여전히 ranOut 으로 보고한다',
  /if \(!canCall\(deadlineAt, timeoutMs\)\) \{\s*\n\s*ranOut = true;/.test(src));

const cronSrc = fs.readFileSync(CRON, 'utf8');
t('크론 note 에 품질 건수를 남긴다', /'\/품질' \+ v\.flagged/.test(cronSrc));
t('크론이 quality_flagged 를 합산한다', /r\.quality_flagged/.test(cronSrc));
/* 2026-08-08 — flagged(저장까지 간 것)만으로는 '검증이 막고 있다' 를 못 본다.
   ru 가 7시간 0건인데 예외도 ERR 도 없었고, retried 를 안 남겨서 가설을
   증명할 수 없었다. 저장 0 + 재시도 N 이 보이면 원인이 한 번에 갈린다. */
t('크론이 quality_retried 도 합산한다', /r\.quality_retried/.test(cronSrc));
t('크론 note 에 재시도 건수를 남긴다', /'\/재시도' \+ v\.retried/.test(cronSrc));

/* 본문 임계값이 근거대로인지 (실측 0.4% → 3% 는 넉넉한 선) */
t('본문 한글 임계값은 3%', /const BODY_HANGUL_MAX = 0\.03;/.test(src));


/* ── ⑥ 라틴 문자 언어에 영어가 그대로 저장되는 것 (2026-08-16 신설) ──────
 *
 * 실측(seo_translations 전수 · title 이 articles.title_en 과 완전 동일):
 *     es 653/2,372 (27.5%) · it 603/2,370 (25.4%) · fr 510/2,370 (21.5%)
 *     de 139/2,369 (5.9%)  · ja 0 · zh 0 · ru 0
 * ja/zh/ru 이 0 인 게 원인을 말해준다 — 문자가 다르면 베낄 수 없었다.
 * es/it/fr/de 는 영어와 같은 알파벳이라 어떤 검사에도 안 걸렸다.
 *
 * 실물: /es/article/katseye-animal-teaser-bold-transformation 의 <title> 이
 *       "KATSEYE Teases Bold Transformation with 'ANIMAL' Single" (영어),
 *       설명만 스페인어였다.
 */
console.log('\n=== ⑥ 영어 에코 (라틴 문자 언어) ===');

const { isEnglishEcho } = H;
const EN = "KATSEYE Teases Bold Transformation with 'ANIMAL' Single";

t('es: 영어 원문을 그대로 뱉으면 잡는다',
  validateTranslation({ title: EN }, 'es', EN) === 'english_title');
t('it / fr / de 도 같이 잡는다',
  validateTranslation({ title: EN }, 'it', EN) === 'english_title'
  && validateTranslation({ title: EN }, 'fr', EN) === 'english_title'
  && validateTranslation({ title: EN }, 'de', EN) === 'english_title');

t('제대로 번역된 스페인어 제목은 통과',
  validateTranslation({ title: "KATSEYE anticipa una transformación audaz con el sencillo 'ANIMAL'" }, 'es', EN) === null);
t('제대로 번역된 이탈리아어 제목은 통과',
  validateTranslation({ title: "KATSEYE annuncia una trasformazione audace con il singolo 'ANIMAL'" }, 'it', EN) === null);

t('ja / zh / ru 은 이 검사를 적용하지 않는다 (문자가 달라 애초에 불가능)',
  !isEnglishEcho(EN, EN, 'ja') && !isEnglishEcho(EN, EN, 'zh') && !isEnglishEcho(EN, EN, 'ru'));

/* 오탐 방지 — 여기서 틀리면 멀쩡한 번역이 큐를 막는다(poison pill). */
t('브랜드명뿐인 제목은 그대로가 정답이다 — 잡지 않는다',
  !isEnglishEcho('CRIMSON', 'CRIMSON', 'es')
  && !isEnglishEcho('Comme des Garçons', 'Comme des Garçons', 'fr'));
t("스페인어의 'de'·'a', 이탈리아어의 'in', 프랑스어의 'on' 을 영어로 오인하지 않는다",
  !EN_MARKERS_LEAK(['de', 'a', 'in', 'on', 'da', 'la', 'el', 'un']));
function EN_MARKERS_LEAK(words) {
  // 각 단어만으로 된 '같은 제목' 이 영어 에코로 잡히면 오탐이다
  return words.some(w => isEnglishEcho(w, w, 'es') || isEnglishEcho(w, w, 'it') || isEnglishEcho(w, w, 'fr'));
}
t('원본 영어 제목을 모르면(null) 아무것도 잡지 않는다 — 옛 호출과 호환',
  validateTranslation({ title: EN }, 'es') === null
  && validateTranslation({ title: EN }, 'es', null) === null);
t('영어와 다르면 통과 (한 글자만 달라도)',
  isEnglishEcho(EN, EN + '.', 'es') === false);

/* 프롬프트 쪽 — 애초에 영어를 뱉지 않게 지시하는가 */
console.log('\n=== ⑥b 프롬프트가 title_en 을 참고용이라고 못박는가 ===');
for (const l of ['es', 'it', 'fr', 'de']) {
  const r = styleRules(l);
  t(`${l}: title_en 이 참고용이라고 말한다`, /title_en[\s\S]{0,80}REFERENCE ONLY/i.test(r), r.slice(-200));
  t(`${l}: 영어 문장 그대로 반환은 실패라고 말한다`, /Returning the English sentence unchanged is a failure/i.test(r));
}
for (const l of ['ja', 'zh', 'ru', 'ko']) {
  t(`${l}: 이 지시는 붙이지 않는다 (문자가 달라 불필요 — 토큰 낭비)`,
    !/REFERENCE ONLY/i.test(styleRules(l)));
}

/* 호출부가 원본 영어 제목을 실제로 넘기는가 — 안 넘기면 가드가 죽은 코드다 */
t('배치 검증이 원본 영어 제목을 넘긴다',
  /validateTranslation\(t, lang, \(cfg\.src\(srcItem\) \|\| \{\}\)\.title_en\)/.test(src));
t('단건 재시도 검증도 원본 영어 제목을 넘긴다',
  /validateTranslation\(one, lang, \(cfg\.src\(it\) \|\| \{\}\)\.title_en\)/.test(src));


/* ── ⑦ 제목 길이 상한 (2026-08-20) ─────────────────────────────
   구글 SERP 는 약 600px 에서 제목을 자른다. 실측(2026-08-20, seo_translations 전수):
   60자 초과가 de 1,345 · es 1,348 · fr 1,387 · it 1,284 · ru 1,170,
   최장 133자(독일어). 중앙값은 29~35자로 멀쩡하니 문제는 꼬리다.
   여기서 지키는 것: ① 프롬프트가 언어별 상한을 실제 숫자로 말하는가
   ② 명백히 깨진 길이는 검증이 잡아 재시도로 보내는가
   ③ 살짝 넘긴 것은 잡지 않는가(호출 낭비 방지) */
console.log('\n=== ⑦ 제목 길이 상한 ===');

t('라틴 4개 언어 상한이 60자다',
  ['es', 'it', 'fr', 'de'].every((l) => TITLE_MAX[l] === 60));
t('키릴(ru)은 60보다 짧다 — 같은 글자 수라도 더 넓다', TITLE_HARD('ru') < TITLE_HARD('de'));
t('전각(ja·zh)은 라틴의 절반 수준이다',
  TITLE_MAX.ja <= 40 && TITLE_MAX.zh <= 32 && TITLE_MAX.zh < TITLE_MAX.ja);

for (const l of ['es', 'it', 'fr', 'de', 'ru', 'ja', 'zh']) {
  const r = styleRules(l);
  t(l + ': 프롬프트가 상한을 숫자로 말한다',
    new RegExp('at most ' + TITLE_MAX[l] + ' characters').test(r), r.slice(0, 160));
}
t('프롬프트가 짧은 제목을 늘리라고 하지 않는다 (반대 사고 방지)',
  /Never pad a short title/i.test(styleRules('de')));

/* 검증: 문턱은 상한의 1.35배. 실제 사고 사례로 잰다. */
const LONG_DE = 'Mithridate präsentiert die Frühjahr/Sommer 2025 Kollektion – eine Neuinterpretation der Kultur ethnischer Minderheiten aus Yunnan';
t('실제 사고 사례(독일어 130자)를 잡는다',
  validateTranslation({ title: LONG_DE }, 'de') === 'long_title', String(LONG_DE.length));
t('상한을 살짝 넘긴 65자는 잡지 않는다 (재시도 낭비 금지)',
  validateTranslation({ title: 'x'.repeat(65) }, 'de') === null);
t('상한 이하 40자는 당연히 통과한다',
  validateTranslation({ title: 'Converse enthüllt seine neue Ikone' }, 'de') === null);
t('한국어(ko)는 길이 검사 대상이 아니다 — 원본이다',
  validateTranslation({ title: '가'.repeat(200) }, 'ko') === null);
t('길이 검사가 한글 검사를 밀어내지 않는다 (한글이 먼저다)',
  validateTranslation({ title: '한글'.repeat(80) }, 'de') === 'hangul_title');

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ translate-name-quality tests passed');
