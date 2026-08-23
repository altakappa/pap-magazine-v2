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

console.log('\n셀럽 계정 감시: ' + n + '건 통과');
