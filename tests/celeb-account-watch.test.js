/**
 * 셀럽 계정 자동 감시 — 07-20 스팸(144건) 재발 방지 장치가 소스에 실재하는지.
 * 도메니코 2026-08-23: "자동 감지로 바꿔라" — 단, 발행은 여전히 "올려"만.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const assert = require('assert');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const SRC = R('api/cron/celeb-account-watch.js');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const VERCEL = JSON.parse(R('vercel.json'));

t('크론이 등록돼 있고 celeb-brief(:00 주기)와 어긋난다', () => {
  const c = (VERCEL.crons || []).find((x) => x.path === '/api/cron/celeb-account-watch');
  assert.ok(c, 'vercel.json 에 크론이 없다');
  assert.strictEqual(c.schedule, '12,32,52 * * * *');
});

t('함수 상한이 글롭으로 보장된다 (12계정 폴링이 기본 상한에서 죽지 않게)', () => {
  /* 2026-08-23 배포 사고: 전용 functions 항목을 api 전체 글롭 뒤에 추가하자
     Vercel 이 "pattern doesn't match any Serverless Functions" 로 빌드를 거부했다
     (배포 2건 연속 Error). 글롭이 이미 maxDuration 120 을 주므로 전용 항목은
     불필요했다 — 중복 항목을 다시 넣으면 같은 사고가 재발한다. */
  const glob = VERCEL.functions['api/**/*.js'];
  assert.ok(glob && glob.maxDuration >= 60, '글롭 상한이 사라졌다');
  assert.ok(!VERCEL.functions['api/cron/celeb-account-watch.js'],
    '전용 항목이 다시 생겼다 — 글롭 뒤 중복 항목은 Vercel 빌드를 깨뜨린다');
});

t('기준선 장치 — 첫 폴링은 브리프를 만들지 않는다', () => {
  assert.ok(/baseline_done/.test(CODE), '기준선 개념이 없다 — 07-20 스팸이 재발한다');
  assert.ok(/out\.baselined\+\+;\s*continue;/.test(CODE), '기준선에서 continue 하지 않는다');
});

t('신선도 장치 — 24시간 지난 게시물은 브리프 없이 seen 처리', () => {
  assert.ok(/FRESH_MS = 24 \* 3600 \* 1000/.test(SRC));
  assert.ok(/Date\.now\(\) - m\.ts > FRESH_MS/.test(CODE));
});

t('상한 장치 — 실행당 브리프 4건, 초과분은 seen 에 안 넣는다', () => {
  assert.ok(/MAX_BRIEFS = 4/.test(SRC));
  assert.ok(/briefBudget <= 0\) continue;/.test(CODE), '상한 초과가 seen 처리되면 영영 못 잡는다');
});

t('중복 이중 방어 — seen PK + 큐 (batch_key,shortcode)', () => {
  assert.ok(/onConflict: 'username,shortcode'/.test(CODE));
  assert.ok(/onConflict: 'batch_key,shortcode'/.test(CODE));
});

t('자동 발행 경로가 없다 — 큐 적재까지만 (발행은 "올려"만)', () => {
  assert.ok(!/publishReel|publishPhotos|media_publish|igPublish/.test(CODE),
    '감시 크론에 발행 코드가 있다 — 절대 규칙 위반');
  assert.ok(/status: 'queued'/.test(CODE), '기존 브리프 흐름(queued)에 태우지 않는다');
});

t('계정 오류가 크론을 죽이지 않고 last_error 에 남는다', () => {
  assert.ok(/last_error: String/.test(CODE));
  assert.ok(/continue;/.test(CODE));
});

t('마이그레이션 파일이 저장소에 남아 있다', () => {
  const mig = R('supabase_migrations/093_celeb_account_watch.sql');
  assert.ok(/celeb_watch_accounts/.test(mig) && /celeb_account_seen/.test(mig));
  assert.ok((mig.match(/\('[a-z0-9._]+','/g) || []).length >= 12, '시드 12계정이 없다');
});

/* ── 조용한 죽음 회귀 (2026-09-10 추가) ──────────────────────────────
 *
 * 실측 사고: 이 크론은 2026-08-24 신설 이후 1,247회 실행에서 폴링 0회였다.
 * 실패는 0건. 09-01 20:12 에 12개 계정이 전부 enabled=false 가 됐고, 그때부터
 * 목록 조회가 빈 배열을 주니 루프가 안 돌았다. 매번 ok=true · polled 0 이다.
 *
 * pipeline-watch 의 checkProduction 이 "돌았는데 생산 0" 을 이미 잡는데도
 * 못 잡은 이유는 하나다 — 이 크론이 produced/remaining 을 **신고하지 않아서**
 * 판정 대상('미신고')에서 빠져 있었다. 감시가 없었던 게 아니라 신고가 없었다.
 *
 * 그래서 이 테스트가 지키는 것은 두 가지다:
 *   ① 신고를 한다 (안 하면 다시 감시 사각지대로 돌아간다)
 *   ② 신고한 숫자가 실제 판정기를 통과했을 때 옳은 답을 낸다 —
 *      특히 '전부 꺼짐' 이 '완주' 로 오인되지 않을 것. 이게 핵심이다. */
const { judgeCron, MIN_ZERO_RUNS } = require('../api/_lib/productionHealth');

t('생산량을 신고한다 — 안 하면 checkProduction 의 사각지대로 돌아간다', () => {
  assert.ok(/reportProduction/.test(CODE),
    'reportProduction 신고가 없다 — 미신고 크론은 "모른다"로 분류돼 영원히 조용하다');
  assert.ok(/produced: out\.queued/.test(CODE), '생산량이 큐 적재 건수가 아니다');
  assert.ok(/remaining: unwatched/.test(CODE),
    '잔여가 "안 보고 있는 계정 수"가 아니다 — 이 정의라야 전부 꺼진 상태가 잡힌다');
});

t('전부 비활성이면 목록이 빈 것과 구분된다 (조회에서 안 거르고 코드에서 가른다)', () => {
  assert.ok(!/\.eq\('enabled',\s*true\)/.test(CODE),
    "조회에서 enabled 를 걸러내면 '원래 없음'과 '전부 꺼짐'이 똑같이 빈 배열이 된다");
  assert.ok(/unwatched\s*=\s*totalAccounts\s*-\s*accounts\.length/.test(CODE));
});

t('판정기: 전부 꺼진 상태는 막힘으로 잡힌다 (완주로 새지 않는다)', () => {
  /* 지금 프로덕션 상태 그대로: 큐 0건이 계속되고, 안 보는 계정이 12개. */
  const runs = Array.from({ length: MIN_ZERO_RUNS + 2 },
    () => ({ produced: 0, remaining: 12, ok: true }));
  assert.strictEqual(judgeCron(runs).status, '막힘',
    '전부 비활성인데 조용하다 — 09-01 사고가 그대로 재발한다');
});

t('판정기: 정상(전부 켜짐·새 글 없음)은 조용하다 — 헛알림이 감시를 죽인다', () => {
  const runs = Array.from({ length: MIN_ZERO_RUNS + 2 },
    () => ({ produced: 0, remaining: 0, ok: true }));
  assert.strictEqual(judgeCron(runs).status, '완주');
});

t('판정기: 큐를 적재하고 있으면 생산중', () => {
  const runs = [{ produced: 2, remaining: 0, ok: true },
    { produced: 0, remaining: 0, ok: true }];
  assert.strictEqual(judgeCron(runs).status, '생산중');
});

console.log('\n셀럽 계정 감시: ' + n + '건 통과');
