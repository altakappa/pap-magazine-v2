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
const { hasHangul, hangulRatio, validateTranslation, nameRule, styleRules, buildBatchPrompt, KINDS } = H;

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
  /if \(bad\) \{ qualityRetried\+\+; continue; \}/.test(src));
t('재시도 후에도 실패하면 저장은 한다 (영구 차단 금지)',
  /if \(validateTranslation\(one, lang\)\) qualityFlagged\+\+;[\s\S]{0,60}got\.set\(it\.id, one\)/.test(src));
t('결과에 quality_retried / quality_flagged 를 보고한다',
  /quality_retried:/.test(src) && /quality_flagged:/.test(src));

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

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ translate-name-quality tests passed');
