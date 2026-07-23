/**
 * IG 1년 백필 회귀 (도메니코: @pap_magazine 최근 1년 전량 가져오기, 바로 발행).
 * 최근-동기화 경로(backfillDays===0)는 불변, 백필만 확장.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const cron = R('api/cron/sync-instagram.js');
const lib  = R('api/_lib/instagramImport.js');
const vj   = JSON.parse(R('vercel.json'));

let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== IG 1년 백필 ===');
t('백필 모드는 품질 게이트 우회(무조건 published)',
  /qualityGateOn && backfillDays === 0/.test(cron),
  '이 조건이 아니면 오래된 게시물이 draft 로 빠져 "바로 발행" 위반');
t('최근-동기화 경로 불변(backfillDays===0 게이트 유지)', /qualityGateOn && backfillDays === 0/.test(cron));
t('백필 수집 상한 상향(maxCount 2000)', /maxCount: 2000/.test(cron));
t('페이지 상한을 maxCount 기준 동적 계산(500 하드캡 제거)',
  /pageGuard.*Math\.ceil\(maxCount \/ 50\)/.test(lib) && /guard < pageGuard/.test(lib));

console.log('--- 발행일 = IG 게시일 (오늘로 덮어쓰기 금지) ---');
const impLib = R('api/_lib/instagramImport.js');
t('published_date 는 IG 게시 timestamp 사용(new Date() 폴백은 timestamp 없을 때만)',
  /published_date: status === 'published'[\s\S]{0,80}post\.timestamp \|\| new Date/.test(impLib),
  '오늘 날짜로 저장하면 과거 백필 기사의 목록·RSS·사이트맵 정렬이 전부 오늘로 몰린다');
t('normalizeMedia 가 IG timestamp 를 보존', /timestamp: m\.timestamp/.test(impLib));

console.log('--- 완주 감지·통보·조기종료 ---');
t('완주(신규0·잔여0) 시 done 플래그 + 개인 텔레그램', /ig_backfill_done/.test(cron) && /sendTextToTelegramPersonalSafe/.test(cron));
t('완주 후 조기 종료(IG 재조회 없이 반환)', /backfill_done: true/.test(cron));
t('중복 방지 — 기존 article/editorial dedup 재사용', /existingSet\.has\(m\.id\)/.test(cron) && /editorialShortcodes/.test(cron));

console.log('--- 스케줄 등록 ---');
t('vercel.json 백필 크론 등록(backfill=365)',
  vj.crons.some(c => c.path.includes('/api/cron/sync-instagram?backfill=365')));
t('기존 최근-동기화 크론(sync-instagram 무파라미터) 유지',
  vj.crons.some(c => c.path === '/api/cron/sync-instagram'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ ig-backfill-year tests FAILED'); process.exit(1); }
console.log('✅ ig-backfill-year tests passed');
