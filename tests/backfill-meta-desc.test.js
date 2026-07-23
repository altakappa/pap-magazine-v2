/**
 * 메타 설명 AI 백필 크론 회귀 (2026-07-23, Ahrefs too short 격상).
 * 검증된 비전 생성기로 짧은 에디토리얼의 설명·seo_description 을 채운다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const c = R('api/cron/backfill-meta-desc.js');
const vj = JSON.parse(R('vercel.json'));

let pass = 0, fail = 0;
function t(n, cond, d){ if(cond){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 메타 설명 백필 크론 ===');
t('크론 인증 규약(CRON_SECRET + admin 폴백)',
  /CRON_SECRET && auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(c) && /requireAdmin/.test(c));
t('ANTHROPIC_API_KEY 없으면 무해 대기', /ANTHROPIC_API_KEY/.test(c) && /비전 백필 대기/.test(c));
t('선별 SQL 함수 short_desc_editorials 사용', /rpc\('short_desc_editorials'/.test(c));
t('검증된 비전 생성기 재사용', /generateEditorialDescriptions/.test(c) && /artistStatement: ''/.test(c));
t('기존 텍스트 보존 — 빈 칸만 채움',
  /!String\(row\.description \|\| ''\)\.trim\(\)/.test(c));
t('seo_description 155자 컷 저장', /seo_description = _clip\(seoBase, 155\)/.test(c) || /patch\.seo_description = _clip\(seoBase, 155\)/.test(c));
t('성공·실패 무관 attempted_at 스탬프(무한 재시도 방지)', /meta_desc_attempted_at: new Date/.test(c));
t('시간 예산 90s 가드', /TIME_BUDGET_MS = 90000/.test(c) && /Date\.now\(\) - started > TIME_BUDGET_MS/.test(c));
t('vercel.json 10분 주기 등록', vj.crons.some(x => x.path === '/api/cron/backfill-meta-desc' && /\/10 \* \* \*/.test(x.schedule)));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ backfill-meta-desc tests FAILED'); process.exit(1); }
console.log('✅ backfill-meta-desc tests passed');
