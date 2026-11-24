/**
 * 결제는 살아 있는데 등급이 없는 회원을 되돌린다 (도메니코 2026-11-24)
 *
 * 도메니코: "돈이 안들어왔는데 왜 등급을 유지해? 돈이 들어오면 다시 강등된걸 복구하면 되잖아?"
 * 정책은 맞았는데 '복구' 쪽이 시스템에 없었다. 등급을 빼앗는 pull 안전망
 * (subscription-expiry-sweep)만 있고 돌려주는 쪽은 웹훅 한 번에 달려 있었다.
 *
 * 실제 피해: difanation@gmail.com 이 10/12 가입 · 11/12 갱신(12/12 까지 결제)인데
 * profiles 는 가입일 이후 그대로 free/inactive — 6주간 프리미엄 요금을 내며 무료로 썼다.
 *
 * 이 테스트가 지키는 것:
 *   ① 올리기만 한다 (내리는 건 expiry-sweep 혼자) — 두 크론이 양방향이면 등급이 깜빡인다
 *   ② 결제 기간이 남은 구독만 본다
 *   ③ 스태프/어드민(수동 증정)은 건드리지 않는다
 *   ④ 고쳤으면 알린다 — 조용히 고치면 웹훅이 새는 원인이 영원히 안 보인다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api/cron/subscription-access-reconcile.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 1) 방향은 한쪽뿐 (가장 중요) ===');
t('등급 높낮이를 숫자로 비교한다', /const RANK = \{ free: 0, standard: 1, premium: 2 \}/.test(SRC));
t('올릴 때만 subscription_plan 을 쓴다', /if \(rank\(want\) > rank\(have\)\) patch\.subscription_plan = want;/.test(SRC));
t('같거나 더 높으면 건너뛴다', /if \(rank\(have\) >= rank\(want\) && statusOk\) continue;/.test(SRC));
/* 내리는 코드가 아예 없어야 한다. downgradeToFree 를 import 하는 순간 사고가 난다. */
t("'free' 로 내리는 코드가 없다", !/downgradeToFree/.test(SRC) && !/subscription_plan:\s*'free'/.test(SRC));
t("subscriptions 테이블은 쓰지 않는다 (읽기만)", !/from\('subscriptions'\)[\s\S]{0,80}\.update\(/.test(SRC));

console.log('\n=== 2) 대상 고르기 ===');
t('결제 기간이 남은 것만', /\.gt\('current_period_end', new Date\(\)\.toISOString\(\)\)/.test(SRC));
t('살아 있는 상태만 (active·trialing·canceled)',
  /LIVE_STATUS = \['active', 'trialing', 'canceled'\]/.test(SRC));
/* canceled 가 들어가는 이유: 해지해도 결제한 기간까지는 접근권이 유지된다. */
t('canceled 를 포함하는 이유가 주석에 있다', /해지해도 \*\*결제한 기간까지는\*\* 접근권이 유지/.test(SRC));
t('스태프·어드민은 건드리지 않는다', /prof\.role === 'admin' \|\| prof\.role === 'staff'/.test(SRC));
t('모르는 플랜은 건드리지 않는다', /const want = baseTier\(row\.plan\);\s*\n\s*if \(!want\) continue;/.test(SRC));

console.log('\n=== 3) 등급 이름 ===');
/* profiles 에는 'premium_monthly' 가 아니라 'premium' 이 들어가야 한다.
   원본 키를 넣으면 게이트의 등가 비교가 깨져 실결제 회원이 막힌다(2026-07-11 사고). */
/* 이 파일은 _lib/supabase 를 최상단에서 require 한다(expiry-sweep 과 동일) —
   env 없는 CI 에서는 로드 자체가 불가하므로 정적 검사만 한다. */
t('premium_monthly → premium 으로 접는다', /if \(\/\^premium\/i\.test\(p\)\) return 'premium';/.test(SRC));
t('standard_yearly → standard 로 접는다', /if \(\/\^standard\/i\.test\(p\)\) return 'standard';/.test(SRC));
t('원본 플랜 키를 그대로 넣지 않는다', !/subscription_plan: row\.plan/.test(SRC));

console.log('\n=== 4) 기본값과 끄는 법 ===');
/* expiry-sweep 은 기본이 '보고만' 이다(혜택 회수는 사람 판단). 이쪽은 반대 —
   이미 받은 돈만큼 돌려주는 것은 판단거리가 아니라 오류 수정이고, 지연 자체가 피해다. */
t('기본이 자동 복구다', /SUBSCRIPTION_RECONCILE \|\| 'on'/.test(SRC));
t('끌 수 있다', /\.toLowerCase\(\) !== 'off'/.test(SRC));
t('꺼져 있으면 고치지 않고 보고만 한다', /if \(!ENABLED\) \{ stats\.reported \+= 1; continue; \}/.test(SRC));

console.log('\n=== 5) 고쳤으면 알린다 ===');
t('텔레그램으로 알린다', /sendTextToTelegramSafe\(/.test(SRC));
t('알림이 원인(웹훅 유실)을 가리킨다', /활성화 웹훅이 유실됐다는 뜻/.test(SRC));
t('cron_runs 에 수치를 남긴다', /cronNote = `scanned=\$\{stats\.scanned\} mismatched=/.test(SRC));

console.log('\n=== 6) 배선 ===');
t('CRON_SECRET 을 timing-safe 로 본다', /safeEqual\(got, expected\)/.test(SRC));
t('withCronGuard 로 감쌌다', /module\.exports = withCronGuard\('subscription-access-reconcile', handler\)/.test(SRC));
t('res.locals 를 먼저 깐다 (cron-contract 규약)', /res\.locals = res\.locals \|\| \{\};/.test(SRC));
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const crons = vj.crons || [];
const mine = crons.find((c) => c.path === '/api/cron/subscription-access-reconcile');
const sweep = crons.find((c) => c.path === '/api/cron/subscription-expiry-sweep');
t('vercel.json 에 등록돼 있다', !!mine, JSON.stringify(mine));
/* 만료 스윕(17:40)이 내린 뒤에 돈다. 순서가 뒤집히면 복구한 걸 곧바로 내려버린다. */
t('만료 스윕보다 뒤에 돈다', !!sweep && !!mine
  && (() => { const m = (s) => { const [mi, h] = s.schedule.split(' '); return Number(h) * 60 + Number(mi); };
       return m(mine) > m(sweep); })(),
  sweep && mine ? sweep.schedule + ' → ' + mine.schedule : '');

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ subscription-access-reconcile tests FAILED'); process.exit(1); }
console.log('✅ subscription-access-reconcile tests passed');
