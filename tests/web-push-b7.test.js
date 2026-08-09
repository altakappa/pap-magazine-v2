/**
 * 웹 푸시 (B-7) — tests/web-push-b7.test.js (2026-08-09 신설)
 *
 * 배경: 부스트 실측에서 스레드 평균 조회 33회 — "점화 부대"가 없었다.
 * 웹 푸시는 게시 순간 회원·방문자를 동원하는 유일한 자체 즉시 채널이다.
 * 단, 알림은 신뢰 자산이다. 여기서 지키는 것:
 *
 *   ① 하루 상한 + 에디토리얼 전용 (스팸 한 번이면 구독 해지 사태)
 *   ② 비밀키는 절대 클라이언트로 안 나간다 (공개키만)
 *   ③ web-push 는 lazy require (no-eager-npm-deps — cronGuard 도달 모듈)
 *   ④ 푸시 실패가 부스트·수집을 못 막는다
 *   ⑤ 클릭은 ig-out?src=push 경유 (성장 헌법 3조 — 측정 없는 발신 금지)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const wp = R('api/_lib/webPush.js');
const gb = R('api/_lib/goldenBoost.js');
const sub = R('api/push/subscribe.js');
const cfg = R('api/content/config.js');
const igOut = R('api/ig-out.js');
const sw = R('frontend/pap-push-sw.js');
const en = R('frontend/pap-engage.js');
const mig = R('supabase_migrations/115_push_subscriptions.sql');

console.log('\n[1] 발송 규율 — 알림은 신뢰 자산');
{
  t('하루 상한이 있다 (기본 2건)', /PUSH_DAILY_CAP \|\| '2'/.test(wp) && /underDailyCap/.test(wp));
  t('상한 초과 시 침묵', /daily-cap/.test(wp));
  t('에디토리얼만 푸시한다 (부스트의 draft 지점은 안 탐)',
    /if \(o\.kind === 'editorial'\)/.test(gb));
  t('죽은 구독(404/410)은 즉시 비활성', /code === 404 \|\| code === 410/.test(wp)
    && /disabled_at/.test(wp));
  t('본체가 절대 던지지 않는다 (호출부 = 부스트)', /catch \(e\) \{\n    console\.warn\('\[webPush\]/.test(wp));
  t('VAPID env 미설정이면 조용히 no-op (env 없이도 배포 안전)', /vapid-미설정/.test(wp));
}

console.log('\n[2] 비밀키 격리 — 절대 규칙 3');
{
  t('config API 는 공개키만 노출', /vapidPublicKey: process\.env\.VAPID_PUBLIC_KEY/.test(cfg));
  t('config API 에 비밀키가 없다', !/VAPID_PRIVATE_KEY/.test(cfg));
  t('프런트에 비밀키 흔적이 없다', !/VAPID_PRIVATE/.test(en) && !/VAPID_PRIVATE/.test(sw));
  t('비밀키는 서버 발송 모듈에만 있다', /VAPID_PRIVATE_KEY/.test(wp));
}

console.log('\n[3] no-eager-npm-deps — 107·cronGuard 교훈');
{
  t('web-push 는 함수 안 lazy require', /const webpush = require\('web-push'\)/.test(wp)
    && wp.indexOf("require('web-push')") > wp.indexOf('async function broadcastNewPost'));
  t('goldenBoost 의 webPush 도 lazy require', gb.indexOf("require('./webPush')") > gb.indexOf('async function maybeBoostPost'));
}

console.log('\n[4] 실패 격리 — 푸시가 부스트를 못 막는다');
{
  t('부스트 쪽 푸시 호출이 try/catch 안', /try \{[\s\S]{0,120}require\('\.\/webPush'\)/.test(gb));
  t('푸시 결과는 관찰값으로만 (pushSent)', /pushSent/.test(gb));
}

console.log('\n[5] 계측 — 성장 헌법 3조');
{
  t('알림 클릭은 ig-out?src=push 경유', /ig-out\?src=push&to=post/.test(wp));
  t("ig-out 화이트리스트에 'push' 등록", /'boost', 'push'\]\)/.test(igOut));
  t('추적 쿼리 제거 후 인코딩', /split\('\?'\)\[0\]/.test(wp));
}

console.log('\n[6] 구독 API — 문턱 없는 첫 계단 (헌법 7조)');
{
  t('로그인 없이 구독 가능 (user_id 는 선택)', /\(me && me\.id\) \|\| null/.test(sub));
  t('endpoint https 검증 + 길이 제한', /\^https:\\\/\\\//.test(sub) && /endpoint\.length > 1000/.test(sub));
  t('upsert onConflict endpoint (중복 구독 없음)', /onConflict: 'endpoint'/.test(sub));
  t('해지는 삭제가 아니라 disabled_at (기록 보존)', /update\(\{ disabled_at/.test(sub));
}

console.log('\n[7] 프런트 — 안 되는 버튼은 안 보여준다');
{
  t('벨 버튼이 pe-bar 에 있다', /class="pe-push" hidden/.test(en));
  t('미지원 브라우저는 침묵', /'serviceWorker' in navigator/.test(en) && /'PushManager' in global/.test(en));
  t('공개키 미배포면 버튼 미노출', /if \(!key\) return;/.test(en));
  t('SW 등록 + userVisibleOnly 구독', /register\('\/pap-push-sw\.js'\)/.test(en)
    && /userVisibleOnly: true/.test(en));
  t('구독을 서버에 저장 (POST /api/push/subscribe)', /'\/api\/push\/subscribe'/.test(en));
  t('서버 저장 실패 시 죽은 구독을 안 남긴다', /sub2\.unsubscribe\(\)/.test(en));
  t('SW: push → 알림 표시, 클릭 → 열기', /showNotification/.test(sw) && /clients\.openWindow/.test(sw));
}

console.log('\n[8] 마이그레이션 — 107 교훈 (부분 유니크 인덱스 금지)');
{
  t('endpoint 가 그냥 PK', /endpoint text primary key/.test(mig));
  t('부분 유니크 인덱스가 없다', !/unique index[\s\S]{0,80}where/i.test(mig));
}

console.log('\n[9] 캐시버스트 — pap-engage v=3');
{
  const refs = ['frontend/index.html', 'frontend/articles.html', 'frontend/films.html', 'api/_lib/seoRenderer.js'];
  refs.forEach(function (f) {
    t(f + ' 이 v=5 을 참조', /pap-engage\.js\?v=5/.test(R(f)));
  });
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ web-push-b7 tests FAILED'); process.exit(1); }
console.log('✅ web-push-b7 tests passed');
