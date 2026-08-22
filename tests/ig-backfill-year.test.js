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
t('cron 이 fetchMediaPage 로 커서 재개 백필', /fetchMediaPage\(\{ afterCursor: pageAfter/.test(cron));
t('커서를 ops_alert_state 에 저장(계정별 ig_backfill_cursor)',
  /ig_backfill_cursor/.test(cron) && /after: advanceAfter/.test(cron));
t('예산 초과 페이지는 커서 유지(재수집), 완주 시 커서 null',
  /overflow\).*advanceAfter = pageAfter/.test(cron) && /reachedEnd = true; advanceAfter = null/.test(cron));
t('커서는 불투명 after 값만 저장 — access_token 미저장(비밀값 유출 방지)',
  /paging\.cursors/.test(lib) && !/next_url:/.test(cron)
  && /access_token 이 박혀 있어/.test(lib));
t('백필 모드는 X·Threads 자동게시 차단(소셜 스팸 방지)',
  /if \(!backfillMode\)\{[\s\S]{0,600}xConfigured\(\)/.test(cron) && /!backfillMode/.test(cron));
t('공용 처리 함수 processOne 로 백필·일반 경로 통합', /async function processOne\(m\)/.test(cron));
t('실행 내 병렬 처리(동시 4건 워커풀) — 속도 상향',
  /BACKFILL_CONCURRENCY = 4/.test(cron) && /Promise\.all\(/.test(cron) && /_worker\(\)/.test(cron));
t('백필 회당 상한 상향(perCall cap 40)', /Math\.min\(40,/.test(cron));
t('시간 예산 80s 가드 — 120s 강제종료 전 커서 저장 보장(504 방지)',
  /TIME_BUDGET_MS = 80000/.test(cron)
  && /Date\.now\(\) - startedAt < TIME_BUDGET_MS/.test(cron));
t('게시물별 25s 타임아웃(Promise.race) — 한 게시물이 실행 전체 붙잡는 것 차단',
  /POST_TIMEOUT_MS = 25000/.test(cron)
  && /Promise\.race\(\[\s*processOne\(m\)/.test(cron));
t('처리 미완 시 커서 되돌림 — 게시물 유실 방지',
  /_processed < toProcess\.length\)\{ advanceAfter = runStartAfter/.test(cron));

console.log('--- 반드시 기사만 (에디토리얼 배제 강화, 2026-07-24) ---');
t('백필은 엄격 에디토리얼 모드로 AI 호출(strictEditorial: backfillMode)',
  /generateArticleFromPost\(post, \{ strictEditorial: backfillMode \}\)/.test(cron));
t('임포트 함수가 strictEditorial 옵션 지원',
  /opts && opts\.strictEditorial/.test(lib) && /STRICT BACKFILL/.test(lib));
t('AI 결과 카테고리 화이트리스트 게이트(백필은 기사 외 전부 스킵)',
  /ARTICLE_CATEGORIES = \['news'/.test(cron)
  && /backfillMode && !ARTICLE_CATEGORIES\.includes\(cat\)/.test(cron));
t('일반 동기화 경로는 불변 — editorial 만 스킵(화이트리스트는 백필 한정)',
  /cat === 'editorial'\s*\|\|\s*\(backfillMode/.test(cron));

console.log('--- 다계정 백필 ---');
const impLib2 = R('api/_lib/instagramImport.js');
t('임포트 함수가 계정 자격증명 파라미터화(_creds)', /function _creds\(opts\)/.test(impLib2) && /opts && opts\.userId/.test(impLib2));
t('cron: ?account=<key> 로 하위 계정 자격증명 선택', /req\.query && req\.query\.account/.test(cron) && /IG_' \+ account\.toUpperCase\(\) \+ '_USER_ID/.test(cron));
/* 2026-08-22 — 이 가드를 뒤집는다.
   '무해 스킵(실패 알림 방지)' 로 만든 결과: fashion 크론이 07-26~08-22,
   686회를 200 OK 로 돌면서 **한 건도 수집하지 않았다.** 원인은
   IG_FASHION_USER_ID 미설정. 실패로 안 잡히니 27일간 아무도 몰랐다.
   vercel.json 에 크론으로 등재된 계정의 env 가 없으면 그건 무해한 상태가
   아니라 설정 오류다. 알림이 싫으면 크론 줄을 빼면 된다. */
t('cron: env 미설정을 200 OK 로 넘기지 않는다',
  !/ok: true, skipped: 'account/.test(cron));
t('cron: 없는 env 이름을 그대로 알려준다', /missing\.push\('IG_'/.test(cron));
t('cron: 고치는 법을 note 에 담는다', /크론 줄을 빼라/.test(cron));

/* 2026-08-22 — 완주 조기종료가 cron_runs.note 에 아무것도 안 남겼다.
   그래서 위(토큰 라벨) 줄만 남았고, 정상 상태가 '토큰 깨진 채로 도는 중' 으로
   읽혔다. 실제로 그 오독으로 '27일간 죽어 있었다' 는 오진이 나왔다.
   조회해 보니 ig_backfill_done_fashion 은 2026-08-02 에 이미 찍혀 있었다.
   note 는 '무엇을 하려 했는가' 가 아니라 '무엇을 했는가' 를 적어야 한다
   (08-19 GSC 건과 같은 교훈). */
t('cron: 백필 완주 조기종료가 note 를 남긴다',
  /백필 완주/.test(cron) && /res\.locals\.cronNote = why/.test(cron),
  '아무것도 안 남기면 앞 단계의 노트가 그대로 남아 거짓말을 한다');
t('cron: 완주 노트에 완주 날짜가 들어간다',
  /updated_at/.test(cron) && /doneAt/.test(cron),
  "'언제 끝났나' 가 없으면 정상인지 멈춘 건지 구분이 안 된다");
t('cron: 완주 노트에 되돌리는 법이 들어간다',
  /재실행하려면 ops_alert_state 의/.test(cron));
t('cron: 기본(account 없음)은 @pap_magazine env 불변', /account \? \('ig_backfill_done_' \+ account\) : 'ig_backfill_done'/.test(cron));
t('cron: 완주 통보에 계정 라벨(acctLabel)', /acctLabel/.test(cron));
// 2026-07-26: 토큰 재발급 없이 본계정 토큰 폴백으로 복구되어 5개 크론을 되살렸다.
// (dry=1 실측 5계정 전부 200, token_source='main (계정 토큰 형식 불량)')
// 2026-07-28: 백필을 완주한 계정의 크론은 스케줄에서 뺐다 (Vercel 크론 40개 한도 확보).
//   ops_alert_state 실측 — celeb·beauty·trends·object 는 ig_backfill_done_* = true
//   (완주 후에는 크론이 돌아도 즉시 early-return 하므로 칸만 차지했다).
//   fashion 은 아직 미완주라 유지. 코드(api/cron/sync-instagram.js)는 그대로라
//   완료 플래그를 지우고 크론을 되살리면 언제든 재실행할 수 있다.
t('vercel.json fashion 백필 크론 유지 (미완주 계정)',
  vj.crons.some(c => c.path.includes('account=fashion&backfill=365')));
t('완주 계정(celeb·beauty·trends·object) 백필 크론은 제거됨',
  ['celeb','beauty','trends','object'].every(a =>
    !vj.crons.some(c => c.path.includes('account=' + a + '&backfill=365'))));
t('본계정 정기 동기화·전체 백필은 유지',
  vj.crons.some(c => c.path === '/api/cron/sync-instagram') &&
  vj.crons.some(c => c.path.includes('backfill=4000')));

console.log('--- 토큰 위생·본계정 폴백 (2026-07-26 OAuth 190 대응) ---');
const II = require('../api/_lib/instagramImport');
const GOOD = 'EAAB' + 'x'.repeat(80);
const OTHER = 'EAAC' + 'y'.repeat(80);
t('sanitizeCredential: 끝 줄바꿈·공백 제거', II.sanitizeCredential(' ' + GOOD + '\n') === GOOD);
t('sanitizeCredential: 감싼 따옴표 제거', II.sanitizeCredential('"' + GOOD + '"') === GOOD);
t('sanitizeCredential: null/undefined 는 빈 문자열', II.sanitizeCredential(null) === '' && II.sanitizeCredential(undefined) === '');
t('pickAccountToken: 계정 토큰이 멀쩡하면 그대로 사용',
  II.pickAccountToken(GOOD, OTHER).token === GOOD && II.pickAccountToken(GOOD, OTHER).source === 'account');
t('pickAccountToken: 줄바꿈만 붙은 계정 토큰은 정리해서 그대로 사용(폴백 아님)',
  II.pickAccountToken(GOOD + '\n', OTHER).token === GOOD);
t('pickAccountToken: 계정 토큰 없으면 본계정 토큰 폴백',
  II.pickAccountToken('', GOOD).token === GOOD && /^main /.test(II.pickAccountToken('', GOOD).source));
t('pickAccountToken: 계정 토큰 형식 불량이면 본계정 토큰 폴백',
  II.pickAccountToken('깨진값', GOOD).token === GOOD && /형식 불량/.test(II.pickAccountToken('깨진값', GOOD).source));
t('pickAccountToken: 둘 다 못 쓰면 빈 토큰(→ 이제는 시끄러운 실패 경로로)',
  II.pickAccountToken('x', 'y').token === '');
t('pickAccountToken: source 라벨에 토큰 값이 새지 않는다',
  !II.pickAccountToken('', GOOD).source.includes(GOOD) && !II.pickAccountToken('깨진값', GOOD).source.includes('깨진값'));
t('cron: 하위 계정 경로가 pickAccountToken 사용', /pickAccountToken\(/.test(cron) && /sanitizeCredential\(process\.env\['IG_'/.test(cron));
t('cron: dry 응답에 token_source 노출(값 아님)', /results\.token_source = tokenSource/.test(cron));
t('cron: 실패해도 cron_runs.note 에 token_source 남김', /res\.locals\.cronNote = 'account=' \+ account \+ ' token_source='/.test(cron));
t('lib: _creds 가 양쪽 자격증명을 sanitize', /const userId = sanitizeCredential\(/.test(lib) && /const token = sanitizeCredential\(/.test(lib));

console.log('--- 스케줄 등록 ---');
t('vercel.json @pap_magazine 백필 크론 전체 이력(backfill=4000)',
  vj.crons.some(c => c.path.includes('/api/cron/sync-instagram?backfill=4000')));
t('기존 최근-동기화 크론(sync-instagram 무파라미터) 유지',
  vj.crons.some(c => c.path === '/api/cron/sync-instagram'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ ig-backfill-year tests FAILED'); process.exit(1); }
console.log('✅ ig-backfill-year tests passed');
