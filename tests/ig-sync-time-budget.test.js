/**
 * sync-instagram 시간 예산 (2026-08-11, 「크론이 도중에 죽는다」 알림 후속).
 *
 * ■ 실측 (24시간 312회)
 *     성공 311 · 끝나지 않음 2 (사망률 0.6%)
 *     평균 3.8초 · p95 2.2초  ← 대부분은 할 일이 없어 금방 끝난다
 *     그런데 무거운 회차: 89 · 91 · 92 · 100 · 100 · 108 · 113 · 114 초
 *     Vercel 함수 상한은 120초. **상한 코앞에서 돌고 있었고 2건이 넘겼다.**
 *
 * ■ 원인 두 갈래
 *  ① 정상 경로(스케줄 `*​/10`)에는 시간 예산이 **아예 없었다.**
 *     신규 게시물 한 건이 Claude 생성 + 이미지·영상 아카이브 + X·Threads 게시
 *     + 검색핑을 전부 한다. 여러 건이 한 번에 뜨면 그대로 120초를 넘는다.
 *  ② 백필 경로는 예산 80초가 있었지만 **착수 조건에서 게시물 타임아웃(25초)을
 *     빼지 않았다.** 79.9초에 착수한 게시물이 25초를 쓰면 105초 + 오버헤드.
 *
 * ■ 왜 '멈춰도 괜찮은가'
 * 아직 articles 에 INSERT 하기 전에 멈추므로, 남긴 게시물은 다음 실행(10분 뒤)
 * 에도 그대로 '신규' 로 잡힌다. 유실이 아니라 이월이다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api/cron/sync-instagram.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 정상 경로 시간 예산 ===');
t('예산 상수가 있다 (env 로 조정 가능)', /IG_SYNC_BUDGET_MS/.test(src) && /SYNC_BUDGET_MS/.test(src));
t('한 건 처리분을 미리 빼둔다', /PER_POST_RESERVE_MS/.test(src),
  '예산 경계에서 착수하면 그 한 건이 상한을 넘긴다');
t('예산 초과 시 착수를 멈춘다',
  /SYNC_BUDGET_MS - PER_POST_RESERVE_MS/.test(src));
t('멈춘 몫을 이월로 센다', /results\.deferred/.test(src),
  '조용히 건너뛰면 예산 부족을 아무도 모른다');
t('dry 진단은 예산에 걸리지 않는다', /!dry && Date\.now\(\) - SYNC_STARTED/.test(src),
  '진단은 INSERT 를 안 하므로 끊을 이유가 없다');

console.log('=== 백필 경로 ===');
t('착수 조건에서 게시물 타임아웃만큼 여유를 남긴다',
  /TIME_BUDGET_MS - POST_TIMEOUT_MS/.test(src),
  '이게 없으면 79.9초 착수 + 25초 = 105초 + 오버헤드로 120초를 넘는다');
t('게시물별 타임아웃이 살아 있다', /POST_TIMEOUT_MS = 25000/.test(src));
t('미완이면 커서를 되돌린다 (유실 방지)', /advanceAfter = runStartAfter/.test(src));

console.log('=== 관측 가능성 ===');
t('회차마다 note 를 남긴다', /cronNote = 'account='/.test(src) && /수집 /.test(src));
t('note 에 이월 건수가 들어간다', /이월 /.test(src),
  '이월이 매 회차 쌓이면 예산이 모자란다는 신호다');
t('note 에 소요 초가 들어간다', /초'/.test(src));

/* ── 2026-08-22 — 조용한 스킵 금지 ──────────────────────────────
   fashion 계정 크론이 27일간 686회 돌면서 한 건도 수집하지 않았다.
   원인은 IG_FASHION_USER_ID 미설정. 그런데 코드가 **200 OK 로 조용히**
   스킵해서 실패로도 안 잡혔고, cron_runs 에는 토큰 라벨 한 줄만 남아
   '돌고는 있네' 로 읽혔다. 08-18 팝마트 34시간과 같은 모양이다.
   env 가 없는데 크론에 등재돼 있으면 그건 설정 오류다. 시끄러워야 한다. */
console.log('=== 설정 오류를 조용히 넘기지 않는다 ===');
t('env 미설정을 200 OK 로 넘기지 않는다',
  !/ok: true, skipped: 'account/.test(src),
  '200 을 돌려주면 실패 알림도 안 뜨고 cron_runs 도 성공으로 남는다');
t('어느 env 가 없는지 이름으로 알려준다',
  /_USER_ID'\)/.test(src) && /missing/.test(src),
  "'env 미설정' 만으로는 무엇을 넣어야 할지 모른다");
t('고치는 법을 note 에 적는다 (넣거나, 크론 줄을 빼거나)',
  /vercel\.json 에서 이 크론 줄을 빼라/.test(src));
t('재배포가 필요하다는 것도 적는다 (Vercel 은 env 를 빌드에 굽는다)',
  /재배포/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ ig-sync-time-budget tests FAILED'); process.exit(1); }
console.log('✅ ig-sync-time-budget tests passed');
