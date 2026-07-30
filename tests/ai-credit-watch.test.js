/**
 * Anthropic 장애 알림 회귀 (2026-07-30 신설).
 *
 * 왜 필요했나: 크레딧이 4시간 비어 서술문 생성이 0건이었는데 아무 알림이 없었다.
 * 결과 지표(성공률) 감시는 같은 날 붙였지만 그건 "이미 수십 건 실패한 뒤" 울린다.
 * 크레딧·키 문제는 원인과 조치가 명확하니 원인 단계에서 즉시 알려야 한다.
 *
 * 여기서 지키는 것:
 *   ① 크레딧/키/레이트리밋을 구분한다 — 조치가 각각 다르다
 *   ② 일시적 5xx 는 알리지 않는다 — 소음이 되면 아무도 안 본다
 *   ③ 감시가 호출부를 죽이지 않는다
 *   ④ 비밀값이 알림에 실리지 않는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
/* aiCreditWatch 는 supabase 클라이언트를 모듈 로드 시점에 만든다(공용 헬퍼 관행).
   테스트는 DB 없이 돌아야 하므로 더미 env 를 먼저 심는다 — 실제 호출은 하지 않는다. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service';
const { classifyAiFailure } = require('../api/_lib/aiCreditWatch');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== 장애 유형 판별 ===');
// 2026-07-30 실제 응답 본문
const REAL = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
t('실제 크레딧 소진 응답을 credit 으로', classifyAiFailure(400, REAL) === 'credit');
t('키 무효(401) 를 auth 로', classifyAiFailure(401, '{"error":{"type":"authentication_error"}}') === 'auth');
t('403 도 auth 로', classifyAiFailure(403, '') === 'auth');
t('429 를 rate 로', classifyAiFailure(429, 'rate_limit_error') === 'rate');
t('본문에 rate_limit 만 있어도 rate', classifyAiFailure(400, 'rate_limit exceeded') === 'rate');

console.log('=== 소음 방지 (알리지 않아야 하는 것) ===');
t('일시적 500 은 무시', classifyAiFailure(500, 'internal server error') === null,
  '일시적 장애까지 알리면 알림이 소음이 되어 아무도 안 본다');
t('529 overloaded 는 무시', classifyAiFailure(529, '{"type":"overloaded_error"}') === null);
t('빈 400 은 무시', classifyAiFailure(400, '') === null);
t('타임아웃/네트워크(status 없음) 은 무시', classifyAiFailure(undefined, '') === null);

console.log('=== 유형별 조치 안내 ===');
(function () {
  const src = R('api/_lib/aiCreditWatch.js');
  t('credit → 충전 + 자동충전 안내', /Plans & Billing/.test(src) && /auto-reload/.test(src),
    '알림만 받고 뭘 해야 할지 모르면 무용지물이다');
  t('auth → 키 재발급 + env 교체 안내', /ANTHROPIC_API_KEY 교체/.test(src));
  t('rate → 동시성 낮추기 안내', /CONCURRENCY/.test(src));
})();

console.log('=== 안전장치 ===');
(function () {
  const src = R('api/_lib/aiCreditWatch.js');
  t('절대 throw 하지 않는다', /catch \(e\) \{[\s\S]{0,120}console\.error\('\[aiCreditWatch\]/.test(src));
  t('쿨다운으로 반복 알림 차단', /AI_ALERT_COOLDOWN_H/.test(src) && /cooled/.test(src),
    '크레딧이 빈 동안 10분마다 크론이 돈다 — 쿨다운 없으면 수십 통이 온다');
  t('유형이 바뀌면 쿨다운 무시', /lastKind !== kind/.test(src),
    '크레딧 문제와 키 문제는 조치가 달라 즉시 알려야 한다');
  t('응답 본문을 200자로 자른다', /slice\(0, 200\)/.test(src), '비밀값·내부 구조 노출 방지');
  t('알림은 개인방으로만', /personalOnly: true/.test(src));
})();

console.log('=== 무인 실행 호출부 연결 ===');
(function () {
  const wired = [
    ['api/_lib/editorialAi.js', 'GEO 서술문 생성 (핵심)'],
    ['api/_lib/threadsAutopost.js', '스레드 자동게시'],
    ['api/_lib/socialRepurpose.js', '소셜 재가공'],
    ['api/_lib/pepperitImport.js', 'PEPPERIT 수집'],
    ['api/cron/weekly-news.js', '주간 뉴스레터'],
    ['api/cron/daily-growth-feedback.js', '일일 성장 피드백'],
    ['api/cron/weekly-briefing.js', '주간 브리핑'],
    ['api/admin/naver-blog-draft.js', '네이버 초안 (최초 발견 지점)'],
  ];
  for (const [f, label] of wired) {
    const s = R(f);
    t(label, /require\((['"]).*aiCreditWatch\1\)/.test(s) && /reportAi(Response|Failure)\(/.test(s), f);
  }
  // 서술문 생성은 두 모드(진술문/비전) 모두 걸려 있어야 한다
  const ed = R('api/_lib/editorialAi.js');
  t('서술문 생성 두 모드 모두 연결',
    /editorialAi\.statement/.test(ed) && /editorialAi\.vision/.test(ed));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ai-credit-watch tests FAILED'); process.exit(1); }
console.log('✅ ai-credit-watch tests passed');
