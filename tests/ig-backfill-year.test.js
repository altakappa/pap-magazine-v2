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
  /qualityGateOn && !backfillMode/.test(cron) && /const backfillMode = backfillDays > 0/.test(cron),
  '이 조건이 아니면 오래된 게시물이 draft 로 빠져 "바로 발행" 위반');
t('최근-동기화 경로 불변(품질 게이트는 !backfillMode 에서만)', /qualityGateOn && !backfillMode/.test(cron));
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
t('완주(가장 오래된 게시물 도달) 시 done 플래그 + 개인 텔레그램', /ig_backfill_done/.test(cron) && /sendTextToTelegramPersonalSafe/.test(cron));
t('완주 후 조기 종료(IG 재조회 없이 반환)', /backfill_done: true/.test(cron));
t('중복 방지 — 기존 article/editorial dedup 재사용', /existingSet\.has\(m\.id\)/.test(cron) && /editorialShortcodes/.test(cron));

console.log('--- 전체 이력 커서 백필 (2026-07-24 @pap_magazine 4,240 대응) ---');
t('커서 기반 페이지 수집 함수(fetchMediaPage) 존재+export',
  /async function fetchMediaPage\(opts\)/.test(lib) && /fetchMediaPage,/.test(lib));
t('cron 이 fetchMediaPage 로 커서 재개 백필', /fetchMediaPage\(\{ afterUrl: pageUrl/.test(cron));
t('커서를 ops_alert_state 에 저장(계정별 ig_backfill_cursor)',
  /ig_backfill_cursor/.test(cron) && /next_url: advanceUrl/.test(cron));
t('예산 초과 페이지는 커서 유지(재수집), 완주 시 커서 null',
  /overflow\).*advanceUrl = pageUrl/.test(cron) && /reachedEnd = true; advanceUrl = null/.test(cron));
t('백필 모드는 X·Threads 자동게시 차단(소셜 스팸 방지)',
  /if \(!backfillMode\)\{[\s\S]{0,600}xConfigured\(\)/.test(cron) && /!backfillMode/.test(cron));
t('공용 처리 함수 processOne 로 백필·일반 경로 통합', /async function processOne\(m\)/.test(cron));

console.log('--- 다계정 백필 ---');
const impLib2 = R('api/_lib/instagramImport.js');
t('임포트 함수가 계정 자격증명 파라미터화(_creds)', /function _creds\(opts\)/.test(impLib2) && /opts && opts\.userId/.test(impLib2));
t('cron: ?account=<key> 로 하위 계정 자격증명 선택', /req\.query && req\.query\.account/.test(cron) && /IG_' \+ account\.toUpperCase\(\) \+ '_USER_ID/.test(cron));
t('cron: account 미설정 env 는 무해 스킵(실패 알림 방지)', /env 미설정.*skipped|skipped:.*env 미설정/.test(cron));
t('cron: 기본(account 없음)은 @pap_magazine env 불변', /account \? \('ig_backfill_done_' \+ account\) : 'ig_backfill_done'/.test(cron));
t('cron: 완주 통보에 계정 라벨(acctLabel)', /acctLabel/.test(cron));
t('vercel.json 5개 하위 계정 백필 크론 등록',
  ['celeb','beauty','fashion','trends','object'].every(a =>
    vj.crons.some(c => c.path.includes('account=' + a + '&backfill=365'))));

console.log('--- 스케줄 등록 ---');
t('vercel.json @pap_magazine 백필 크론 전체 이력(backfill=4000)',
  vj.crons.some(c => c.path.includes('/api/cron/sync-instagram?backfill=4000')));
t('기존 최근-동기화 크론(sync-instagram 무파라미터) 유지',
  vj.crons.some(c => c.path === '/api/cron/sync-instagram'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ ig-backfill-year tests FAILED'); process.exit(1); }
console.log('✅ ig-backfill-year tests passed');
