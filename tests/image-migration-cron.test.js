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
t('구 S3 octet-stream 응답은 확장자 폴백 (1차 배치 173건 전량 실패 교훈)',
  /binary\\\/octet-stream/.test(mig) && /contentTypeFromUrl/.test(mig));
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
// 2026-07-28: 이관 완주(외부 이미지 잔존 0건 실측) → 크론 스케줄에서 제거.
// Vercel 크론 40개 한도 확보용이며 코드는 그대로 남아 있어, 외부 이미지가 다시
// 유입되면 vercel.json 에 한 줄 되살리는 것으로 재가동한다. 주간 점검 크론
// (image-link-check)이 남아 있어 재발은 계속 감시된다.
t('이관 크론 코드는 유지 (필요 시 재가동)',
  require('fs').existsSync(require('path').join(__dirname, '..', 'api/cron/migrate-external-images.js')));
t('이관 완주로 스케줄에서는 제거됨',
  !vj.crons.some(c => c.path === '/api/cron/migrate-external-images'));
t('점검 크론 주 1회(월) 등록', vj.crons.some(c => c.path === '/api/cron/image-link-check' && /\* \* 1$/.test(c.schedule)));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ image-migration-cron tests FAILED'); process.exit(1); }
console.log('✅ image-migration-cron tests passed');
