'use strict';
/**
 * 뉴스레터 발송이 Gmail 에 막히지 않게 (2026-09-25).
 *
 * 실측: 주간 뉴스레터 816통 중 191통(23%) 실패. 오류는 두 종류뿐 —
 *   421 4.3.0 Temporary System Problem (158) · 454 4.7.0 Too many login attempts (33).
 * 원인: 풀 없는 트랜스포터에 50통을 동시에 던져 메일마다 새 연결·새 로그인.
 *
 *  1. email.js 트랜스포터: 연결 풀(2) + 초당 4통
 *  2. 발송기: 한 번에 5명씩(50 아님), 300초 함수
 *  3. 일시 오류가 두 번 나면 기록하지 않고 끝에서 30초 뒤 1회 더 — 실제로 돌려 본다
 *     (가짜 supabase · 가짜 sendEmail, 타이머는 즉시)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

console.log('=== 1. 트랜스포터 ===');
const em = R('api/_lib/email.js');
t('pool: true', /pool: true/.test(em));
t('연결 2개', /maxConnections: 2/.test(em));
t('초당 4통 (rateDelta 1000 · rateLimit 4)', /rateDelta: 1000/.test(em) && /rateLimit: 4/.test(em));

console.log('\n=== 2. 발송기 설정 ===');
const src = R('api/cron/send-due-campaigns.js');
t('한 번에 5명', /const BATCH_SIZE = 5;/.test(src));
const vj = JSON.parse(R('vercel.json'));
t('함수 시간 300초 (정확한 파일명 키)', vj.functions['api/cron/send-due-campaigns.js'] && vj.functions['api/cron/send-due-campaigns.js'].maxDuration === 300);
const keys = Object.keys(vj.functions);
t('와일드카드보다 앞', keys.indexOf('api/cron/send-due-campaigns.js') < keys.indexOf('api/**/*.js'));

console.log('\n=== 3. 실제로 돌려 본다 ===');
(async () => {
  const logs = [];
  const campaignUpdates = [];
  const users = [
    { id: 'u1', email: 'ok@x.com', email_language: 'en', subscription_plan: 'free', subscription_status: 'inactive' },
    { id: 'u2', email: 'flaky@x.com', email_language: 'en', subscription_plan: 'free', subscription_status: 'inactive' },
    { id: 'u3', email: 'dead@x.com', email_language: 'en', subscription_plan: 'free', subscription_status: 'inactive' },
    { id: 'u4', email: 'always421@x.com', email_language: 'en', subscription_plan: 'free', subscription_status: 'inactive' },
  ];
  const campaign = { id: 'c1', type: 'news-weekly', status: 'scheduled', payload: {} };
  function q(table) {
    const st = { table, op: 'select', payload: null };
    const b = {
      select() { return b; }, eq() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; }, not() { return b; },
      update(p) { st.op = 'update'; st.payload = p; if (table === 'email_campaigns') campaignUpdates.push(p); return b; },
      insert(p) { st.op = 'insert'; st.payload = p; if (table === 'email_log') logs.push(p); return b; },
      single() { return Promise.resolve(resolve()); },
      then(ok, bad) { return Promise.resolve(resolve()).then(ok, bad); },
    };
    function resolve() {
      if (table === 'email_campaigns' && st.op === 'select') return { data: [campaign], error: null };
      if (table === 'email_campaigns' && st.op === 'update') return { data: { id: 'c1' }, error: null };
      if (table === 'email_unsubscribe_tokens') return { data: { token: 'tok' }, error: null };
      if (table === 'profiles') return { data: users, error: null };
      return { data: null, error: null };
    }
    return b;
  }
  const calls = {};
  function fakeSend(to) {
    calls[to] = (calls[to] || 0) + 1;
    if (to === 'ok@x.com') return Promise.resolve({ sent: true });
    if (to === 'flaky@x.com') return Promise.resolve(calls[to] <= 2 ? { sent: false, error: '421 4.3.0 Temporary System Problem' } : { sent: true });
    if (to === 'dead@x.com') return Promise.resolve({ sent: false, error: '550 5.1.1 No such user' });
    return Promise.resolve({ sent: false, error: '454 4.7.0 Too many login attempts' });
  }
  const stub = (rel, exp) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
  stub('api/_lib/supabase.js', { supabaseAdmin: { from: q } });
  stub('api/_lib/email.js', { sendEmail: fakeSend, templates: { weeklyNews: () => ({ subject: 's', html: 'h' }) } });
  stub('api/_lib/cronGuard.js', { withCronGuard: (_n, fn) => fn });
  stub('api/_lib/cors.js', { handleCors: () => false });
  const realST = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };   // 5초·30초 대기를 건너뛴다
  process.env.CRON_SECRET = 'sek';
  const handler = require(path.join(ROOT, 'api/cron/send-due-campaigns.js'));
  let out = null;
  const res = { status() { return this; }, json(o) { out = o; return this; } };
  try { await handler({ method: 'GET', headers: { authorization: 'Bearer sek' } }, res); }
  finally { global.setTimeout = realST; }
  const byEmail = {};
  logs.forEach((l) => { (byEmail[l.email] = byEmail[l.email] || []).push(l.status); });
  t('정상 주소: 1번 보내고 sent 1줄', calls['ok@x.com'] === 1 && String(byEmail['ok@x.com']) === 'sent', JSON.stringify(byEmail));
  t('일시 오류 2번 → 늦은 재시도로 성공, 기록은 sent 1줄', calls['flaky@x.com'] === 3 && String(byEmail['flaky@x.com']) === 'sent', calls['flaky@x.com'] + ' ' + byEmail['flaky@x.com']);
  t('영구 오류(550): 재시도 없이 failed 1줄', calls['dead@x.com'] === 1 && String(byEmail['dead@x.com']) === 'failed');
  t('계속 일시 오류: 정확히 3번 시도 후 failed 1줄 (무한 재시도 없음)', calls['always421@x.com'] === 3 && String(byEmail['always421@x.com']) === 'failed');
  const last = campaignUpdates[campaignUpdates.length - 1] || {};
  t('캠페인 집계: sent 2 · failed 2 · 받는 사람 4', last.sent_count === 2 && last.failed_count === 2 && last.recipient_count === 4, JSON.stringify(last));
  t('응답 요약', out && out.summary && out.summary[0] && out.summary[0].sent === 2);

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ newsletter-send-throttle FAILED'); process.exit(1); }
  console.log('✅ newsletter-send-throttle passed');
})().catch((e) => { console.error(e); process.exit(1); });
