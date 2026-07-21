/**
 * 감사로그 action 계약 + 예약발행 진단 로직 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * 데일리 진단이 "예약발행 크론 이상, 스케줄러 재시작 권장"을 올렸는데,
 * 파보니 크론은 멀쩡했고 대신 다른 문제 둘이 있었다.
 *
 * ── 문제 1: 코드가 쓰는 값이 DB 제약에 없었다 ────────────────────────
 * release-due-scheduled 크론은 action='auto_published' 로 감사 로그를 남긴다.
 * 그런데 content_audit_log_action_check 는 create/update/delete/publish/
 * unpublish 만 허용했다 → insert 가 100% 거부.
 * 크론이 "한 건 때문에 배치가 멈추면 안 된다"고 예외를 삼키게 돼 있어
 * 오류가 조용히 묻혔다. 실측: auto_published 행 0건, 예약 공개된 26편 전부
 * 감사 기록 없음. 아무도 몰랐다.
 *   → 마이그레이션 092 로 허용값 추가.
 *
 * ── 문제 2: 진단이 크론과 정반대 조건을 봤다 ─────────────────────────
 * 이 시스템에서 "예약" = status='published' + 미래 scheduled_publish_at 이고,
 * 공개 API 가 시각 게이팅을 하므로 시각이 되면 크론과 무관하게 공개된다.
 * 크론이 하는 일은 감사 로그 기록뿐이다.
 * 그런데 옛 scheduled_overdue 체크는 status != 'published' + 시각 경과 를
 * "크론 이상"으로 판정했다 — 크론이 애초에 안 보는 대상이다.
 * 결과: draft 에 옛 예약 시각이 남은 1건("Synthetic Skin", 59일째)이
 * 매일 fail 을 만들었고, 진짜 크론 장애(감사 로그 0건)는 영영 못 잡았다.
 *   → 둘로 분리: 감사로그 누락(fail, 진짜 크론 신호) / 초안 잔여 예약(warn).
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 코드가 쓰는 모든 action 값이 DB CHECK 에 있을 것 (이번 사고의 본질)
 *  2. 진단이 크론과 같은 "예약" 정의를 쓸 것 (반대 조건 부활 금지)
 *  3. AI 진단 프롬프트가 옛 오해를 다시 주입하지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

console.log('\n=== 1. 코드가 쓰는 action 이 DB CHECK 안에 있는가 ===');
/* 허용값은 마이그레이션에서 읽는다 — 테스트에 숫자를 박아두면
   제약이 바뀔 때 테스트만 옛 사실을 지키게 된다. */
const migDir = path.join(ROOT, 'supabase_migrations');
const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
let allowed = null, allowedFrom = null;
for (const f of migFiles) {
  /* 주석(-- …)을 먼저 걷어낸다. 마이그레이션 헤더에 "되돌리기" 예시로 옛
     CHECK 문을 적어두는데, 그걸 실제 제약으로 오독하면 테스트가 옛 허용값을
     읽고 통과해버린다 (이 테스트를 처음 돌렸을 때 실제로 그렇게 됐다). */
  const sql = fs.readFileSync(path.join(migDir, f), 'utf8')
    .split('\n').filter((ln) => !ln.trim().startsWith('--')).join('\n');
  const m = sql.match(/content_audit_log_action_check[\s\S]*?CHECK\s*\(([\s\S]*?)\);/i);
  if (m) {
    const vals = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    if (vals.length) { allowed = new Set(vals); allowedFrom = f; }
  }
}
t('마이그레이션에서 허용 action 목록을 읽었다 (' + (allowedFrom || '없음') + ')', !!allowed,
  'content_audit_log_action_check 를 정의하는 마이그레이션이 있어야 한다');

if (allowed) {
  t("허용 목록에 'auto_published' 가 있다 (이번 사고의 직접 원인)",
    allowed.has('auto_published'),
    '허용값: ' + [...allowed].join(', '));

  /* recordContentChange 를 쓰는 파일에서 action 리터럴을 모은다.
     `action: 'x'` 와 `action = 'x'` 두 형태 모두 실제로 쓰이고 있다. */
  const used = new Map();
  for (const f of walk(path.join(ROOT, 'api'))) {
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes('recordContentChange')) continue;
    for (const m of src.matchAll(/\baction\s*[:=]\s*'([a-z_]+)'/g)) {
      if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, f));
    }
  }
  t('감사로그 action 리터럴을 수집했다 (' + used.size + '종)', used.size > 0);
  const illegal = [...used.entries()].filter(([a]) => !allowed.has(a));
  t('코드가 쓰는 action 이 전부 허용 목록 안에 있다',
    illegal.length === 0,
    illegal.map(([a, f]) => `'${a}' (${f})`).join(', ') +
    ' — insert 가 조용히 거부된다. CHECK 확장 마이그레이션을 함께 넣을 것');
}

console.log('\n=== 2. 진단이 크론과 같은 "예약" 정의를 쓰는가 ===');
const cron = fs.readFileSync(path.join(ROOT, 'api/cron/release-due-scheduled.js'), 'utf8');
const audit = fs.readFileSync(path.join(ROOT, 'api/_lib/growthAudit.js'), 'utf8');

t("크론은 status='published' 인 행만 예약 대상으로 본다",
  /\.eq\('status',\s*'published'\)/.test(cron),
  '이게 이 시스템의 "예약" 정의다');

/* 해당 check 의 본문만 잘라낸다 — 시작 지점부터 "다음 check(" 직전까지.
   처음엔 고정 길이(1400자) 창을 썼는데, 창이 옆 항목까지 삼켜서 이웃의
   status:'warn' 을 이 항목 것으로 오인해 통과했다(역검증에서 발각).
   경계를 항목 단위로 잡아야 이웃 코드에 기대는 일이 없다. */
function checkBody(id) {
  const i = audit.indexOf("check('" + id + "'");
  if (i < 0) return '';
  const next = audit.indexOf("check('", i + 8);
  return audit.slice(i, next > i ? next : audit.length);
}
const auditMissing = checkBody('scheduled_release_audit_missing');
t('감사로그 누락 체크가 존재한다', auditMissing.length > 0);
t("감사로그 누락 체크가 크론과 같은 status='published' 를 본다",
  /\.eq\('status',\s*'published'\)/.test(auditMissing),
  "neq('status','published') 로 되돌아가면 크론이 안 보는 대상을 감시하게 된다");
t('감사로그 누락 체크가 content_audit_log 를 대조한다',
  /content_audit_log/.test(auditMissing) && /auto_published/.test(auditMissing));
t('감사로그 누락만 fail 로 올린다', /status:\s*miss\.length === 0 \? 'ok' : 'fail'/.test(auditMissing));

const staleDraft = checkBody('scheduled_stale_draft');
t('초안 잔여 예약 체크가 별도로 존재한다', staleDraft.length > 0);
t('초안 잔여 예약은 warn 이다 (인프라 장애가 아님)',
  /status:\s*v === 0 \? 'ok' : 'warn'/.test(staleDraft),
  'draft 에 남은 옛 예약 시각으로 fail 을 띄우면 매일 오탐이 난다');
t('옛 scheduled_overdue 체크가 되살아나지 않았다',
  !/check\('scheduled_overdue'/.test(audit));

console.log('\n=== 3. AI 진단 프롬프트가 옛 오해를 주입하지 않는가 ===');
const prompt = fs.readFileSync(path.join(ROOT, 'api/cron/daily-growth-feedback.js'), 'utf8');
t("프롬프트에 'scheduled_overdue fail = 예약발행 크론 이상' 단정이 없다",
  !/scheduled_overdue fail\s*=\s*예약발행 크론 이상/.test(prompt),
  '이 한 줄 때문에 진단이 멀쩡한 크론에 "스케줄러 재시작"을 권고했다');
t('새 항목명을 프롬프트가 알고 있다',
  /scheduled_release_audit_missing/.test(prompt) && /scheduled_stale_draft/.test(prompt));
t('공개는 시각 게이팅이라 발행 지연이 아니라는 점을 명시한다',
  /시각 게이팅/.test(prompt));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ audit-action-contract tests FAILED'); process.exit(1); }
console.log('✅ audit-action-contract tests passed');
