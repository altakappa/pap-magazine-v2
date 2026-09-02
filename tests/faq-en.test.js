/**
 * 영문판 FAQ (faq_en) — 가드 (2026-08-28)
 *
 * 무엇을 지키나:
 *   /en/ 페이지에는 FAQ 블록도 FAQPage 스키마도 **한 번도 뜬 적이 없었다.**
 *   백필이 밀린 게 아니라 경로가 없었다 — seoRenderer 의 삼항식이 en 을
 *   seo_translations(`tr`) 쪽으로 보냈는데 거기엔 en 행이 0개다.
 *   실측(2026-08-28): seo_translations.lang = de·es·fr·it·ja·ru·zh 뿐.
 *
 *   영어는 버릴 수 없는 표면이다 — geo-citation-surface 의 10일 실측에서
 *   인용 언어가 ko 42 / en 41 로 거의 동률이었다.
 *
 * 규칙의 품질(번역이 좋은가)은 기계로 못 잰다. 규칙이 코드에서 사라지지
 * 않게만 지킨다 — geo-citation-surface.test.js 와 같은 방침.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const renderer = rd('api/_lib/seoRenderer.js');
const lib = rd('api/_lib/faqEnBackfill.js');
const cron = rd('api/cron/backfill-faq.js');
const migration = rd('supabase_migrations/139_faq_en.sql');
const vercel = JSON.parse(rd('vercel.json'));

console.log('=== 렌더러 — en 은 faq_en 을 읽는다 ===');
t('en 분기가 실제로 존재한다',
  /lang === 'en'\) \? \(record\.faq_en \|\| null\)/.test(renderer));
t('ko 는 종전대로 record.faq', /\(lang === 'ko'\) \? record\.faq/.test(renderer));
t('나머지 언어는 종전대로 seo_translations',
  /\(\(tr && tr\.faq\) \|\| null\)/.test(renderer));
/* 재발 방지의 핵심 한 줄. en 을 tr 쪽으로 되돌리면 영문 FAQ 가 통째로 사라진다. */
t('en 을 tr 쪽으로 되돌리지 않는다',
  !/lang === 'ko'\) \? record\.faq : \(\(tr && tr\.faq\)/.test(renderer));
t('FAQPage 스키마는 같은 faqItems 를 쓴다 (블록만 있고 스키마 없는 상태 방지)',
  /faqSchema = faqItems\.length/.test(renderer)
  && /'@type': 'FAQPage'/.test(renderer));

console.log('\n=== 마이그레이션 ===');
t('두 표 모두 faq_en 추가',
  /alter table articles\s+add column if not exists faq_en jsonb/.test(migration)
  && /alter table editorials add column if not exists faq_en jsonb/.test(migration));
t('nullable — 기존 페이지 동작 불변', !/not null/i.test(migration));
t('되돌리기 방법이 적혀 있다', /drop column if exists faq_en/.test(migration));

console.log('\n=== 백필 라이브러리 ===');
t('두 표를 대상으로 한다',
  /table: 'articles'/.test(lib) && /table: 'editorials'/.test(lib));
t('원본 faq 보유 + faq_en 비어 있는 발행분만',
  /\.eq\('status', 'published'\)/.test(lib)
  && /\.not\('faq', 'is', null\)/.test(lib)
  && /\.is\('faq_en', null\)/.test(lib));
t('faq_en 만 UPDATE — 원본 faq·본문 미변경',
  /\.update\(\{ faq_en: en \}\)/.test(lib)
  && !/update\(\{[^}]*\bfaq:/.test(lib)
  && !/\.insert\(/.test(lib));
t('최신순 — 인용 가능성이 높은 쪽 먼저',
  /\.order\('published_date', \{ ascending: false \}\)/.test(lib));
t('항목 수 불일치는 버린다 (반쪽 FAQ 저장 금지)',
  /en\.length !== row\.faq\.length/.test(lib));
t('normalizeFaq 재사용 — 형태 규칙을 복제하지 않는다',
  /require\('\.\/seoTranslateBackfill'\)/.test(lib) && /normalizeFaq/.test(lib));
/* 2026-08-25 에 넷째 칸까지 붙인 jsonRepair 계단. 여기서 정규식을 새로 쓰면
   그 수리가 또 복제되고, 다음 고장 때 한쪽만 고쳐진다 (교훈 2). */
/* 파서가 세 벌이었다: jsonRepair(네 칸) · seoTranslateBackfill(세 칸, 번역 배치
   전용) · 이 파일들의 자체 정규식. 처음 통일할 때 하필 세 칸짜리를 골랐고,
   라이브에서 [형태불명] 으로 죽었다. 정본은 jsonRepair 다. */
t('JSON 파싱은 네 칸짜리 계단(jsonRepair)을 쓴다',
  /require\('\.\/jsonRepair'\)/.test(lib) && /parseJsonArray\(rawText, table\)/.test(lib));
t('세 칸짜리(seoTranslateBackfill.parseJsonArray)로 되돌아가지 않는다',
  !/parseJsonArray[^;]*require\('\.\/seoTranslateBackfill'\)/.test(lib)
  && !/normalizeFaq, callClaude, parseJsonArray/.test(lib));
t('자체 JSON 파서를 만들지 않는다', !/text\.match\(\/\\\[\[/.test(lib));

/* 실제로 죽었던 응답 모양을 **돌려서** 검사한다. 정규식으로 코드를 훑는 것보다
   강하다 — 라이브 로그(stop_reason=end_turn, [형태불명])에서 채집한 모양이다. */
{
  const JR = require('../api/_lib/jsonRepair.js');
  const body = '{"i":0,"faq":[{"q":"Q1","a":"A1"}]}';
  const shapes = [
    ['펜스만', '```json\n[' + body + ']\n```'],
    ['배열 두 개 (모델이 두 번 답함)',
      '```json\n[' + body + ']\n```\n```json\n[' + body + ']\n```'],
    ['뒤 산문에 대괄호 (lastIndexOf 가 헛짚는 모양)',
      '```json\n[' + body + ']\n```\nNote: items [1] and [2] kept brand names.'],
  ];
  for (const [name, raw] of shapes) {
    let ok = false;
    try { ok = Array.isArray(JR.parseJsonArray(raw, 't').value); } catch (_) { ok = false; }
    t('파싱 성공: ' + name, ok);
  }
}
t('callClaude 반환 객체에서 .text 를 꺼낸다',
  /callClaude\(/.test(lib) && /\(raw && raw\.text\)/.test(lib));
t('String(raw) 오용을 하지 않는다', !/String\(raw \|\| ''\)/.test(lib));
t('env 손잡이로 범위를 자를 수 있다 (기본 무제한)',
  /FAQ_EN_RECENT/.test(lib) && /\|\| '0'/.test(lib));
/* 켜지 않은 기능이 매 회차 DB 를 때리면 안 된다. */
t('무제한이면 컷오프 질의를 아예 하지 않는다',
  /if \(!n\) return null;/.test(lib));
t('API 키 없으면 503 으로 멈춘다 (조용한 0건 금지)',
  /ANTHROPIC_API_KEY/.test(lib) && /statusCode = 503/.test(lib));
t('한 표 실패가 나머지를 막지 않는다',
  /catch \(err\)[\s\S]{0,200}per\.push\(target\.label \+ ':실패'\)/.test(lib));

console.log('\n=== 크론 배선 (별도 크론 아님 — 호출 예산) ===');
/* 별도 크론을 등록하면 vercel-cost-guard 의 하루 총 호출 상한을 넘긴다.
   같은 호출 안에서 이어 돌면 호출 수 증가가 0이다. */
t('기사 FAQ 크론이 영문판을 이어서 돈다', /runFaqEnBatch/.test(cron));
t('별도 크론을 등록하지 않는다 (호출 예산 보호)',
  !(vercel.crons || []).some(c => /faq-en/.test(c.path)));
t('시간 예산을 나눈다 — 원본 먼저, 남으면 영문판',
  /timeoutMs: 55000/.test(cron) && /left > 25000/.test(cron));
t('영문판 실패가 원본 결과를 덮지 않는다',
  /\.\.\.out, en/.test(cron) && /console\.error\('\[backfill-faq\/en\]'/.test(cron));
/* note 가 없으면 '돌았다 ≠ 했다' 를 또 못 본다 (교훈 1 · 2026-08-04). */
t('cron_runs.note 에 영문판 생산량이 남는다',
  /en && en\.note/.test(cron) && /'영문FAQ '/.test(lib));
/* 계단이 실제로 일했는지 보이게 한다 — 'block' 이 찍히면 넷째 칸이 살린 것이다.
   안 보이면 계단이 놀고 있는지 죽어 있는지 구분이 안 된다. */
t('note 가 어느 칸으로 살렸는지 남긴다', /r\.repaired !== 'none'/.test(lib));
/* 원래 교훈(2026-08-08): **머리만** 찍으면 종류를 못 가른다. 머리는 대개
   '```json\n[{"i":0,' 이라 정보가 없고, trailing comma·두 번째 배열·뒤에 붙은
   산문은 전부 끝에서만 보인다. 87% 실패를 보고도 원인을 못 갈랐던 이유다.

   2026-09-02 갱신 — 교훈은 "꼬리를 반드시 남겨라" 이지 "머리를 남기지 마라" 가
   아니다. 이번 진단에서 걸린 게 정확히 그 차이였다: 응답에 바깥 `]` 가 없다는
   것까지는 꼬리로 알았는데, **모델이 앞에 뭘 붙였는지는 꼬리로 못 본다.**
   그래서 머리를 더한다. 꼬리를 **빼는 것**만 계속 막는다. */
t('파싱 실패 로그에 꼬리가 반드시 있다 (꼬리만으로 보이는 흠이 있다)',
  /\| tail=/.test(lib));
t('머리도 함께 남긴다 (앞에 붙은 산문·감싼 객체는 머리로만 보인다)',
  /\| head=/.test(lib));
t('머리만 남기고 꼬리를 빼지 않았다  ← 2026-08-08 교훈의 본체',
  !(/\| head=/.test(lib) && !/\| tail=/.test(lib)));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ faq-en tests passed');
