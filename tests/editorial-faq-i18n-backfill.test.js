/**
 * 화보 FAQ 언어판 소급 백필 — 가드 (2026-08-27)
 * 도메니코 판정: 소급은 "최근분만". 설명문은 건드리지 않는다.
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
const lib = rd('api/_lib/editorialFaqI18nBackfill.js');
const cron = rd('api/cron/backfill-editorial-faq.js');
const vercel = JSON.parse(rd('vercel.json'));

console.log('=== 화보 FAQ 언어판 소급 ===');
t('FAQ 만 UPDATE — 설명문·제목 미변경',
  /\.update\(\{ faq: trFaq, updated_at/.test(lib)
  && !/description:/.test(lib) && !/title:/.test(lib));
t('번역행이 이미 있는 것만 (새 행 insert 금지)',
  !/\.insert\(/.test(lib) && !/\.upsert\(/.test(lib) && /\.update\(/.test(lib));
t('원본 FAQ 보유 화보만 대상', /\.not\('faq', 'is', null\)/.test(lib));
t('최근분 제한 (도메니코 판정) + env 손잡이',
  /EDITORIAL_FAQ_I18N_RECENT/.test(lib) && /\|\| '300'/.test(lib));
t('항목 수 불일치는 버린다 (반쪽 FAQ 저장 금지)',
  /trFaq\.length !== \(srcMap\.get\(id\) \|\| \[\]\)\.length/.test(lib));
t('normalizeFaq 로 형태 검증 (본 백필과 같은 함수 재사용)',
  /require\('\.\/seoTranslateBackfill'\)/.test(lib) && /normalizeFaq/.test(lib));
/* 2026-08-28 — 'en' 을 뺐다. 이 백필은 **기존 번역행 UPDATE 만** 하는데
   seo_translations 에 en 행은 0개다(실측 de·es·fr·it·ja·ru·zh 뿐). 매 회차
   조회 0건으로 조용히 넘어가느라 죽은 항목인 줄도 안 보였다.
   영문판은 faq_en 칼럼 + faqEnBackfill.js 가 맡는다. */
t('7개 언어 대상 (ko 원본·en 칼럼 제외)',
  /TARGET_LANGS = \['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'\]/.test(lib));
t("en 을 이 백필에 되돌려 넣지 않는다 (기존 행만 UPDATE 하므로 영원히 0건)",
  !/TARGET_LANGS = \[[^\]]*'en'/.test(lib));

/* 2026-08-27~28 · 24시간 무생산의 원인. callClaude 는 문자열이 아니라
   {text, stopReason} 객체를 돌려준다. String(raw) 는 "[object Object]" 가
   되어 JSON 파싱이 반드시 실패하고, 매 회차 조용히 processed:0 이 된다.
   cron_runs 실측: '화보FAQ 언어판 0 · 잔여 600 · it:0 fr:0' 이 24시간 반복. */
t('callClaude 반환은 객체다 — .text 를 꺼내 쓴다',
  /String\(\(raw && raw\.text\) \|\| ''\)/.test(lib));
t('String(raw) 로 되돌아가지 않는다 (무생산 재발 방지)',
  !/String\(raw \|\| ''\)/.test(lib));
/* 20초 문턱으로는 콜을 시작만 하고 타임아웃으로 죽었다 (07:04 'es' 실측).
   끝낼 수 없는 콜은 시작하지 않는다 — 돈만 쓰고 데이터가 0이 된다. */
t('시간 예산 — 한 콜을 끝낼 여유(35초)가 없으면 접는다', /deadline - 35000/.test(lib));
/* 파서가 두 벌이면 한쪽만 고쳐진다 (교훈 2). 2026-08-25 의 jsonRepair 넷째 칸이
   parseJsonArray 에만 들어가고 이 파일의 자체 정규식은 옛날 그대로였다. */
/* 파서가 세 벌이었다. 8/25 의 넷째 칸(덩어리 고르기)은 jsonRepair 에만 있고,
   seoTranslateBackfill 의 동명 함수는 세 칸짜리 번역 배치 전용이다.
   처음 통일할 때 세 칸짜리를 골랐고 라이브에서 [형태불명] 으로 죽었다. */
t('JSON 파싱은 네 칸짜리 계단(jsonRepair)을 쓴다',
  /require\('\.\/jsonRepair'\)/.test(lib) && /parseJsonArray\(text, 'faq-i18n\/'/.test(lib));
t('세 칸짜리로 되돌아가지 않는다',
  !/normalizeFaq, callClaude, LANG_NAMES, parseJsonArray/.test(lib));
t('자체 JSON 파서를 다시 만들지 않는다',
  !/text\.match\(\/\\\[\[/.test(lib) && !/JSON\.parse\(text\)/.test(lib));
/* 실패 경로가 조용하면 왜 0인지 영영 모른다 — 실제로 그래서 한 회차를 날렸다. */
/* 머리는 언제나 '```json\n[{"i":0,' 이라 종류를 못 가른다. 꼬리에만 정보가 있다. */
t('파싱 실패 시 stop_reason 과 응답 **꼬리**를 남긴다',
  /stop_reason=/.test(lib) && /tail=/.test(lib) && !/\| head=/.test(lib));
t('한 언어 실패가 나머지를 막지 않는다', /catch \(err\)[\s\S]{0,120}per\.push\(lang \+ ':실패'\)/.test(lib));

console.log('\n=== 크론 배선 (별도 크론 아님 — 호출 예산) ===');
/* 별도 크론을 등록하면 vercel-cost-guard 의 하루 총 호출 상한(2,600)을 넘긴다.
   그래서 원본 생성 크론이 같은 호출 안에서 이어 돈다 — 호출 수 증가 0. */
t('원본 크론이 언어판을 이어서 돈다', /runEditorialFaqI18nBatch/.test(cron));
t('별도 크론을 등록하지 않는다 (호출 예산 보호)',
  !(vercel.crons || []).some(c => c.path.includes('faq-i18n')));
t('시간 예산을 나눈다 — 원본 먼저, 남으면 언어판',
  /timeoutMs: 55000/.test(cron) && /left > 25000/.test(cron));
t('언어판 실패가 원본 결과를 덮지 않는다',
  /catch \(e2\)/.test(cron) && /\.\.\.out, i18n/.test(cron));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ editorial-faq-i18n-backfill tests passed');
