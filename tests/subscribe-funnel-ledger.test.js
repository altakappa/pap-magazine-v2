'use strict';
/**
 * 구독 출처별 전환 장부 (2026-10-02, 도메니코 "측정 자동화").
 * 순수 집계(aggregate)와 표(render)를 가짜 데이터로 실행하고, 주간 브리핑 배선을 확인한다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

const L = require('../api/_lib/subscribeFunnelLedger');
const T = Date.parse('2026-10-02T00:00:00Z');
const d = (iso) => iso;
const ev = [
  { step: 'subscribe_view', path: '/subscribe?utm_source=live_mail', user_id: 'u1', created_at: d('2026-09-30T00:00:00Z') },
  { step: 'subscribe_view', path: '/subscribe?utm_source=editorial_downloads', user_id: 'u1', created_at: d('2026-09-25T00:00:00Z') },
  { step: 'subscribe_view', path: '/subscribe?utm_source=casting_teaser', user_id: 'u2', created_at: d('2026-09-01T00:00:00Z') },
  { step: 'subscribe_view', path: '/subscribe', user_id: null, created_at: d('2026-09-30T00:00:00Z') },
  { step: 'subscribe_view', path: '/en/subscribe?utm_source=LIVE_MAIL&x=1', user_id: 'u3', created_at: d('2026-09-30T00:00:00Z') },
  { step: 'locked_popup_view', path: '/editorial/x?lp=a', created_at: d('2026-09-30T00:00:00Z') },
  { step: 'locked_popup_view', path: '/editorial/x?lp=b', created_at: d('2026-09-30T00:00:00Z') },
  { step: 'locked_popup_cta', path: '/editorial/x?lp=b', created_at: d('2026-09-30T00:00:00Z') },
];
const subs = [
  { user_id: 'u1', plan: 'standard_monthly', created_at: d('2026-10-01T00:00:00Z') },   // 마지막 조회 live_mail(9/30) 에 귀속
  { user_id: 'u2', plan: 'premium_yearly', created_at: d('2026-10-01T00:00:00Z') },     // 조회가 30일 전 → 14일 밖 → 귀속 불가
  { user_id: 'u9', plan: 'premium_monthly', created_at: d('2026-10-01T00:00:00Z') },    // 조회 기록 없음 → 귀속 불가
];
const a = L.aggregate(ev, subs, T);
const row = (s) => a.rows.find((r) => r.source === s) || {};
t('utm 파싱: 대소문자 무시 · 없으면 (없음)', L.utmOf('/en/subscribe?utm_source=LIVE_MAIL&x=1') === 'live_mail' && L.utmOf('/subscribe') === '(없음)');
t('결제는 결제 전 14일 안 마지막 조회에 귀속 (live_mail 1, editorial_downloads 0)', row('live_mail').purchases === 1 && (row('editorial_downloads').purchases || 0) === 0);
t('14일 밖 조회·조회 없음 → 귀속 불가 2건, 합계 3건', a.unattributed === 2 && a.totalPurchases === 3);
t('조회·로그인 사용자 수 (live_mail 조회 2, 사용자 2)', row('live_mail').views === 2 && row('live_mail').users === 2);
t('잠금 팝업 A/B 분리 (A 1/0, B 1/1)', a.popup.a.views === 1 && a.popup.a.cta === 0 && a.popup.b.views === 1 && a.popup.b.cta === 1);
const md = L.renderSubscribeFunnelMd({ days: 28, ...a });
t('표: 제목 · 출처 행 · 귀속 불가 · A/B 줄', /## 구독 출처별 전환 \(28일\)/.test(md) && /\| live_mail \| 2 \| 2 \| 1 \| 0 \| 50% \|/.test(md) && /출처에 못 묶은 결제 2건/.test(md) && /B 노출 1 · 클릭 1 \(100%\)/.test(md));
t('표: 표본 작다는 경고가 들어간다', /표본이 작으니/.test(md));
const lib = R('api/_lib/subscribeFunnelLedger.js');
t('DB 는 함수 안에서만 읽는다 (순수 함수 테스트 가능)', !/^const \{ supabaseAdmin \} = require/m.test(lib) && /const \{ supabaseAdmin \} = require\('\.\/supabase'\);/.test(lib));
const wb = R('api/cron/weekly-briefing.js');
t('주간 브리핑: best-effort 로 만들고, AI 근거에 넘기고, 표를 뒤에 붙인다', /buildSubscribeFunnel\(\{ days: 28 \}\)/.test(wb) && /JSON\.stringify\(subFunnel \|\| \{\}\)/.test(wb) && /renderSubscribeFunnelMd\(subFunnel\)/.test(wb));
t('테스트 스크립트 등록', /subscribe-funnel-ledger\.test\.js/.test(R('package.json')));
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
