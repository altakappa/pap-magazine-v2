/**
 * 화보 FAQ 백필 — 소스 계약 테스트 (2026-08-27 신설, 확장전략55 Ⅰ-3 잔여·Ⅰ-12 통합)
 *
 * 검증 대상:
 *  1. lib 이 존재하고 기사 쪽 공용 함수(parseFaqResponse 등)를 재사용한다
 *  2. 프롬프트에 "사실만" 규칙이 있다 (없는 인명·브랜드 생성 금지)
 *  3. editorials.faq 만 갱신하고 설명문·본문은 건드리지 않는다
 *  4. 크론 엔드포인트가 CRON_SECRET/관리자 이중 인증 + cronNote 규약을 지킨다
 *  5. vercel.json 에 크론이 등록되어 있다
 *  6. SSR 렌더러는 record.faq 를 kind 무관하게 읽는다 (화보 SSR 자동 작동의 근거)
 *  7. creditLine/selectWorkable 순수 함수 동작
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
const lib = fs.readFileSync(path.join(root, 'api/_lib/editorialFaqBackfill.js'), 'utf8');
const cron = fs.readFileSync(path.join(root, 'api/cron/backfill-editorial-faq.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'api/_lib/seoRenderer.js'), 'utf8');

console.log('=== 화보 FAQ 백필 ===');

t('공용 함수 재사용 (faqBackfill 에서 import)',
  /require\('\.\/faqBackfill'\)/.test(lib) && /parseFaqResponse/.test(lib) && /normalizeBatch/.test(lib));
t('프롬프트에 사실만 규칙', /입력에 있는 사실만/.test(lib) && /추측해 채우지 않는다/.test(lib));
t('답변 자기완결 규칙 (20~60단어·문맥 없이 인용 가능)', /20~60단어/.test(lib) && /완결된 문장/.test(lib));
t('editorials.faq 만 갱신 (설명문 UPDATE 없음)',
  /from\('editorials'\)\.update\(\{ faq \}\)/.test(lib)
  && !/update\(\{[^}]*description/.test(lib));
t('발행 화보만 대상 + faq null 만', /eq\('status', 'published'\)/.test(lib) && /\.is\('faq', null\)/.test(lib));
t('거른 뒤 자르기 (짧은 설명문이 앞을 막지 않는다)',
  /MAX_SCAN_PAGES/.test(lib) && /selectWorkable/.test(lib));

t('크론 이중 인증 (CRON_SECRET 또는 관리자)', /CRON_SECRET/.test(cron) && /requireAdmin/.test(cron));
t('크론 cronNote 규약 (생산량 한 줄 기록)', /cronNote/.test(cron) && /withCronGuard\('backfill-editorial-faq'/.test(cron));
t('vercel.json 크론 등록 (10분 간격)',
  /"\/api\/cron\/backfill-editorial-faq"/.test(vercel));

t('SSR 렌더러가 record.faq 를 kind 무관하게 읽는다 (화보 자동 렌더 근거)',
  /record\.faq/.test(renderer) && /FAQPage/.test(renderer));

// 순수 함수 동작 — require 는 supabase env 를 요구하므로 소스에서 추출해 실행한다
function extract(name) {
  const m = lib.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}'));
  if (!m) throw new Error(name + ' not found in source');
  return m[0];
}
const MIN_DESC_CHARS = parseInt((lib.match(/MIN_DESC_CHARS = (\d+)/) || [])[1], 10);
const toPlain = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sandbox = new Function('toPlain', 'MIN_DESC_CHARS',
  extract('creditLine') + '\n' + extract('brandLine') + '\n' + extract('selectWorkable')
  + '\nreturn { creditLine, brandLine, selectWorkable };');
const { creditLine, brandLine, selectWorkable } = sandbox(toPlain, MIN_DESC_CHARS);
const cl = creditLine([
  { name: 'A', roles: ['Photographer'] },
  { name: 'B', roles: ['Starring'] },
  { name: 'C', roles: ['starring'] },
]);
t('creditLine 이 역할별로 합친다', /Photographer: A/.test(cl) && /Starring: B, C/.test(cl), cl);
t('brandLine', brandLine({ brands: [{ name: 'X' }, { name: 'Y' }] }) === 'Brands: X, Y');
const picked = selectWorkable([
  { title: 't1', description: 'x'.repeat(MIN_DESC_CHARS) },
  { title: 't2', description: 'short' },
  { title: 't3', description: '', description_en: 'y'.repeat(MIN_DESC_CHARS + 5) },
], 10);
t('selectWorkable — 설명문 기준 필터 (en 폴백 포함)', picked.rows.length === 2 && picked.tooThin === 1);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ editorial-faq-backfill tests passed');
