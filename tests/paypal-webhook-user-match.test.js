/**
 * 해지 웹훅은 왔는데 "안 온 것처럼" 보였던 이유 (도메니코 2026-11-27: "해지 웹훅이 왜안오는지 파보자")
 *
 * 증상: 회원 4명(jaya·javier·valentina·raul)이 PayPal 에서 해지했는데 우리 DB 에는
 * 전부 expired(기간 만료)로 적혀 있었다. 해지 웹훅이 네 번 다 유실된 것처럼 보였다.
 *
 * 실제 원인: 웹훅은 도착했다. resolveUserId 가 회원을 못 찾아 200 { unmatched: true }
 * 로 조용히 돌려보냈을 뿐이다. 매칭은 custom_id 와 "결제자 이메일"만 봤는데,
 * PayPal 결제자 이메일이 가입 이메일과 다른 회원이 실제로 있다 —
 *   raulnavalon@hotmail.com   vs 가입 raulnavalongomez@gmail.com
 *   sibelistaveras@gmail.com  vs 가입 sibelistav@gmail.com
 * PayPal 은 200 을 받으면 재시도하지 않으므로 그 이벤트는 영구히 사라진다.
 *
 * 이 테스트가 지키는 것:
 *   ① 구독 ID(paypal_subscription_id)로 먼저 찾는다 — 위조 불가, 어차피 고칠 대상이 그 행이다
 *   ② 못 찾았으면 반드시 알린다 — 침묵이 이 사고의 본체였다
 *   ③ 결제가 들어오면 등급을 그 자리에서 복구한다 (하루 1회 크론을 기다리지 않는다)
 *   ④ 복구는 올리기만 한다 — 내리는 건 만료 스윕 혼자
 *   ⑤ 결제 증거가 없는 행(current_period_end IS NULL)도 스윕이 집는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WH = fs.readFileSync(path.join(ROOT, 'api/paypal-webhook.js'), 'utf8');
const ACC = fs.readFileSync(path.join(ROOT, 'api/_lib/subscriptionAccess.js'), 'utf8');
const SWEEP = fs.readFileSync(path.join(ROOT, 'api/cron/subscription-expiry-sweep.js'), 'utf8');
const { restoreTier } = require(path.join(ROOT, 'api/_lib/subscriptionAccess.js'));

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* profiles 한 행만 들고 있는 최소 스텁. update 는 패치를 모아 둔다. */
function stubDb(profile) {
  const updates = [];
  return {
    updates,
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: profile }); },
        update(patch) { updates.push(patch); return { eq: () => Promise.resolve({ error: null }) }; },
      };
    },
  };
}

async function main() {
  console.log('\n=== 1) 구독 ID 로 먼저 찾는다 (사고의 직접 원인) ===');
  const RESOLVE = WH.slice(WH.indexOf('async function resolveUserId'),
                           WH.indexOf('async function upsertSubscription'));
  t('paypal_subscription_id 로 조회한다',
    /\.eq\('paypal_subscription_id', sub\.id\)/.test(RESOLVE));
  t('예약 중인 플랜 변경(pending_paypal_subscription_id)도 본다',
    /\.eq\('pending_paypal_subscription_id', sub\.id\)/.test(RESOLVE));
  /* 순서가 핵심이다. 이메일 조회가 먼저면 어긋난 이메일이 계속 이긴다. */
  t('구독 ID 조회가 이메일 조회보다 앞에 있다',
    RESOLVE.indexOf("'paypal_subscription_id', sub.id") < RESOLVE.indexOf(".ilike('email'"),
    RESOLVE.indexOf("'paypal_subscription_id', sub.id") + ' vs ' + RESOLVE.indexOf(".ilike('email'"));
  t('구독 ID 로 찾았으면 그걸 쓴다', /if \(subIdUserId\) \{/.test(RESOLVE));
  t('이메일과 어긋나면 알린다(구독 ID 기준으로 가되 조용히 넘기지 않는다)',
    /user_id MISMATCH subId:/.test(RESOLVE) && /불일치 — 구독 ID 기준 배정/.test(RESOLVE));
  /* 주석은 함수 위(= WH)에, 코드는 함수 안(= RESOLVE)에 있다. */
  t('custom_id 를 그대로 믿지 않는다는 규칙이 남아 있다',
    /위조 가능성이 있다/.test(WH) && /claimed && emailUserId && claimed !== emailUserId/.test(RESOLVE));
  t('실측 사례가 주석에 남아 있다', /raulnavalon@hotmail\.com/.test(WH) && /sibelistav/.test(WH));

  console.log('\n=== 2) 못 찾았으면 반드시 알린다 (침묵 금지) ===');
  t('alertUnmatched 가 있다', /async function alertUnmatched\(sub, eventType\)/.test(WH));
  t('텔레그램으로 알린다', /alertUnmatched[\s\S]{0,400}sendTextToTelegramSafe/.test(WH));
  t('PayPal 이 재시도하지 않는다는 이유가 주석에 있다',
    /200 을 받으면 재시도하지 않/.test(WH));
  /* unmatched 로 끝나는 모든 분기 앞에 알림이 있어야 한다. 하나라도 빠지면 또 조용히 사라진다. */
  const unmatchedSites = WH.split(/\n/).reduce((acc, line, i, all) => {
    if (/unmatched: true/.test(line)) {
      const before = all.slice(Math.max(0, i - 6), i).join('\n');
      acc.push(/alertUnmatched\(|sendTextToTelegramSafe\(/.test(before));
    }
    return acc;
  }, []);
  t('unmatched 분기가 3곳이다', unmatchedSites.length === 3, 'found ' + unmatchedSites.length);
  t('그 3곳 전부 알림이 앞에 있다', unmatchedSites.length === 3 && unmatchedSites.every(Boolean),
    JSON.stringify(unmatchedSites));

  console.log('\n=== 3) 결제가 들어오면 그 자리에서 복구 ===');
  t('webhook 이 restoreTier 를 가져온다',
    /require\('\.\/_lib\/subscriptionAccess'\)/.test(WH) && /restoreTier/.test(WH));
  const SALE = WH.slice(WH.indexOf("case 'PAYMENT.SALE.COMPLETED'"),
                        WH.indexOf("case 'PAYMENT.CAPTURE.COMPLETED'"));
  t('갱신 결제에서 restoreTier 를 호출한다', /await restoreTier\(supabaseAdmin, pr\.user_id, pr\.plan\)/.test(SALE));
  t('복구했으면 알린다', /결제 도착 → 등급 복구/.test(SALE));
  t('복구 실패가 갱신 처리를 깨지 않는다(try/catch)', /catch \(e3\) \{ console\.warn/.test(SALE));
  t('하루 1회 크론을 기다렸던 문제가 주석에 있다', /최대 24시간 무료 등급으로 남아/.test(SALE));

  console.log('\n=== 4) restoreTier 는 올리기만 한다 ===');
  {
    const db = stubDb({ role: 'member', subscription_plan: 'free', subscription_status: 'inactive' });
    const r = await restoreTier(db, 'u1', 'premium_monthly');
    t('free/inactive + premium_monthly → premium/active', r.changed === true
      && db.updates.length === 1
      && db.updates[0].subscription_plan === 'premium'
      && db.updates[0].subscription_status === 'active', JSON.stringify({ r, u: db.updates }));
  }
  {
    const db = stubDb({ role: 'member', subscription_plan: 'premium', subscription_status: 'active' });
    const r = await restoreTier(db, 'u1', 'premium_monthly');
    t('이미 맞으면 아무것도 안 한다', r.changed === false && db.updates.length === 0);
  }
  {
    const db = stubDb({ role: 'member', subscription_plan: 'premium', subscription_status: 'active' });
    const r = await restoreTier(db, 'u1', 'standard_monthly');
    t('더 높은 등급을 내리지 않는다', r.changed === false && db.updates.length === 0, JSON.stringify(db.updates));
  }
  {
    const db = stubDb({ role: 'member', subscription_plan: 'premium', subscription_status: 'inactive' });
    const r = await restoreTier(db, 'u1', 'standard_monthly');
    t('상태만 살리고 등급은 안 내린다', r.changed === true
      && db.updates.length === 1
      && db.updates[0].subscription_status === 'active'
      && !('subscription_plan' in db.updates[0]), JSON.stringify(db.updates));
  }
  for (const role of ['admin', 'staff']) {
    const db = stubDb({ role, subscription_plan: 'free', subscription_status: 'inactive' });
    const r = await restoreTier(db, 'u1', 'premium_monthly');
    t(role + ' 은 건드리지 않는다(수동 증정 등급)', r.changed === false && db.updates.length === 0);
  }
  {
    const db = stubDb({ role: 'member', subscription_plan: 'free', subscription_status: 'inactive' });
    const r = await restoreTier(db, 'u1', 'mystery_plan');
    t('모르는 플랜은 건드리지 않는다', r.changed === false && db.updates.length === 0);
  }
  {
    const db = stubDb(null);
    const r = await restoreTier(db, 'u1', 'premium_monthly');
    t('프로필이 없으면 no_profile', r.error === 'no_profile' && r.changed === false, JSON.stringify(r));
  }
  {
    const db = stubDb({ role: 'member' });
    const r = await restoreTier(db, '', 'premium_monthly');
    t('userId 가 없으면 no_user', r.error === 'no_user' && db.updates.length === 0);
  }
  t('subscriptionAccess 가 restoreTier 를 export 한다', /^\s*restoreTier,$/m.test(ACC));
  t('restoreTier 가 free 로 내리는 코드를 갖지 않는다',
    !/restoreTier[\s\S]{0,1600}subscription_plan:\s*'free'/.test(ACC));

  console.log('\n=== 5) 결제 증거가 없는 행도 스윕이 집는다 ===');
  t('current_period_end IS NULL 을 따로 스캔한다', /\.is\('current_period_end', null\)/.test(SWEEP));
  t("체크아웃 중('pending')은 일부러 제외한다",
    /\.in\('status', \['canceled', 'expired', 'past_due', 'payment_failed'\]\)/.test(SWEEP)
    && /'pending' 은 일부러 뺀다/.test(SWEEP));
  t('그 행도 downgradeToFree 로 내린다',
    /orphans[\s\S]{0,1400}downgradeToFree\(supabaseAdmin, row\.user_id\)/.test(SWEEP));
  t('만료일이 없는 건은 알림에 "결제 기록 없음" 으로 뜬다', /결제 기록 없음/.test(SWEEP));
  t('.lt 가 NULL 을 못 집는다는 이유가 주석에 있다', /NULL 을 집지 못한다/.test(SWEEP));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ paypal-webhook-user-match tests FAILED'); process.exit(1); }
  console.log('✅ paypal-webhook-user-match tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
