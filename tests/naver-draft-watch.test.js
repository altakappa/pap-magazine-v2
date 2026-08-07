/**
 * 네이버 초안 생산 감시 (2026-08-07 신설)
 *
 * 왜 필요했나 — 08-05 에 건 큐 상한(30)이 08-05 17:01 부터 초안 생성을
 * 완전히 멈췄는데, 크론은 4시간마다 ok=true 로 "큐 상한 도달"만 남겼다.
 * 이틀 뒤 사람이 눈으로 발견했다. 성공을 말하면서 생산은 0인 문장이었다.
 *
 * 이 감시엔 다른 감시에 없는 함정이 하나 더 있다 — 초안 후보가
 * '최근 3일 발행 기사'로 한정된다. 3일 넘게 멎으면 그 구간은 영구 유실이다.
 *
 * 여기서 지키는 것:
 *   ① 만들 게 없으면(미전환 0) 울리지 않는다 — 오탐 방지
 *   ② 하나라도 만들었으면 정상
 *   ③ 실행 표본이 2회 미만이면 판단 보류
 *   ④ 전 회차가 '큐 상한 도달'이면 cause='queue-full'
 *   ⑤ 상한도 아닌데 생산 0이면 cause='stalled'
 *   ⑥ 알림 문구에 룩백 유실 경고와 원인별 조치가 들어간다
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const Module = require('module');

// DB·인증·알림·IG 를 전부 스텁으로 — 순수 판정 로직만 검증한다.
// (tests/pipeline-watch.test.js 와 같은 방식)
function stub(rel, exports) {
  const p = path.join(__dirname, '..', 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [],
  isLikelyEditorialCaption: () => false,
  _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_name, fn) => fn });
stub('backfillHealth.js', { diagnoseBackfill: () => ({}), buildBackfillAlert: () => ({}) });
stub('translateHealth.js', { judgeTranslateHealth: () => ({}), buildTranslateAlert: () => ({}) });
stub('faqHealth.js', { judgeFaqHealth: () => ({}), buildFaqAlert: () => ({}), summarizeFaqRuns: () => ({}) });
stub('cronDurationHealth.js', { summarizeDurations: () => ({}), judgeCronDuration: () => ({}), buildCronDurationAlert: () => ({}) });


let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const mod = require(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'));
const judge = mod.judgeNaverDraftHealth;
const build = mod.buildNaverDraftAlert;

console.log('\n=== ① 오탐 방지 ===');
{
  const d = judge({ pendingSources: 0, producedInWindow: 0, runsInWindow: 6, queueSkipRuns: 0 });
  t('미전환 0건이면 생산 0이어도 정상', d.healthy === true, d.reason);
  t('원인 없음', d.cause === null, d.cause);
}
{
  const d = judge({ pendingSources: 10, producedInWindow: 0, runsInWindow: 1, queueSkipRuns: 1 });
  t('실행 1회면 판단 보류', d.healthy === true, d.reason);
}

console.log('\n=== ② 정상 ===');
{
  const d = judge({ pendingSources: 5, producedInWindow: 4, runsInWindow: 6, queueSkipRuns: 0 });
  t('생산이 있으면 정상', d.healthy === true, d.reason);
  t('생산 건수가 문구에 담긴다', /4건 생성/.test(d.reason), d.reason);
}

console.log('\n=== ③ 큐 상한으로 멈춤 ===');
{
  const d = judge({ pendingSources: 32, producedInWindow: 0, runsInWindow: 6,
    queueSkipRuns: 6, queueDraft: 42, windowHours: 24, lookbackDays: 3 });
  t('고장으로 판정', d.healthy === false, d.reason);
  t("cause='queue-full'", d.cause === 'queue-full', d.cause);
  t('유실 예고가 문구에 있다', /유실/.test(d.reason), d.reason);

  const a = build(d, 'https://x.test');
  t('제목에 미전환 건수', /32건/.test(a.title), a.title);
  t('조치에 큐 비우기 안내', a.lines.some((l) => /발행해 큐를 비우/.test(l)), a.lines);
  t('조치에 QUEUE_MAX 안내', a.lines.some((l) => /NAVER_DRAFT_QUEUE_MAX/.test(l)), a.lines);
  t('룩백 유실 경고 포함', a.lines.some((l) => /영구 유실/.test(l)), a.lines);
  t('링크가 초안 목록', /\/naver-blog$/.test(a.url), a.url);
}

console.log('\n=== ④ 상한이 아닌 진짜 정지 ===');
{
  const d = judge({ pendingSources: 12, producedInWindow: 0, runsInWindow: 6, queueSkipRuns: 0 });
  t('고장으로 판정', d.healthy === false, d.reason);
  t("cause='stalled'", d.cause === 'stalled', d.cause);
  const a = build(d);
  t('원인 후보에 SWEEP_ENABLED', a.lines.some((l) => /NAVER_DRAFT_SWEEP_ENABLED/.test(l)), a.lines);
}
{
  const d = judge({ pendingSources: 12, producedInWindow: 0, runsInWindow: 6, queueSkipRuns: 3 });
  t('일부만 상한이면 stalled', d.cause === 'stalled', d.cause);
}

console.log('\n=== ⑤ 배선 ===');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'), 'utf8');
  t('핸들러가 checkNaverDrafts 를 호출한다', /const naver = await checkNaverDrafts\(/.test(src));
  t('응답에 naver 가 실린다', /faq, duration, naver \}\)/.test(src));
  t('알림 키가 분리돼 있다', /NAVER_ALERT_KEY = 'naver-draft-health'/.test(src));
  t('생산량을 표에서 직접 센다', /from\('naver_blog_drafts'\)[\s\S]{0,120}count: 'exact'/.test(src));
  t('감시 실패가 본 크론을 죽이지 않는다', /naver draft health 실패/.test(src));
}

console.log('\n' + (fail ? '✗' : '✓') + ' naver-draft-watch: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
