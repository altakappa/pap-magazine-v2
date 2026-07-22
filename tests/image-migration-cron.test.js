/**
 * 외부 이미지 이관·점검 크론 회귀 (2026-07-22, CREATURES 사고 후속).
 *
 * 배경: published 에디토리얼 1,900+ 건이 외부 호스트(드라이브·구 S3) 이미지
 * 의존 — 외부에서 파일이 사라지면 조용히 깨진다 (CREATURES 실사고).
 * 2종 크론: migrate-external-images(매시 배치 이관) + image-link-check(주간 점검).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const mig = R('api/cron/migrate-external-images.js');
const chk = R('api/cron/image-link-check.js');
const vj  = JSON.parse(R('vercel.json'));

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 이관 크론 (migrate-external-images) ===');
t('크론 인증 규약 (CRON_SECRET Bearer + admin 폴백)',
  /CRON_SECRET && auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(mig) && /requireAdmin/.test(mig));
t('선별은 SQL 함수 external_image_editorials (gallery 배열 포함 검색)',
  /rpc\('external_image_editorials'/.test(mig));
t('이미지 MIME 검증 (비이미지 응답 거부)', /\^image\\\//.test(mig));
t('용량 상한 15MB + fetch 타임아웃', /MAX_BYTES = 15 \* 1024 \* 1024/.test(mig) && /FETCH_TIMEOUT_MS/.test(mig));
t('media 버킷 migrated/ 경로 업로드', /storage\.from\('media'\)/.test(mig) && /'migrated\/' \+ row\.id/.test(mig));
t('실패 URL 기록 + 재시도 건너뜀 (무한 재시도 방지)',
  /image_migration_failures/.test(mig) && /failSet\.has\(url\)/.test(mig));
t('부분 이관 허용 — 성공분만 치환 저장', /urlMap\[row\.cover_image\]/.test(mig) && /urlMap\[g\] \|\| g/.test(mig));
t('시간 예산 90s 가드 (다음 실행이 이어감)', /TIME_BUDGET_MS = 90000/.test(mig));
t('죽은 링크 발견 시 텔레그램 알림', /sendTextToTelegramSafe/.test(mig));

console.log('=== 점검 크론 (image-link-check) ===');
t('크론 인증 규약', /CRON_SECRET && auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(chk));
t('published 대표 이미지(cover/thumbnail) 대상', /cover_image, thumbnail/.test(chk) && /eq\('status', 'published'\)/.test(chk));
t('드라이브 "200 + html 오류 페이지" 함정 감지', /html-instead-of-image/.test(chk));
t('동시 20 · 시간 예산 가드', /CONCURRENCY = 20/.test(chk) && /TIME_BUDGET_MS/.test(chk));
t('깨진 링크를 실패 테이블에 기록 (이관 크론과 연동)', /image_migration_failures/.test(chk));
t('결과 텔레그램 보고 (정상/깨짐 모두)', /주간 이미지 점검/.test(chk) && /sendTextToTelegramSafe/.test(chk));

console.log('=== vercel.json 크론 등록 ===');
const paths = vj.crons.map(c => c.path + ' ' + c.schedule);
t('이관 크론 10분 주기 등록 (도메니코: 하루 반 완주)',
  vj.crons.some(c => c.path === '/api/cron/migrate-external-images' && c.schedule === '5-55/10 * * * *'));
t('점검 크론 주 1회(월) 등록', vj.crons.some(c => c.path === '/api/cron/image-link-check' && /\* \* 1$/.test(c.schedule)));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ image-migration-cron tests FAILED'); process.exit(1); }
console.log('✅ image-migration-cron tests passed');
