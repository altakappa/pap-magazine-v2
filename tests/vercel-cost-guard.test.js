/**
 * Vercel 비용 가드 하네스 (2026-08-22 신설)
 *
 * ■ 왜 생겼나 (실제 청구서)
 *   3개월 평균 $43  →  7/7~8/7 $107.83  →  8/7~8/22(15일) $102.27
 *   두 사이클 연속으로 평균의 2.5배다. 일시적 스파이크가 아니다.
 *
 * Vercel 은 **일을 했느냐가 아니라 함수를 몇 번 켰고 몇 초 돌았느냐**로 청구한다.
 * 실제로 backfill-translations 는 하루 720번 켜져서 "처리 대상 없음"을 720번
 * 확인하고 962초를 썼다. 큐가 비어 있어도 청구는 그대로다.
 *
 * ■ 이 하네스가 지키는 두 가지
 *   ① 크론 호출 예산 — 하루 총 호출이 상한을 넘으면 깨진다.
 *      주기를 좁히는 변경은 쉽고(한 글자), 청구서는 한 달 뒤에 온다.
 *      그 사이를 메우는 것이 이 검사다.
 *   ② robots.txt 학습봇 차단의 **형태** — 이름 그룹은 반드시 전면 차단이어야
 *      하고, 유입을 만드는 봇에는 이름 그룹이 있으면 안 된다.
 *
 * ■ ②가 왜 형태까지 보나 (2026-07-28 사고)
 *   robots.txt 규격상 크롤러는 자기 이름 그룹이 있으면 **그 그룹만** 읽고
 *   `*` 그룹의 Disallow 를 전부 무시한다. 그래서
 *     - 학습봇 이름 그룹에 부분 차단을 쓰면 → /admin·/auth·/api 차단이 풀린다
 *     - live·index 봇에 이름 그룹을 만들면  → 같은 사고가 그 봇들에게 난다
 *   실제로 그 실수로 구글이 /auth?return=... 을 1,807건 수집했다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const robots = fs.readFileSync(path.join(ROOT, 'frontend/robots.txt'), 'utf8');

/* ── 크론 하루 실행 횟수 ─────────────────────────────────────────
   분·시 필드만 본다. 일·월·요일이 제한되면 실제 횟수는 이보다 적으므로
   이 값은 **상한**이다. 예산 검사에는 상한이 맞다. */
function expand(field, max) {
  if (field === '*') return Array.from({ length: max }, (_, i) => i);
  const out = new Set();
  for (const part of String(field).split(',')) {
    let m;
    if ((m = /^\*\/(\d+)$/.exec(part))) { for (let i = 0; i < max; i += +m[1]) out.add(i); }
    else if ((m = /^(\d+)-(\d+)\/(\d+)$/.exec(part))) { for (let i = +m[1]; i <= +m[2]; i += +m[3]) out.add(i); }
    else if ((m = /^(\d+)-(\d+)$/.exec(part))) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); }
    else if (/^\d+$/.test(part)) out.add(+part);
  }
  return [...out];
}
function perDay(schedule) {
  const f = String(schedule).trim().split(/\s+/);
  if (f.length < 5) return 0;
  const dom = f[2], dow = f[4];
  let days = 1;
  if (dom === '*' && dow !== '*') days = expand(dow, 7).length / 7;
  else if (dom !== '*' && dow === '*') days = expand(dom, 31).length / 31;
  return expand(f[0], 60).length * expand(f[1], 24).length * days;
}

console.log('\n[1] 크론 하루 호출 예산');
const rows = (vj.crons || []).map((c) => ({ path: c.path, sched: c.schedule, n: perDay(c.schedule) }))
  .sort((a, b) => b.n - a.n);
const total = rows.reduce((a, r) => a + r.n, 0);

/* 상한 근거: 2026-08-22 정리 직후 실측 계산값이 약 2,200회다.
   여유 15% 를 두고 2,600 으로 잡는다. 새 크론을 넣거나 주기를 좁히려면
   이 숫자를 **의도적으로** 올려야 한다 — 그게 이 검사의 목적이다. */
const BUDGET = 2600;
t('하루 총 크론 호출이 예산 이하 (' + Math.round(total) + ' / ' + BUDGET + ')',
  total <= BUDGET, rows.slice(0, 6).map((r) => r.path + '=' + Math.round(r.n)).join(' · '));

/* 개별 상한 — 한 크론이 혼자 예산을 먹지 않게 */
const TOP = 200;
const hogs = rows.filter((r) => r.n > TOP);
t('하루 ' + TOP + '회를 넘는 크론이 없다', hogs.length === 0,
  hogs.map((r) => r.path + '=' + Math.round(r.n) + ' (' + r.sched + ')').join(' · '));

/* 2026-08-22 에 실제로 줄인 것들이 되돌아가지 않았는지 */
console.log('\n[2] 2026-08-22 절감분이 되돌아가지 않았다');
const CAPS = {
  '/api/cron/backfill-translations': 100,
  '/api/cron/competitor-watch': 24,
  '/api/cron/celeb-watch': 80,
  '/api/cron/release-due-scheduled': 150,
  '/api/cron/backfill-embeddings': 60,
  '/api/cron/backfill-faq': 60,
  /* backfill-meta-desc 도 건드리지 않았다 (2026-08-22).
     tests/backfill-meta-desc.test.js 가 '10분 주기 등록' 을 단정한다.
     절감분은 하루 96회 = 예산의 4.7%. 같은 이유로 남의 가드를 안 푼다.
     정리하려면 그 하네스의 의도(등재 확인)와 수단(/10)을 먼저 분리할 것. */
  /* migrate-external-images 는 건드리지 않았다 (2026-08-22).
     잔량은 실측 0건이라 6시간 주기로 낮춰도 기능상 문제가 없다.
     그런데 tests/image-check-honesty.test.js 가 '30분 또는 매시' 를
     의도적으로 못박아 뒀고(2026-07-28 사고 재발 방지), 절감분은
     하루 44회 = 전체 예산의 2% 다. 남의 가드를 2% 때문에 풀지 않는다. */
};
for (const [p, cap] of Object.entries(CAPS)) {
  const r = rows.find((x) => x.path === p);
  t(p.replace('/api/cron/', '') + ' ≤ ' + cap + '회/일',
    !!r && r.n <= cap, r ? Math.round(r.n) + ' (' + r.sched + ')' : '크론 없음');
}

/* ── robots.txt ─────────────────────────────────────────────── */
console.log('\n[3] robots.txt — 학습봇은 전면 차단');

/** User-agent 이름 → 그 그룹의 규칙 줄 배열 */
function groups(txt) {
  const g = new Map();
  let cur = [];
  for (const line of txt.split('\n')) {
    const s = line.replace(/#.*$/, '').trim();
    if (!s) continue;
    const m = /^User-agent:\s*(.+)$/i.exec(s);
    if (m) {
      const name = m[1].trim();
      if (!g.has(name)) g.set(name, []);
      cur = g.get(name);
      continue;
    }
    if (cur) cur.push(s);
  }
  return g;
}
const G = groups(robots);

const TRAIN = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Amazonbot',
  'Bytespider', 'meta-externalagent', 'CCBot'];
for (const bot of TRAIN) {
  const rules = G.get(bot);
  const blocked = !!rules && rules.some((r) => /^Disallow:\s*\/$/i.test(r));
  const onlyBlock = !!rules && !rules.some((r) => /^Allow:/i.test(r));
  t(bot + ' 전면 차단', blocked && onlyBlock, rules ? rules.join(' | ') : '그룹 없음');
}

console.log('\n[4] 유입을 만드는 봇에는 이름 그룹이 없다 (* 규칙을 잃지 않게)');
const KEEP = ['ChatGPT-User', 'OAI-SearchBot', 'PerplexityBot', 'Perplexity-User',
  'Claude-User', 'Claude-SearchBot', 'Google-Extended', 'Googlebot', 'bingbot', 'Yeti'];
for (const bot of KEEP) {
  t(bot + ' 이름 그룹 없음', !G.has(bot), G.get(bot));
}

console.log('\n[5] * 그룹의 기존 차단이 살아 있다');
const star = G.get('*') || [];
for (const p of ['/admin', '/auth', '/mypage', '/api/', '/go/']) {
  t('* 그룹이 ' + p + ' 차단', star.some((r) => new RegExp('^Disallow:\\s*' + p.replace(/\//g, '\\/')).test(r)), star.join(' | ').slice(0, 200));
}
t('* 그룹이 전면 차단이 아니다 (사이트가 색인돼야 한다)',
  !star.some((r) => /^Disallow:\s*\/$/i.test(r)), star.join(' | ').slice(0, 200));
t('사이트맵이 남아 있다', /^Sitemap:\s*https:\/\//m.test(robots));

console.log('\n' + (fail === 0 ? '✅' : '❌') + '  통과 ' + pass + ' / 실패 ' + fail);
process.exit(fail === 0 ? 0 : 1);
