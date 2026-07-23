/**
 * Threads 자동 게시 — 무한 재시도·알림 폭주 수정 회귀 (2026-07-23).
 *
 * [실사고] 제니 기사 하나가 "Media Not Found"(영구성 오류)로 매 10분 실패
 * → 6시간마다 크론 실패 메일 반복 + 큐 전체 정체.
 * [원인 2중] ① 컨테이너 생성 직후 즉시 발행 — 링크 미리보기 처리가 안
 * 끝난 컨테이너를 발행해 code 24 ② failed 무조건 재시도 — 상한 없음.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const th = R('api/_lib/threads.js');
const ap = R('api/_lib/threadsAutopost.js');
const cr = R('api/cron/threads-post.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 컨테이너 상태 폴링 (발행 전 FINISHED 확인) ===');
t('발행 전 status 폴링 존재', /fields=status,error_message/.test(th),
  '즉시 발행으로 돌아가면 Media Not Found(code 24) 재발');
t('FINISHED 확인 후 발행', /sj\.status === 'FINISHED'/.test(th));
t('ERROR 시 사유 표면화', /컨테이너 처리 실패/.test(th) && /error_message/.test(th));
t('폴링도 대기 상한 보유 (무한 대기 금지)', /대기 초과/.test(th));
t('폴링이 발행(threads_publish)보다 앞에 위치',
  th.indexOf('fields=status') < th.indexOf('threads_publish'));

console.log('=== 재시도 상한 (실패 3회 → 스킵) ===');
t('autopost: attempts 조회', /select\('id, status, attempts'\)/.test(ap));
t('autopost: 3회 상한 가드', /attempts \|\| 0\) >= 3/.test(ap));
t('autopost: 실패 시 attempts 누적', /attempts: status === 'failed'/.test(ap));
t('픽커: 실패 3회 기사를 done 취급 (큐 정체 방지)',
  /p\.status !== 'failed' \|\| \(p\.attempts \|\| 0\) >= 3/.test(cr),
  '이 필터가 없으면 영구 실패 기사가 큐 전체를 막는다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ threads-retry-cap tests FAILED'); process.exit(1); }
console.log('✅ threads-retry-cap tests passed');
