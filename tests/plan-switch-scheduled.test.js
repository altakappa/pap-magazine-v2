'use strict';
/**
 * 플랜 변경 예약 (2026-10-12, 도메니코 "제대로 된 길로 가자").
 * 활성 구독자가 다른 플랜을 고르면 새 PayPal 구독을 현재 기간 종료일(start_time)에 시작시킨다.
 * 남은 날이 사라지지 않는다. 행은 pending_* 로 예약만 적고, 첫 결제 때 바꾼다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

const ps = require('../api/_lib/planSwitch');
const NOW = Date.parse('2026-10-12T10:00:00Z');
const DAY = 86400000;

// ── 순수 함수 ──
t('switchStartTime: 활성 + 종료일 미래 → 종료일 ISO', ps.switchStartTime({ status: 'active', provider: 'paypal', current_period_end: '2026-10-31T10:00:00+00:00' }, NOW) === '2026-10-31T10:00:00.000Z');
t('switchStartTime: past_due 도 됨', !!ps.switchStartTime({ status: 'past_due', current_period_end: new Date(NOW + 5 * DAY).toISOString() }, NOW));
t('switchStartTime: canceled/paused → null(즉시)', ps.switchStartTime({ status: 'canceled', current_period_end: new Date(NOW + 5 * DAY).toISOString() }, NOW) === null && ps.switchStartTime({ status: 'paused', current_period_end: new Date(NOW + 5 * DAY).toISOString() }, NOW) === null);
t('switchStartTime: 10분 미만 남음 → null(즉시)', ps.switchStartTime({ status: 'active', current_period_end: new Date(NOW + 5 * 60000).toISOString() }, NOW) === null);
t('switchStartTime: 포트원 구독 → null', ps.switchStartTime({ status: 'active', provider: 'portone', current_period_end: new Date(NOW + 5 * DAY).toISOString() }, NOW) === null);
t('isSamePlan: plan 키 동일만 true', ps.isSamePlan({ plan: 'standard_monthly' }, 'standard_monthly') && !ps.isSamePlan({ plan: 'standard_monthly' }, 'standard_yearly'));
t('isScheduledStart: 결제 전 + 시작일 미래 → true', ps.isScheduledStart({ start_time: new Date(NOW + 19 * DAY).toISOString(), billing_info: { next_billing_time: new Date(NOW + 19 * DAY).toISOString() } }, NOW) === true);
t('isScheduledStart: last_payment 있음 → false(즉시)', ps.isScheduledStart({ start_time: new Date(NOW + 19 * DAY).toISOString(), billing_info: { last_payment: { time: new Date(NOW).toISOString() }, next_billing_time: new Date(NOW + 19 * DAY).toISOString() } }, NOW) === false);
t('isScheduledStart: 시작일 과거/없음 → false', ps.isScheduledStart({ start_time: new Date(NOW - DAY).toISOString(), billing_info: {} }, NOW) === false && ps.isScheduledStart({ billing_info: {} }, NOW) === false);
const pp = ps.pendingPatch({ id: 'I-NEW', start_time: '2026-10-31T10:00:00Z', billing_info: {} }, 'premium_yearly');
t('pendingPatch: plan/cycle/id/start', pp.pending_plan === 'premium_yearly' && pp.pending_billing_cycle === 'yearly' && pp.pending_paypal_subscription_id === 'I-NEW' && pp.pending_start_at === '2026-10-31T10:00:00.000Z');
const cp = ps.clearPendingPatch();
t('clearPendingPatch: 4칸 전부 null', ['pending_plan', 'pending_billing_cycle', 'pending_paypal_subscription_id', 'pending_start_at'].every((k) => k in cp && cp[k] === null));

// ── 마이그레이션 ──
const mig = R('supabase_migrations/179_subscriptions_pending_switch.sql');
t('마이그레이션 179: pending 4칸', ['pending_plan', 'pending_billing_cycle', 'pending_paypal_subscription_id', 'pending_start_at'].every((c) => new RegExp('add column if not exists ' + c).test(mig)));

// ── 웹훅 ──
const wh = R('api/paypal-webhook.js');
t('웹훅: 예약 시작이면 pending 저장 + 이전 구독 해지 + 즉시 반영 안 함', /planSwitch\.isScheduledStart\(sub\) && prev && prev\.paypal_subscription_id/.test(wh) && /planSwitch\.pendingPatch\(sub, plan\)/.test(wh) && /await cancelOtherPaypalSub\(prev\.paypal_subscription_id, sub\.id, userId\);\s*\n\s*await sendTextToTelegramSafe\('🔁 플랜 변경 예약/.test(wh) && /return \{ plan, status: 'scheduled', startsAt: patch\.pending_start_at \}/.test(wh));
t('웹훅: 즉시 반영 upsert 는 pending 을 비운다', /current_period_end: bi\.next_billing_time \|\| null,\s*\n\s*\.\.\.planSwitch\.clearPendingPatch\(\)/.test(wh));
t('웹훅: 예약 중 이전 구독 종료 이벤트 → 상태 유지(skipped)', /if \(sub\.id === row\.paypal_subscription_id\) \{[\s\S]*?return \{ skipped: 'pending_switch_old_sub' \};/.test(wh) && /select\('paypal_subscription_id, status, current_period_end, pending_paypal_subscription_id, pending_plan'\)/.test(wh));
t('웹훅: 예약된 새 구독 취소 이벤트 → 예약 비우고 canceled', /if \(sub\.id === row\.pending_paypal_subscription_id\) \{[\s\S]*?\.\.\.planSwitch\.clearPendingPatch\(\), status: 'canceled'/.test(wh));
t('웹훅: PAYMENT.SALE.COMPLETED 가 pending id 와 맞으면 upsertSubscription 으로 전환', /\.eq\('pending_paypal_subscription_id', subId\)\.maybeSingle\(\);\s*\n\s*if \(pend && pend\.user_id\) \{\s*\n\s*const r = await upsertSubscription\(sub, pend\.user_id\);/.test(wh));

// ── 포털 ──
const portal = R('api/subscriptions/portal.js');
t('portal GET: provider + pending 3칸 내려줌', /provider: subscriber\.provider \|\| null/.test(portal) && /pending_plan: subscriber\.pending_plan \|\| null/.test(portal) && /pending_billing_cycle/.test(portal) && /pending_start_at: subscriber\.pending_start_at \|\| null/.test(portal));
const pport = R('api/subscriptions/paypal-portal.js');
t('paypal-portal cancel: 예약 구독도 PayPal 에서 취소 + pending 비움 + canceled', /if \(row\.pending_paypal_subscription_id\) \{[\s\S]*?\/cancel`, \{[\s\S]*?clearPendingPatch\(\), status: 'canceled'/.test(pport) && /pendingCanceled: true/.test(pport));
t('paypal-portal pause/resume: 예약 중이면 409 pending_switch', /code: 'pending_switch'/.test(pport));

// ── 프론트 pap-api ──
const api = R('frontend/pap-api.js');
t('checkoutIntl: 포털 조회 → start_time 계산, 같은 플랜/이미 예약은 막음', /function _switchStartTime\(cur\)/.test(api) && /startTime = _switchStartTime\(cur\);/.test(api) && /code = 'PENDING_SWITCH'/.test(api) && /code = 'SAME_PLAN'/.test(api) && /_openPayPalOverlay\(planId, key, user, startTime\)/.test(api));
t('checkoutIntl: PayPal create 에 start_time 전달', /if \(startTime\) req\.start_time = startTime;\s*\n\s*return actions\.subscription\.create\(req\);/.test(api));
t('체크아웃 창: 예약이면 안내 문구 + 승인 후 등급 대기 안 함', /_ppT\('scheduled'\)\.replace\('\{date\}'/.test(api) && /_ppT\('scheduledDone'\)/.test(api));
t('_PP_I18N: scheduled/scheduledDone/pending/samePlan 9개 언어', ['scheduled', 'scheduledDone', 'pending', 'samePlan'].every((k) => (api.match(new RegExp('\\b' + k + ":'", 'g')) || []).length === 9));
t('pap-api 캐시버스트 ≥19', (R('frontend/subscribe.html').match(/pap-api\.js\?v=(\d+)/) || [])[1] >= 19);

// ── 구독 페이지 ──
const sb = R('frontend/subscribe.html');
const cnt = (k) => (sb.match(new RegExp('\\b' + k + ":'", 'g')) || []).length;
t('subscribe: ctaSwitch/switchNote/pendingBadge/pendingNote 9개 언어', ['ctaSwitch', 'switchNote', 'pendingBadge', 'pendingNote'].every((k) => cnt(k) === 9));
t('subscribe: 옛 손실 안내(switchYearlyNote 키) 제거', cnt('switchYearlyNote') === 0 && !/남은 날은 사라집니다/.test(sb));
t('subscribe: _switchable(활성·PayPal·10분 이상) + 예약 카드 배지 + is-switch', /function _switchable\(\)/.test(sb) && /pend\.plan===base && pend\.billing===currentBilling/.test(sb) && /c\.classList\.add\('is-switch'\)/.test(sb) && /d\.pendingBadge\|\|'FROM \{date\}'/.test(sb));
t('subscribe: 언어 바꿀 때 바꾸기 문구를 덮어쓰지 않는다', /card\.classList\.contains\('is-switch'\)\) return;/.test(sb) && /card\.classList\.contains\('is-switch'\) \|\| card\.classList\.contains\('is-current'\)\) return;/.test(sb));
t('subscribe 사전 버전 ≥9', Number((sb.match(/content="subscribe" data-v="(\d+)"/) || [])[1]) >= 9);

// ── 마이페이지 ──
const mp = R('frontend/mypage.html');
t('mypage: 예약 안내 한 줄(_MP_SWITCH_I18N 9개 언어)', /var _MP_SWITCH_I18N = \{/.test(mp) && LANGS.every((l) => new RegExp('\\n  ' + l + ':\\{pending:').test(mp)) && /id = 'mpPendingSwitch'/.test(mp) && /s\.pending_plan && !document\.getElementById\('mpPendingSwitch'\)/.test(mp));
t('mypage 사전 버전 ≥18', Number((mp.match(/content="mypage" data-v="(\d+)"/) || [])[1]) >= 18);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
