/**
 * 뉴스레터 감시 — tests/newsletter-watch.test.js (2026-08-07 신설)
 *
 * 왜 만들었나 ────────────────────────────────────────────────────────
 * 뉴스레터가 **한 달간 한 통도 안 나갔는데 아무도 몰랐다.** 실측:
 *
 *     마지막 발송      2026-07-06 · 11통
 *     그 이후          0통
 *     캠페인 생성      5/12 · 5/26 · 6/02 · 6/29 · 7/06 · 7/19 → 그 뒤 없음
 *     draft 로 방치    5건
 *     cron_runs 의 weekly-news 기록  **0건**
 *
 * 마지막 줄이 핵심이다. 7/30 크론 관측성 감사(a4e13c1)가 12개를 훑었는데
 * weekly-news 는 감싼 5개에도, 남긴 7개에도 없었다. 가드가 없으니 실행 기록도
 * 실패 알림도 없었고, "언제부터 안 돌았는지" 조차 알 수 없었다.
 *
 * 주간 크론은 특히 위험하다 — 한 번 놓치면 다음 기회가 일주일 뒤다.
 *
 * 여기서 지키는 것:
 *   ① weekly-news 에 실행 기록 가드가 붙어 있다
 *   ② 모든 종료 지점이 note 를 남긴다 (빈칸이면 아무도 못 본다)
 *   ③ 생성 정체 · draft 정체 · '보냈다는데 0통' 셋을 가른다
 *   ④ '보냈다는데 0통' 이 가장 먼저 걸린다 (겉으로 정상이라 제일 위험)
 *   ⑤ 0통 발송을 'sent' 로 표시하지 않는다
 *   ⑥ SMTP 미설정 사유가 로그에 남는다
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [], isLikelyEditorialCaption: () => false, _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('backfillHealth.js', { diagnoseBackfill: () => ({}), buildBackfillAlert: () => ({}) });
stub('translateHealth.js', { judgeTranslateHealth: () => ({}), buildTranslateAlert: () => ({}) });
stub('faqHealth.js', { judgeFaqHealth: () => ({}), buildFaqAlert: () => ({}), summarizeFaqRuns: () => ({}) });
stub('cronDurationHealth.js', { summarizeDurations: () => ({}), judgeCronDuration: () => ({}), buildCronDurationAlert: () => ({}) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const watch = require(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'));
const J = watch.judgeNewsletter;
const A = watch.buildNewsletterAlert;

const NOW = Date.parse('2026-08-07T18:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const camp = (o) => Object.assign({ status: 'sent', recipient_count: 10, sent_count: 10 }, o);

console.log('\n[1] 정상은 조용하다');
{
  const d = J([camp({ created_at: ago(2) }), camp({ created_at: ago(9) })], NOW);
  t('최근 캠페인이 있으면 healthy', d.healthy === true, JSON.stringify(d));
  t('경과 일수를 센다', d.daysSince === 2);
  t('기록이 아예 없으면 판단 보류 (알람 아님)', J([], NOW).healthy === true);
  t('null 에도 안 죽는다', J(null, NOW).healthy === true);
}

console.log('\n[2] 생성 정체 — 주간 크론이 두 번 이상 걸렀다');
{
  const d = J([camp({ created_at: ago(19) })], NOW);
  t('19일 전이면 문제', d.healthy === false);
  t("cause 는 'no-new'", d.cause === 'no-new', d.cause);
  t('며칠인지 문구에 적는다', /19일 전/.test(d.reason), d.reason);
  /* 9일은 아직 한 번 걸른 것 — 주간 크론에 한 번은 흔하다. */
  t('9일은 아직 안 운다', J([camp({ created_at: ago(9) })], NOW).healthy === true);
}

console.log('\n[3] draft 정체 — 만들었는데 영원히 안 나간다');
{
  const d = J([camp({ status: 'draft', created_at: ago(5) }), camp({ created_at: ago(1) })], NOW);
  t('3일 넘은 draft 는 문제', d.healthy === false);
  t("cause 는 'stuck-draft'", d.cause === 'stuck-draft', d.cause);
  t('건수를 센다', d.drafts === 1);
  t('예약해야 나간다고 알려준다', /예약/.test(d.reason), d.reason);
  /* 방금 만든 draft 는 아직 사람이 볼 시간이 있다 */
  t('갓 만든 draft 는 안 운다',
    J([camp({ status: 'draft', created_at: ago(1) })], NOW).healthy === true);
}

console.log("\n[4] '보냈다는데 0통' — 가장 위험하고 가장 먼저");
{
  const zero = camp({ status: 'sent', recipient_count: 119, sent_count: 0, created_at: ago(1) });
  const d = J([zero], NOW);
  t('문제로 잡는다', d.healthy === false);
  t("cause 는 'zero-sent'", d.cause === 'zero-sent', d.cause);
  t('SMTP 를 의심하라고 짚어준다', /SMTP/.test(d.reason), d.reason);

  /* 겉으로는 '발송 완료' 라 제일 안 보인다 → 다른 문제보다 먼저 걸려야 한다 */
  const mixed = J([zero, camp({ status: 'draft', created_at: ago(30) })], NOW);
  t('draft 정체보다 먼저 잡힌다', mixed.cause === 'zero-sent', mixed.cause);

  t('받는 사람이 0명이면 0통이어도 정상 (보낼 사람이 없었다)',
    J([camp({ status: 'sent', recipient_count: 0, sent_count: 0, created_at: ago(1) })], NOW).healthy === true);
}

console.log('\n[5] 알림 문구');
{
  const a = A({ cause: 'zero-sent', reason: '테스트', daysSince: 3 }, 'https://x.test');
  t('제목이 원인을 말한다', /보냈다는데 0통/.test(a.title), a.title);
  t('사유가 본문에 있다', a.lines.join(' ').indexOf('테스트') >= 0);
  t('경과 일수도 싣는다', /3일 전/.test(a.lines.join(' ')));
  t('링크가 있다', /admin\/crons/.test(a.url));
}

console.log('\n[6] weekly-news 관측성 — 이게 없어서 3주 몰랐다');
{
  const src = R('api/cron/weekly-news.js');
  t('cronGuard 로 감싼다', /withCronGuard\('weekly-news'/.test(src));
  t('cronGuard 를 require 한다', /require\('\.\.\/_lib\/cronGuard'\)/.test(src));
  t('note 헬퍼가 있다', /function note\(res, msg\)/.test(src));
  /* 종료 지점마다 note 가 있어야 한다 — 빈칸이면 대시보드에서 정상으로 보인다 */
  const returns = (src.match(/return res\.status\(/g) || []).length;
  const notes = (src.match(/note\(res,/g) || []).length;
  t('모든 종료 지점이 note 를 남긴다 (' + notes + '/' + returns + ')', notes >= returns, 'returns=' + returns + ' notes=' + notes);
  t('draft 로 남은 경우를 경고한다', /draft 라 발송되지 않는다/.test(src));
  t('RSS 부족도 사유로 남긴다', /RSS 수집 부족/.test(src));
}

console.log("\n[7] 0통을 '발송 완료' 라 하지 않는다");
{
  const src = R('api/cron/send-due-campaigns.js');
  t('전원 실패면 status 를 failed 로', /allFailed \? 'failed' : 'sent'/.test(src));
  t('받는 사람이 있을 때만 실패로 본다', /recipientList\.length > 0 && sent === 0/.test(src));

  const em = R('api/_lib/email.js');
  t('SMTP 미설정 사유를 돌려준다', /error: 'SMTP 미설정/.test(em));
  t('warn 이 아니라 error 로 남긴다 (검색되게)', /console\.error\('\[EMAIL\] SMTP 미설정/.test(em));
}

console.log('\n[8] 배선');
{
  const w = R('api/cron/pipeline-watch.js');
  t('핸들러가 감시를 부른다', /const newsletter = await checkNewsletter\(\{ dry \}\)/.test(w));
  t('응답에 실린다', /heartbeat, ytVideos, newsletter \}\)/.test(w));
  t('알림 키가 따로다', /NEWSLETTER_ALERT_KEY = 'nl:weekly'/.test(w));
  t('감시 실패가 본 크론을 안 죽인다', /뉴스레터 감시 실패/.test(w));
  t('회복하면 정상 알림도 보낸다', /✅ 뉴스레터 정상/.test(w));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ newsletter-watch tests FAILED'); process.exit(1); }
console.log('✅ newsletter-watch tests passed');
process.exit(0);
