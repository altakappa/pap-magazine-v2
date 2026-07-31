/**
 * 크론 관측성 감사 (2026-07-30 신설).
 *
 * 왜 필요했나 — 오늘 두 종류의 "조용한 누수" 를 확인했다:
 *   ① 개별 항목 실패를 삼키고 ok=true 로 기록 → 서술문 백필이 두 달간 20% 성공률
 *   ② withCronGuard 미적용 → 실행 기록도, 실패 알림도 없음
 *
 *   ②는 더 위험하다. 크론이 아예 죽어도 cron_runs 에 아무 흔적이 없어
 *   "언제부터 안 돌았는지" 조차 알 수 없다. 실제로 7/24~26 IG 토큰 만료로
 *   sync-instagram 이 1,521회 실패했는데, 그건 cronGuard 가 있어서 알 수 있었다.
 *   가드가 없는 크론에서 같은 일이 생기면 아무도 모른다.
 *
 * 이 테스트가 지키는 것: 사업 영향이 큰 크론은 반드시 관측 가능해야 한다.
 * 새 크론을 만들 때 가드를 빠뜨리면 여기서 걸린다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CRON_DIR = path.join(__dirname, '..', 'api', 'cron');
const R = f => fs.readFileSync(path.join(CRON_DIR, f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

/* 실패가 곧 사업 손실인 크론 — 반드시 실행기록 + 실패알림이 있어야 한다.
   (한 줄 설명은 "왜 중요한가" 다. 새로 추가할 때 같은 기준으로 판단할 수 있게.) */
const MUST_GUARD = {
  'release-due-scheduled.js': '예약 발행 — 죽으면 기사가 발행되지 않는다',
  'send-due-campaigns.js':    '뉴스레터 발송 — 죽으면 구독자에게 안 간다',
  'sync-instagram.js':        'IG → 웹사이트 수집 — 모든 채널의 소재 공급원',
  'sync-pepperit.js':         'PEPPERIT 수집 — 자매지 콘텐츠 공급',
  'backfill-meta-desc.js':    'GEO 서술문 — AI 검색 인용 텍스트 생산',
  'backfill-translations.js': '9개 언어 번역 — 해외 SEO',
  'backfill-faq.js':          'FAQ 스키마 — 검색 리치결과',
  'tiktok-post.js':           '틱톡 자동게시',
  'threads-post.js':          '스레드 자동게시',
  'youtube-post.js':          '유튜브 자동게시',
  'pipeline-watch.js':        '파이프라인 감시 — 감시자가 죽으면 전부 눈이 먼다',
};

console.log('\n=== 핵심 크론의 실행기록·실패알림 (withCronGuard) ===');
for (const [file, why] of Object.entries(MUST_GUARD)) {
  let src = '';
  try { src = R(file); } catch (_) { t(file + ' 파일 존재', false, '파일이 없다'); continue; }
  t(file.replace('.js', '') + ' — ' + why,
    /module\.exports\s*=\s*withCronGuard\(/.test(src),
    'withCronGuard 로 감싸지 않으면 cron_runs 기록도, 텔레그램 실패 알림도 없다');
}

console.log('=== 가드의 계약 (구멍 재발 방지) ===');
(function () {
  const g = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'cronGuard.js'), 'utf8');
  // 2026-07-21 에 막은 구멍 — 자체 try/catch 로 삼키고 5xx 만 반환하는 핸들러
  t('5xx 응답도 실패로 기록한다', /statusCode >= 500/.test(g),
    '핸들러가 예외를 자체 처리하고 500 을 반환하면 성공으로 기록되던 구멍이 있었다');
  t('실패 알림에 쿨다운', /ALERT_COOLDOWN_HOURS/.test(g));
  t('일시성 실패는 알림 제외 옵션', /silenceTransient/.test(g));
  t('로그는 실패든 성공이든 항상 남긴다', /_logRun\(cronName, ok/.test(g));

  /* ── 2026-07-31 · 기록이 응답보다 먼저 ──────────────────────────
     실측: backfill-translations 가 HTTP 200 을 돌려주는데 cron_runs 에는
     아무 기록이 없었다(02:42·02:47 두 번 모두). 같은 시각 1~4초짜리 짧은
     크론들은 정상 기록됐다 — 차이는 실행 길이다. 응답이 나간 뒤 서버리스
     인스턴스가 얼면 뒤따르는 INSERT 가 끝나지 못한다.
     기록이 사라지면 '조용한 실패' 를 감지할 수단 자체가 없어진다. */
  const logIdx = g.indexOf('await _logRun(cronName, ok');
  const flushIdx = g.indexOf('flush();');
  t('json 응답을 붙잡아 뒀다가 보낸다', /res\.json = function/.test(g) && flushIdx > -1,
    '긴 실행에서 응답 후 INSERT 가 유실됐다');
  t('기록(_logRun)이 응답 전송(flush)보다 먼저다', logIdx > -1 && flushIdx > logIdx,
    `_logRun@${logIdx} flush@${flushIdx} — 순서가 뒤집히면 같은 유실이 재발한다`);
  t('json 을 안 쓰는 크론은 그대로 동작', /typeof res\.json === 'function'/.test(g),
    'res.send/res.end 를 쓰는 크론까지 건드리면 안 된다');
})();

console.log('=== AI 호출 크론은 장애 원인까지 알린다 ===');
(function () {
  // 결과 지표 감시(성공률)는 "이미 실패한 뒤" 울린다. 크레딧·키 문제는
  // 원인이 명확하므로 호출 지점에서 즉시 알려야 한다.
  const aiCrons = ['weekly-news.js', 'daily-growth-feedback.js', 'weekly-briefing.js'];
  for (const f of aiCrons) {
    const s = R(f);
    if (!/api\.anthropic\.com/.test(s)) { t(f + ' (AI 호출 없음 — 해당 없음)', true); continue; }
    t(f.replace('.js', '') + ' — AI 장애 알림 연결', /reportAi(Response|Failure)\(/.test(s),
      'aiCreditWatch 를 연결하면 크레딧 소진·키 오류를 즉시 알 수 있다');
  }
})();

console.log('=== 감시 크론 자체의 이중화 ===');
(function () {
  const w = R('pipeline-watch.js');
  t('IG 파이프라인 + 서술문 백필 둘 다 본다',
    /diagnose\(/.test(w) && /checkBackfill\(/.test(w));
  t('한쪽 감시 실패가 다른 쪽을 죽이지 않는다', /backfill health 실패/.test(w));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ cron-observability tests FAILED'); process.exit(1); }
console.log('✅ cron-observability tests passed');
