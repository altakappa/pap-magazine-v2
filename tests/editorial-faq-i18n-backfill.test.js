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
t('8개 언어 대상 (ko 제외)',
  /TARGET_LANGS = \['en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'\]/.test(lib));
t('시간 예산 — 콜 여유 없으면 접는다', /deadline - 20000/.test(lib));
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
