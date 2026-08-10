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
/* 2026-08-10 — 핀을 되돌린다. 앞의 근거가 틀렸다.
 *
 * 2026-07-28 커밋 64bc86d 는 "이관 완주(외부 이미지 잔존 0건 실측)" 를 근거로
 * 이 크론을 스케줄에서 빼고, 이 테스트를 '제거됨' 으로 뒤집었다.
 * 그 실측은 **인스타 CDN** 잔존을 센 것이었다. 그런데 이 크론의 대상은
 * 인스타 CDN 이 아니다:
 *     EXTERNAL_RE = /drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com/
 * 재는 지표가 대상과 달랐다. 2026-08-10 실측 잔량은 **1,340편 / 이미지 20,398장**
 * 으로, 끌 당시 파일 머리말에 적힌 "드라이브 1,077건" 에서 한 건도 안 줄어 있었다.
 *
 * 진짜 정지 원인은 따로 있었다 — 큐 맨 앞 12건이 전부 죽은 링크라 매 회차가
 * 통째로 skip 됐다(head-of-line blocking · 691회 실행 / 진전 0).
 * 그건 2026-08-01 마이그레이션이 고쳤는데, 크론이 3일 전에 이미 꺼져 있어
 * 그 수정을 아무도 써보지 못했다.
 *
 * ▶ 다음에 이 크론을 끄려는 사람에게 — 반드시 이 쿼리로 재라:
 *       select count(*) from external_image_editorials(100000);
 *   0일 때만 완주다. 다른 지표(인스타 CDN 등)로 판단하지 말 것. */
t('이관 크론 코드가 있다',
  require('fs').existsSync(require('path').join(__dirname, '..', 'api/cron/migrate-external-images.js')));
t('이관 크론이 스케줄에 등록돼 있다 (잔량 0 전까지)',
  vj.crons.some(c => c.path === '/api/cron/migrate-external-images'),
  '잔량이 남았는데 빼면 2026-07-28 사고가 재발한다');
t('점검 크론 주 1회(월) 등록', vj.crons.some(c => c.path === '/api/cron/image-link-check' && /\* \* 1$/.test(c.schedule)));

console.log('=== 이관 순서 — wix 우선 (119) ===');
/* 왜 테스트로 박아두나:
 *   순서는 "돌아가긴 하니까" 조용히 원상복구되기 쉬운 종류의 결정이다.
 *   그런데 이건 성능이 아니라 **위험 관리**다 — drive/S3 는 우리 계정이라
 *   우리가 안 지우면 안 사라지지만, wix 는 옛 사이트라 구독이 끊기는 순간
 *   71편 1,080장이 복구 불가로 증발한다. 날짜순으로 두면 그게 맨 마지막이었다.
 *   (2026-08-11 실측: wix 호스트는 살아 있고 원본까지 서빙된다. 지금이 기회다.) */
const sql119 = R('supabase_migrations/119_external_images_wix_first.sql');
const ord = sql119.slice(sql119.lastIndexOf('order by'));
t('119 마이그레이션이 있다', sql119.length > 0);
/* -1 를 반드시 배제한다 — indexOf 가 없을 때 -1 을 주므로
   `없음 < 날짜` 가 참이 되어, 정렬을 통째로 지워도 통과하는 헛테스트가 된다.
   (2026-08-11 작성 중 실제로 이 함정에 걸렸다) */
const iWix = ord.indexOf('static\\.wixstatic\\.com');
const iDate = ord.indexOf('published_date');
t('order by 첫 키가 wix 티어다 (날짜보다 먼저)',
  iWix >= 0 && iDate >= 0 && iWix < iDate,
  'wix 가 날짜 뒤로 밀리면 초창기 아카이브가 맨 마지막이 된다');
t('같은 티어 안에서는 기존 날짜 역순 유지', /published_date desc nulls last/.test(ord));
t('live CTE 를 대상판정(where)과 우선순위(order by)가 함께 쓴다',
  /\), live as \(/.test(sql119)
  && /where exists \(select 1 from live l where l\.id = c\.id\)/.test(sql119)
  && /from live l where l\.id = c\.id and l\.url ~/.test(sql119),
  '기준이 갈리면 죽은 wix URL 때문에 drive 전용 편이 wix 로 오인된다');
t('대상 호스트 목록이 앱의 EXTERNAL_RE 와 같다',
  (function(){
    const js = (mig.match(/EXTERNAL_RE = \/([^/]+)\//) || [])[1];
    if (!js) return false;
    const hosts = js.split('|').map(h => h.replace(/\\/g, ''));
    return hosts.every(h => sql119.includes(h.replace(/\./g, '\\.')));
  })(),
  '호스트 목록은 아직 JS·SQL 두 곳이다 — 늘릴 땐 반드시 함께 (107·118 교훈)');
t('앱은 RPC 순서를 그대로 소비한다 (자체 재정렬 없음)',
  !/rows\s*\.\s*sort|rows\s*=\s*rows\.sort/.test(mig),
  'JS 가 다시 정렬하면 SQL 우선순위가 무의미해진다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ image-migration-cron tests FAILED'); process.exit(1); }
console.log('✅ image-migration-cron tests passed');
