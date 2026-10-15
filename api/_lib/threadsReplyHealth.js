/**
 * 스레드 링크 답글 건강 판정 (2026-10-15 신설).
 *
 * 발견: 스레드 본글은 하루 8건씩 멀쩡히 나가는데, 그 밑에 붙는 **링크 답글
 * (인스타 먼저 → 웹)** 은 30일 동안 단 한 번도 성공한 적이 없다. 10/04 부터는
 * 전부 "Application does not have permission for this action"(code 10).
 * 원인은 토큰 권한이다 — SCOPES 에 threads_manage_replies 가 없었다.
 * reply_to_id 로 답글을 만들려면 이 권한이 있어야 한다.
 *
 * 왜 10일 넘게 아무도 몰랐나: 실패가 threads_posts.detail 에만 적히고 본글은
 * status='published' 라 cron_runs 는 전부 ok 였다. 틱톡(8/07)·네이버(9월)와 같은
 * 구멍 — "본체는 성공, 꼬리는 조용히 실패". 그래서 이 판정은 detail 을 직접 센다.
 *
 * 판정 규칙 (순수 함수 — 테스트 가능):
 *   ① 창 안에 링크 답글을 시도할 본글이 없으면(0건) 판단 보류.
 *   ② 표본이 MIN_SAMPLE 미만이면 판단 보류 (새벽 1~2건으로 울지 않는다).
 *   ③ 실패율이 FAIL_RATIO 이상이면 고장. code 10/permission 이 다수면 cause 'scope'.
 *   ④ 그 외는 정상.
 */
'use strict';

const MIN_SAMPLE = 4;
const FAIL_RATIO = 0.5;

function classify(detail) {
  const s = String(detail || '');
  if (!/링크 답글 실패/.test(s)) return null;
  if (/permission|"code"\s*:\s*10\b|\bcode 10\b/i.test(s)) return 'scope';
  return 'other';
}

/**
 * @param {{attempted:number, failed:number, scopeFails:number, windowHours:number}} x
 */
function judgeThreadsReplyHealth(x) {
  const attempted = Number(x && x.attempted) || 0;
  const failed = Number(x && x.failed) || 0;
  const scopeFails = Number(x && x.scopeFails) || 0;
  const windowHours = Number(x && x.windowHours) || 24;
  const base = { attempted, failed, scopeFails, windowHours };
  if (attempted === 0) {
    return { ...base, healthy: true, cause: null, reason: `${windowHours}시간 링크 답글 대상 본글 0건 — 판단 보류` };
  }
  if (attempted < MIN_SAMPLE) {
    return { ...base, healthy: true, cause: null, reason: `본글 ${attempted}건 — 표본 부족으로 판단 보류` };
  }
  const ratio = failed / attempted;
  if (ratio >= FAIL_RATIO) {
    const cause = scopeFails * 2 >= failed ? 'scope' : 'other';
    return { ...base, healthy: false, cause,
      reason: `${windowHours}시간 본글 ${attempted}건 중 링크 답글 실패 ${failed}건 (${Math.round(ratio * 100)}%)` + (cause === 'scope' ? ' · 권한 오류(code 10)' : '') };
  }
  return { ...base, healthy: true, cause: null,
    reason: `${windowHours}시간 본글 ${attempted}건 · 링크 답글 실패 ${failed}건` };
}

function buildThreadsReplyAlert(d, site) {
  const lines = [d.reason, ''];
  if (d.cause === 'scope') {
    lines.push('토큰에 threads_manage_replies 권한이 없습니다. 답글이 하나도 안 붙으면');
    lines.push('스레드 글 전부가 링크 없는 글이 됩니다 (인스타·웹 유입 0).');
    lines.push('');
    lines.push('조치 (도메니코): ① Meta 개발자 콘솔 → Threads 앱 → 사용 사례에 threads_manage_replies 추가');
    lines.push(`          ② ${site}/api/threads/oauth 로 재인증 (관리자 로그인 상태)`);
  } else {
    lines.push('원인 후보: Threads API 장애 / 컨테이너 처리 지연 (Vercel 로그 [threadsAutopost] 링크 답글 실패)');
  }
  return {
    title: `🧵 스레드 링크 답글 실패 ${d.failed}/${d.attempted}`,
    lines,
    url: `${site}/threads-diagnose`,
    urlLabel: '스레드 진단',
  };
}

module.exports = { judgeThreadsReplyHealth, buildThreadsReplyAlert, classify, MIN_SAMPLE, FAIL_RATIO };
