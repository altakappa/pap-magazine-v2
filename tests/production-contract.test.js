/**
 * 크론 생산량 계약 — 가드 (2026-09-03 신설)
 *
 * GROWTH-LEDGER 교훈 1("돌았다 ≠ 했다")이 이 저장소에서 가장 자주 재발한다.
 * 그때마다 **그 크론 전용** 건강검사를 만들었다 — faqHealth · backfillHealth ·
 * translateHealth · cronDurationHealth · aiCreditWatch. 다섯 개다.
 * 사고당 하나씩 만드는 구조라 새 크론은 언제나 무방비다. 2026-08-28 에 새로
 * 만든 faqEnBackfill 이 그 증거다 — 조용한 0건·잘린 응답·끝낼 수 없는 콜을
 * 전부 밟았는데 어느 감시에도 안 걸렸다.
 *
 * 이 계약은 크론 종류를 가리지 않는다:
 *   크론이 produced/remaining 을 신고하면 → 감시자 하나가 전부 본다.
 *
 * 판정 로직은 순수 함수라 **돌려서** 검사한다.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

const ROOT = path.resolve(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* supabase 스텁 — cronGuard 는 DB 모듈이라 env 없이는 require 가 죽는다.
   (2026-07-30 CI 사고와 같은 자리. 여기서는 스텁으로 우회한다.) */
const sp = path.join(ROOT, 'api/_lib/supabase.js');
const stub = new Module(sp, null);
stub.filename = sp; stub.loaded = true; stub.exports = { supabaseAdmin: {} };
require.cache[sp] = stub;

const H = require('../api/_lib/productionHealth.js');
const G = require('../api/_lib/cronGuard.js');
const migration = rd('supabase_migrations/142_cron_production.sql');
const guardSrc = rd('api/_lib/cronGuard.js');
const watchSrc = rd('api/cron/pipeline-watch.js');
const faqCron = rd('api/cron/backfill-faq.js');

console.log('=== 마이그레이션 ===');
t('cron_runs 에 produced/remaining 추가',
  /add column if not exists produced\s+integer/.test(migration)
  && /add column if not exists remaining integer/.test(migration));
t('nullable — 신고 안 하는 크론은 종전과 같다', !/not null/i.test(migration));
t('감시자 조회에 맞는 인덱스', /cron_name, ran_at desc/.test(migration));
t('되돌리기가 적혀 있다', /drop column if exists produced/.test(migration));

console.log('\n=== 신고 (cronGuard) ===');
{
  const mk = () => ({ locals: {} });
  let r = mk(); G.reportProduction(r, { produced: 12, remaining: 3474, note: '영문FAQ 12' });
  t('숫자와 사람용 note 를 함께 남긴다',
    JSON.stringify(G._productionOf(r)) === '{"produced":12,"remaining":3474}'
    && r.locals.cronNote === '영문FAQ 12');

  /* 이게 이 계약의 핵심이다 — 0 과 '신고 안 함' 은 완전히 다른 사실이다. */
  r = mk(); G.reportProduction(r, { produced: 0, remaining: 5 });
  t('0건 신고는 기록된다', (G._productionOf(r) || {}).produced === 0);
  r = mk();
  t('미신고는 null (0 으로 둔갑하지 않는다)', G._productionOf(r) === null);

  r = mk(); G.reportProduction(r, { produced: '12' });
  t('숫자가 아니면 적지 않는다', G._productionOf(r) === null);
  r = mk(); G.reportProduction(r, { produced: 7 });
  t('잔여를 모르면 생략한다', JSON.stringify(G._productionOf(r)) === '{"produced":7}');

  t('cronGuard 가 그 숫자를 cron_runs 에 쓴다',
    /_productionOf\(res\)/.test(guardSrc) && /\.\.\.\(prod \|\| \{\}\)/.test(guardSrc));
}

console.log('\n=== 판정 (productionHealth) ===');
{
  const R = (p, r) => ({ produced: p, remaining: r, ok: true });
  const N = H.MIN_ZERO_RUNS;

  t('잔여가 있는데 연속 0 이면 막힘', H.judgeCron(Array(N + 2).fill(R(0, 3474))).status === '막힘');
  /* 완주한 크론이 매일 알림을 보내면 사람이 경보 전체를 무시하게 된다. */
  t('잔여가 0 이면 완주 (알리지 않는다)', H.judgeCron(Array(N + 2).fill(R(0, 0))).status === '완주');
  t('한 번이라도 만들었으면 생산중',
    H.judgeCron([R(12, 3474), ...Array(N + 2).fill(R(0, 3474))]).status === '생산중');
  /* 표본이 적으면 우연히 0 일 수 있다(마침 배치가 다 실패). */
  t('표본이 적으면 판단하지 않는다', H.judgeCron(Array(2).fill(R(0, 100))).status === '표본부족');
  t('신고가 없으면 미신고 (0건이 아니다)', H.judgeCron(Array(N + 2).fill({ ok: true })).status === '미신고');
  /* 잔여를 모르면 완주인지 막힘인지 가를 근거가 없다 — 헛알림 금지. */
  t('잔여를 모르면 막힘이라 부르지 않는다',
    H.judgeCron(Array(N + 2).fill(R(0, null))).status === '잔여미상');

  const f = H.findStalled({
    a: Array(N + 2).fill(R(0, 5)),
    b: Array(N + 2).fill(R(0, null)),
    c: Array(N + 2).fill({ ok: true }),
    d: Array(N + 2).fill(R(0, 0)),
  });
  t('막힌 것만 골라낸다', f.stalled.length === 1 && f.stalled[0].cron === 'a');
  t('미신고·잔여미상은 부채로 따로 센다 (알림 아님)',
    f.silent.join() === 'c' && f.unknown.join() === 'b');

  const many = H.findStalled({
    small: Array(N + 2).fill(R(0, 5)),
    big: Array(N + 2).fill(R(0, 9999)),
  });
  t('잔여가 많은 쪽을 먼저 보여준다', many.stalled[0].cron === 'big');

  const msg = H.buildStalledAlert(many.stalled);
  t('알림에 다음 행동이 적혀 있다', /먼저 볼 것/.test(msg) && /잔여 9999/.test(msg));
  t('막힌 게 없으면 알림을 만들지 않는다', H.buildStalledAlert([]) === null);
}

console.log('\n=== 감시자 배선 ===');
/* 새 크론을 등록하면 호출 예산(2,598/2,600)을 넘긴다. 이미 30분마다 도는
   파이프라인 감시에 얹는다 — 호출 수 증가 0. */
t('pipeline-watch 가 생산량을 본다', /checkProduction/.test(watchSrc));
t('새 크론을 만들지 않았다 (호출 예산 보호)', !/ai-production-watch|cron\/production/.test(watchSrc));
t('note 문자열을 파싱하지 않는다 (문구를 바꿔도 눈이 멀지 않게)',
  /select\('cron_name, produced, remaining, ok, ran_at'\)/.test(watchSrc));
t('쿨다운이 있다 (30분마다 같은 알림 금지)', /PRODUCTION_ALERT_COOLDOWN_H/.test(watchSrc));
t('복구되면 한 번 알린다', /크론 생산 재개/.test(watchSrc));
t('감시 실패가 다른 검사를 막지 않는다',
  /\[pipeline-watch\/production\]/.test(watchSrc));

console.log('\n=== 배포 도달 확인 (2026-09-03 사고) ===');
/* 푸시는 됐는데 배포가 한 시간 넘게 안 걸렸고 아무도 몰랐다. 그동안
   "배포됐다" 고 믿은 것들이 전부 라이브에 없었다. 이 대화의 모든 실패가
   같은 모양이다 — 일은 안 됐는데 아무도 모르는 상태. */
{
  const D = require('../api/_lib/deployReach.js');
  const now = 1_000_000_000;
  const A = '96abc02e07e33f86ea079e5b6622f48917d1645c';
  const B = '4df8d963e92b9768c45594b5d5c04543f85aab08';

  t('같은 커밋이면 일치',
    D.judgeDeployReach({ deployedSha: A, originSha: A, now }).status === '일치');
  t('짧은 해시와 긴 해시를 같게 본다',
    D.judgeDeployReach({ deployedSha: '96abc02', originSha: A, now }).status === '일치');
  /* 한 번의 불일치는 정상이다 — 빌드가 도는 중이다. 지속이 사고다. */
  t('방금 어긋난 것은 배포중 (헛알림 금지)',
    D.judgeDeployReach({ deployedSha: B, originSha: A, now }).status === '배포중');
  t('유예 안이면 배포중',
    D.judgeDeployReach({ deployedSha: B, originSha: A, mismatchSince: now - 5 * 60000, now }).status === '배포중');
  /* 오늘의 사고를 그대로 재현한다. */
  t('60분째 어긋나 있으면 미도달',
    D.judgeDeployReach({ deployedSha: B, originSha: A, mismatchSince: now - 60 * 60000, now }).status === '미도달');

  /* 모르는 걸 사고라고 부르면 헛알림이 되고, 헛알림은 진짜 경보를 죽인다. */
  t('배포 해시를 모르면 판단하지 않는다',
    D.judgeDeployReach({ deployedSha: null, originSha: A, now }).status === '모름');
  t('원격을 못 읽으면 판단하지 않는다',
    D.judgeDeployReach({ deployedSha: A, originSha: null, now }).status === '모름');
  t('7자 미만 해시는 비교로 인정하지 않는다', D.sameSha('96a', '96a') === false);

  const alert = D.buildDeployAlert(
    D.judgeDeployReach({ deployedSha: B, originSha: A, mismatchSince: now - 60 * 60000, now }));
  t('알림에 다음 행동이 적혀 있다', /Redeploy/.test(alert) && /라이브: 4df8d96/.test(alert));
  t('일치일 때는 알림을 만들지 않는다',
    D.buildDeployAlert(D.judgeDeployReach({ deployedSha: A, originSha: A, now })) === null);

  t('pipeline-watch 가 배포 도달을 본다', /checkDeployReach/.test(watchSrc));
  t('라이브 커밋은 빌드 시점 env 에서 읽는다', /VERCEL_GIT_COMMIT_SHA/.test(watchSrc));
  /* 이 검사 하나 때문에 비밀값을 늘리지 않는다 — 저장소가 공개라 비인증으로 읽는다. */
  t('GitHub 토큰을 요구하지 않는다',
    /api\.github\.com/.test(watchSrc) && !/GITHUB_TOKEN|authorization: 'Bearer/.test(watchSrc));
  /* 원격이 바뀌면 다른 사건이다 — 시계를 새로 시작해야 '몇 분째' 가 맞는다. */
  t('원격 HEAD 가 바뀌면 어긋남 시계를 다시 잰다', /sameEpisode/.test(watchSrc));
  t('알림 여부와 무관하게 상태를 갱신한다 (분 계산이 이어지게)',
    /알림 여부와 무관하게 상태는 갱신한다/.test(watchSrc));
  t('새 크론을 만들지 않았다', !/cron\/deploy-reach/.test(watchSrc));
}

console.log('\n=== 첫 신고자 ===');
t('backfill-faq 가 생산량을 신고한다', /reportProduction\(res, \{/.test(faqCron));
t('ko 원본과 영문판을 합쳐 신고한다', /producedTotal/.test(faqCron) && /remainingTotal/.test(faqCron));
t('사람용 note 도 그대로 남긴다', /note: base \+/.test(faqCron));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ production-contract tests passed');
