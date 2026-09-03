/**
 * 규칙이 두 벌이면 한쪽만 고쳐진다 — 확산 금지 가드 (2026-09-03 신설)
 *
 * GROWTH-LEDGER 교훈 2 가 이 저장소에서 가장 비싸게 재발하는 항목이다.
 * 2026-08-28 에 그 대가를 정확히 치렀다:
 *
 *   JSON 배열 파서가 **세 벌**이었다
 *     jsonRepair.parseJsonArray            네 칸 (2026-08-25 '덩어리 고르기' 포함)
 *     seoTranslateBackfill.parseJsonArray  세 칸 (번역 배치 전용)
 *     각 백필의 자체 정규식                 (indexOf('[') ~ lastIndexOf(']'))
 *   "공용 계단으로 통일" 했다고 커밋했는데 통일한 대상이 세 칸짜리였고,
 *   라이브에서 [형태불명] 으로 죽었다. 하루를 썼다.
 *
 *   콜 예산 산술이 **세 곳**에 각자 있었다
 *     Math.max(20000, deadline - Date.now() - 5000)
 *   같은 타임아웃 버그를 하루에 세 번 밟았다.
 *
 * ■ 이 테스트의 방침 — 부채를 **고정**하고 확산을 막는다
 * 기존 복제를 지금 전부 이관하면 무관한 기능(화보 생성·셀럽 분류·번역 배치)의
 * 동작을 한 커밋에서 바꾸게 된다. 그건 이 저장소가 경계하는 묶음 변경이다.
 * 대신 **현재 목록을 ALLOW 에 못박고, 늘어나면 깨진다.** 목록은 줄기만 한다.
 * (no-eager-npm-deps.test.js 가 쓰는 방식과 같다.)
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '\n     ' + extra : '')); }
}

const ROOT = path.resolve(__dirname, '..');

/** api/ 아래 .js 를 전부 훑는다 (node_modules 제외). */
function walk(dir, out = []) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, f);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) { if (!/node_modules/.test(f)) walk(rel, out); continue; }
    if (/\.js$/.test(f)) out.push(rel);
  }
  return out;
}
const FILES = walk('api');

/* ────────────────────────────────────────────────────────────────
 * ① JSON 배열/객체를 손으로 잘라내는 코드
 *
 * indexOf('[') ~ lastIndexOf(']') 방식은 모델이 **답을 하나만** 낸다고 전제한다.
 * 실제로는 뒤에 대괄호 섞인 산문이 붙거나 배열을 두 번 내놓는다. 그때 죽는다.
 * 정본은 api/_lib/jsonRepair.js 하나다 (네 칸 계단 + 덩어리 고르기).
 * ──────────────────────────────────────────────────────────────── */
const SLICE_RX = /lastIndexOf\(\s*['"][\]}]['"]\s*\)/;

/* 이관 대기 부채. **이 목록에 새로 추가하지 말 것** — 줄이기만 한다.
   각 항목은 "왜 아직 안 옮겼나" 를 적는다. */
const PARSER_DEBT = {
  'api/_lib/jsonRepair.js': '정본 — 여기가 그 계단이다',
  'api/_lib/seoTranslateBackfill.js':
    '번역 배치 전용 계약(살리기·센티넬)이 얽혀 있다. jsonRepair 헤더가 "건드리지 않는다" 고 명시',
  'api/_lib/editorialAi.js': '미이관 — 화보 생성 경로. 옮길 때 그 기능 테스트와 함께',
  'api/_lib/titleRepair.js': '미이관 — 제목 보수 경로',
  'api/cron/celeb-classify.js': '미이관 — 셀럽 분류 경로',
  'api/cron/backfill-translations.js': '미이관 — 번역 크론. 이 가드가 처음 알려 줬다',
};

console.log('=== ① JSON 을 손으로 자르는 코드 (정본: jsonRepair.js) ===');
{
  const found = FILES.filter((f) => SLICE_RX.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const newcomers = found.filter((f) => !PARSER_DEBT[f]);
  t('허용 목록 밖에서 새로 손파싱하지 않는다', newcomers.length === 0,
    newcomers.join(' · ') + '\n     → jsonRepair 의 parseJsonArray / parseJsonObject 를 쓸 것.'
    + '\n     → 정말 예외라면 PARSER_DEBT 에 이유를 적고 추가하되, 그건 부채가 는다는 뜻이다.');

  /* 목록은 줄기만 한다. 이관이 끝난 항목이 남아 있으면 알려 준다. */
  const stale = Object.keys(PARSER_DEBT).filter((f) => !found.includes(f));
  t('허용 목록에 죽은 항목이 없다 (이관 끝났으면 목록에서 빼기)', stale.length === 0, stale.join(' · '));

  const debt = found.filter((f) => /미이관/.test(PARSER_DEBT[f] || ''));
  console.log('  · 남은 이관 부채 ' + debt.length + '건: ' + debt.join(' · '));
}

/* ────────────────────────────────────────────────────────────────
 * ② 콜 예산 산술을 손으로 쓰는 코드
 *
 * "남은 시간이 한 콜보다 짧은데 콜을 시작" 하면 타임아웃으로 죽는다 —
 * 돈은 나가고 데이터는 0이다. 문턱·상한은 api/_lib/callBudget.js 한 벌이다.
 * ──────────────────────────────────────────────────────────────── */
/* 실제 코드 모양을 잡는다:
     deadline - Date.now() - 5000     콜 예산 계산
     deadline - START_FLOOR_MS        시작 문턱 비교
     deadline - 20000                 상수 직접
   `deadline - now` (인증 만료까지 남은 시간 등)은 콜 예산이 아니므로 제외한다.
   첫 판에서 `\d{4,}` 만 봤다가 위 셋을 하나도 못 잡고 **헛통과**했다 —
   가드가 통과하는데 아무것도 안 지키는 게 가장 나쁘다. */
const BUDGET_RX = /deadline\s*-\s*(Date\.now\(\)|[A-Z][A-Z0-9_]*_MS|\d{4,})/;

const BUDGET_DEBT = {
  'api/_lib/callBudget.js': '정본 (헤더 주석의 예시 코드 포함)',
  'api/_lib/faqEnBackfill.js': '미이관 — 파도(wave) 구조라 문턱 의미가 조금 다르다',
  'api/_lib/editorialFaqI18nBackfill.js':
    '미이관 — 직전 파도 실측(lastWaveMs*1.15)으로 적응하는 로직이 붙어 있다',
};

console.log('\n=== ② 콜 예산을 손으로 계산하는 코드 (정본: callBudget.js) ===');
{
  const found = FILES.filter((f) => BUDGET_RX.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const newcomers = found.filter((f) => !BUDGET_DEBT[f]);
  t('허용 목록 밖에서 새로 예산 산술을 쓰지 않는다', newcomers.length === 0,
    newcomers.join(' · ') + '\n     → callBudget 의 canStart(deadline, kind) / budgetFor(deadline, kind) 를 쓸 것.');

  const stale = Object.keys(BUDGET_DEBT).filter((f) => !found.includes(f));
  t('허용 목록에 죽은 항목이 없다', stale.length === 0, stale.join(' · '));

  const debt = found.filter((f) => /미이관/.test(BUDGET_DEBT[f] || ''));
  console.log('  · 남은 이관 부채 ' + debt.length + '건: ' + debt.join(' · '));
}

/* ────────────────────────────────────────────────────────────────
 * ③ callBudget 자체가 실제로 맞게 도는지 (돌려서 검사한다)
 * ──────────────────────────────────────────────────────────────── */
console.log('\n=== ③ callBudget 동작 ===');
{
  const B = require('../api/_lib/callBudget.js');
  const now = 1_000_000;

  t('여유가 충분하면 시작한다', B.canStart(now + 60000, 'ai', now) === true);
  /* 2026-08-28 'es' 사고: 20초 남았는데 콜을 시작해 타임아웃으로 죽었다. */
  t('20초 남았으면 ai 콜을 시작하지 않는다', B.canStart(now + 20000, 'ai', now) === false);
  /* 2026-08-30: 웹검색 콜은 60초로도 모자랐다 — 문턱이 ai 보다 훨씬 높아야 한다. */
  t('검색 콜 문턱이 일반 ai 보다 높다', B.floorFor('ai-search') > B.floorFor('ai'));
  t('60초 남았으면 검색 콜을 시작하지 않는다', B.canStart(now + 60000, 'ai-search', now) === false);
  t('모르는 종류는 ai 로 취급한다 (조용히 0 을 주지 않는다)',
    B.floorFor('처음보는것') === B.FLOOR_MS.ai);

  t('예산이 남은 시간을 넘지 않는다', B.budgetFor(now + 40000, 'ai', now) <= 40000);
  /* 콜은 성공했는데 저장할 시간이 없어 죽는 것을 막는다. */
  t('마무리 여유를 남긴다', B.budgetFor(now + 40000, 'ai', now) <= 40000 - B.RESERVE_MS);
  t('종류별 상한을 넘지 않는다', B.budgetFor(now + 999999, 'ai', now) === B.CAP_MS.ai);
  t('예산은 음수가 되지 않는다', B.budgetFor(now - 10000, 'ai', now) > 0);
}

/* ────────────────────────────────────────────────────────────────
 * ④ 세션 충돌 차단 훅 (2026-08-28 커밋 오염 2건)
 * ──────────────────────────────────────────────────────────────── */
console.log('\n=== ④ 무차별 스테이징 차단 훅 ===');
{
  const hook = fs.readFileSync(path.join(ROOT, '.claude/hooks/block-push.sh'), 'utf8');
  t('git add -A / -u 를 막는다', /add\[\[:space:\]\]\+\(-A\|--all\|-u\|--update\)/.test(hook));
  t('git add . 을 막는다', /add\[\[:space:\]\]\+\\\.\(/.test(hook));
  t('git commit -a 를 막는다', /commit\[\[:space:\]\]\+\(-\[a-zA-Z\]\*a/.test(hook));
  t('왜 막는지 사람에게 설명한다 (규칙만 던지지 않는다)',
    /여러 세션이 동시에 작업한다/.test(hook) && /파일을 명시할 것/.test(hook));
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
  const wired = JSON.stringify(settings.hooks || {}).includes('block-push.sh');
  t('훅이 settings.json 에 배선돼 있다 (파일만 있고 안 걸리면 무의미)', wired);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ no-duplicate-rules tests passed');
