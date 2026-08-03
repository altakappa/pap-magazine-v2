'use strict';
/**
 * threads-metrics — Threads 성과 지표 수집 + 카피 전략 메타 + 토큰 알림
 *
 * 왜 이 테스트가 있나 (2026-08-03):
 *  1) 248건을 게시하는 동안 성과 데이터가 0건이었다. 수집 크론이 조용히
 *     빠지거나 스케줄이 사라져도 아무도 모른다 — 배선을 소스로 고정한다.
 *  2) generateThreadsText 는 conversational/angle/score 를 예전부터
 *     돌려줬는데 저장부에서 전부 버려졌다. 같은 회귀를 막는다.
 *  3) 토큰 연장 실패 시 조용히 기존 토큰으로 넘어가던 분기가 있었다.
 *     알림 없는 폴백으로 되돌아가지 않는지 확인한다.
 */
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const th = R('api/_lib/threads.js');
const ap = R('api/_lib/threadsAutopost.js');
const cm = R('api/cron/threads-metrics.js');
const mig = R('supabase_migrations/097_threads_metrics.sql');
const vercel = JSON.parse(R('vercel.json'));

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

console.log('\n[1] 마이그레이션 097 — 컬럼이 전부 있는가');
for (const col of ['posted_at', 'ai', 'conversational', 'angle', 'score',
  'views', 'likes', 'replies', 'reposts', 'quotes', 'metrics_at', 'metrics_stage']) {
  t('threads_posts.' + col, new RegExp('ADD COLUMN IF NOT EXISTS\\s+' + col + '\\b').test(mig));
}
t('threads_auth.alerted_at (알림 쿨다운)', /ALTER TABLE public\.threads_auth[\s\S]{0,120}alerted_at/.test(mig));
t('기존 행 posted_at 백필', /UPDATE public\.threads_posts[\s\S]{0,200}SET posted_at = created_at/.test(mig));
t('수집 대기열 인덱스', /idx_threads_posts_metrics_due/.test(mig));
t('ALTER 만 — 새 테이블 GRANT 불필요', !/CREATE TABLE/i.test(mig));

console.log('\n[2] threads.js — insights 권한 · 조회 · 토큰 알림');
t('SCOPES 에 threads_manage_insights', /SCOPES = '[^']*threads_manage_insights/.test(th));
t('getThreadInsights export', /module\.exports[^;]*getThreadInsights/.test(th));
t('insights 지표 5종', /INSIGHT_METRICS = \['views', 'likes', 'replies', 'reposts', 'quotes'\]/.test(th));
t('total_value / values 양쪽 정규화',
  /total_value[\s\S]{0,120}row\.values/.test(th));
t('권한 오류는 needsReauth 로 구분', /needsReauth\s*=/.test(th));
t('연장 실패 시 조용한 폴백 금지 — 알림 후 반환',
  /alertTokenTrouble\('refresh'[\s\S]{0,120}return \{ token: row\.access_token/.test(th),
  '만료 7일 전 연장 실패가 알림 없이 통과하면 안 된다');
t('완전 만료도 알림', /alertTokenTrouble\('expired'/.test(th));
t('알림 쿨다운 6시간', /TOKEN_ALERT_COOLDOWN_MS = 6 \* 3600 \* 1000/.test(th));
t('쿨다운 기록은 alerted_at 에', /alerted_at: new Date\(\)\.toISOString\(\)/.test(th));
t('알림 실패가 게시를 막지 않음(try/catch)',
  /async function alertTokenTrouble[\s\S]{0,200}try \{/.test(th));
t('pushAlert 사용', /require\('\.\/pushAlert'\)/.test(th));

console.log('\n[3] threadsAutopost.js — 카피 전략 메타 저장');
for (const k of ['ai:', 'conversational:', 'angle:', 'score:', 'posted_at:']) {
  t('meta 에 ' + k, new RegExp('\\n\\s*' + k.replace(':', ':')).test(ap.split('const meta = {')[1] || ''));
}
t('generateThreadsText 반환 전체를 보관(gen)', /const gen = await generateThreadsText/.test(ap));
t('실패 행은 posted_at NULL', /posted_at: status === 'published' \? new Date\(\)\.toISOString\(\) : null/.test(ap));
t('097 미적용 방어 — 기본 필드로 재시도',
  /upsert\(base, \{ onConflict: 'article_id' \}\)/.test(ap),
  '메타 컬럼이 없어 기록이 통째로 실패하면 같은 기사가 재게시된다');
t('base 에 attempts 상한 유지', /attempts: status === 'failed'/.test(ap));

console.log('\n[4] threads-metrics 크론');
t('cronGuard 이름 등록', /withCronGuard\('threads-metrics'/.test(cm));
t('CRON_SECRET 또는 관리자 인증', /CRON_SECRET[\s\S]{0,200}requireAdmin/.test(cm));
t('1차 24시간', /STAGE1_AFTER_MS = 24 \* 3600 \* 1000/.test(cm));
t('2차 7일', /STAGE2_AFTER_MS = 7 \* DAY/.test(cm));
t('stage 2 도달 시 재수집 안 함', /stage < 2 && age >= STAGE2_AFTER_MS/.test(cm));
t('posted_at 없으면 created_at 폴백', /row\.posted_at \|\| row\.created_at/.test(cm));
t('metrics_stage NULL 도 후보에 포함', /metrics_stage\.is\.null,metrics_stage\.lt\.2/.test(cm));
t('실행당 상한', /MAX_PER_RUN = 10/.test(cm));
t('시간 예산 가드', /TIME_BUDGET_MS = \d+/.test(cm) && /Date\.now\(\) - started > TIME_BUDGET_MS/.test(cm));
t('dry 모드', /dry === '1'/.test(cm));
t('미인증이면 200 대기 (알림 스팸 방지)',
  /Threads 미인증[\s\S]{0,120}status\(200\)/.test(cm));
t('권한 없음은 실패가 아니라 대기', /needs_reauth: true/.test(cm));
t('권한 오류 시 즉시 중단(전 건 동일)', /needsReauth = true; break;/.test(cm));
t('응답에 원문 에러 노출 금지',
  !/detail:\s*\w*[Ee]rr\.message/.test(cm) && /code: 'threads_metrics_query_failed'/.test(cm),
  '.claude/rules/api.md — 원문 대신 분류 코드');
t('api/cron 은 ../_lib 경로', /require\('\.\.\/_lib\/threads'\)/.test(cm));
t('cronNote 요약 기록', /res\.locals\.cronNote/.test(cm));

console.log('\n[5] vercel.json 등록');
const crons = vercel.crons || [];
const mc = crons.find((c) => c.path === '/api/cron/threads-metrics');
t('크론 등록됨', !!mc, JSON.stringify(crons.filter((c) => /threads/.test(c.path))));
t('매시 1회 스케줄', !!mc && mc.schedule === '17 * * * *', mc && mc.schedule);
t('게시 크론과 분(minute) 충돌 없음',
  !!mc && !crons.some((c) => c.path !== '/api/cron/threads-metrics' && c.schedule === mc.schedule));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('❌ threads-metrics tests FAILED'); process.exit(1); }
console.log('✅ threads-metrics tests passed');
