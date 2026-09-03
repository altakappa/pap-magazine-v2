/**
 * deployReach.js — 푸시가 실제로 배포에 도달했나 (2026-09-03 신설)
 *
 * ■ 왜 만들었나 — 오늘 실제로 겪었다
 * 2026-09-03 12:07 KST 에 커밋 두 개를 푸시했다. GitHub 에는 정상 반영됐는데
 * **Vercel 배포가 한 시간 넘게 안 걸렸다.** 라이브는 계속 이전 커밋을 서빙했고,
 * 아무 알림도 없었다. 다음 푸시가 밀려 올라가면서 우연히 함께 배포됐다.
 *
 * 그 한 시간 동안 "고쳤다" 고 믿은 것들이 전부 라이브에 없었다. 이 대화에서
 * 반복된 모든 실패가 같은 모양이다 — **일은 안 됐는데 아무도 모르는 상태.**
 * 크론 쪽은 생산량 계약(productionHealth)으로 막았고, 여기는 그 마지막 구멍이다.
 *
 * ■ 무엇을 비교하나
 *   배포된 커밋   process.env.VERCEL_GIT_COMMIT_SHA  (빌드 시점에 구워진다)
 *   원격 최신     GitHub API 의 main 브랜치 HEAD
 * 둘이 오래 어긋나면 푸시가 배포에 도달하지 못한 것이다.
 *
 * ■ 스스로의 한계를 안다 (중요)
 * 이 검사는 **배포된 코드 안에서** 돈다. 그래서 배포가 아예 안 되는 상황에서는
 * 이 파일의 *새* 버전도 라이브에 없다. 즉 이 검사는 "지금 라이브에 있는 나"가
 * "그 뒤에 안 올라온 것들"을 보는 것이다 — 그게 정확히 오늘의 사고 모양이고,
 * 그 경우는 잡는다. 다만 이 검사를 처음 배포하기 전의 공백은 못 메운다.
 *
 * ■ 모르면 알리지 않는다
 * 어느 한쪽을 못 읽으면 '모름' 이다. 우리가 못 보는 것을 사고라고 부르면
 * 헛알림이 되고, 헛알림은 진짜 경보를 죽인다 (productionHealth 와 같은 방침).
 *
 * 아무것도 require 하지 않는다 — DB·네트워크 없이 규칙만 검증하기 위해서다.
 */

'use strict';

/* 빌드가 도는 동안은 정상적으로 어긋나 있다. 오늘 실측 빌드는 3.5분이었고,
   큐가 밀리면 더 걸린다. 15분을 넘으면 '도달 못 함' 으로 본다. */
const GRACE_MIN = 15;

/** 짧은 해시·긴 해시를 섞어 비교해도 안전하게. */
function sameSha(a, b) {
  if (!a || !b) return false;
  const x = String(a).trim().toLowerCase();
  const y = String(b).trim().toLowerCase();
  if (!x || !y) return false;
  const n = Math.min(x.length, y.length, 40);
  if (n < 7) return false;           // 7자 미만은 비교로 인정하지 않는다
  return x.slice(0, n) === y.slice(0, n);
}

/**
 * @param {object} p
 * @param {?string} p.deployedSha       라이브가 서빙 중인 커밋
 * @param {?string} p.originSha         원격 main 의 HEAD
 * @param {?number} p.mismatchSince     어긋남을 처음 본 시각(ms). 없으면 이번이 처음
 * @param {number}  [p.now]
 * @param {number}  [p.graceMin]
 * @returns {{status:'일치'|'배포중'|'미도달'|'모름', ageMin:number,
 *            deployedSha:?string, originSha:?string, reason:string}}
 */
function judgeDeployReach({ deployedSha, originSha, mismatchSince, now = Date.now(), graceMin = GRACE_MIN }) {
  const short = (s) => (s ? String(s).slice(0, 7) : null);
  const base = { deployedSha: short(deployedSha), originSha: short(originSha), ageMin: 0 };

  if (!deployedSha || !originSha) {
    return {
      ...base, status: '모름',
      reason: !deployedSha
        ? '배포 커밋을 모른다 (VERCEL_GIT_COMMIT_SHA 없음 — 로컬이거나 빌드 환경 밖)'
        : '원격 HEAD 를 못 읽었다 (GitHub 조회 실패)',
    };
  }

  if (sameSha(deployedSha, originSha)) {
    return { ...base, status: '일치', reason: '라이브가 원격 최신과 같다' };
  }

  const since = typeof mismatchSince === 'number' ? mismatchSince : now;
  const ageMin = Math.max(0, Math.round((now - since) / 60000));
  if (ageMin < graceMin) {
    return { ...base, ageMin, status: '배포중', reason: ageMin + '분째 — 아직 유예 안(빌드 중일 수 있다)' };
  }
  return {
    ...base, ageMin, status: '미도달',
    reason: ageMin + '분째 라이브가 옛 커밋을 서빙 중 — 푸시가 배포로 이어지지 않았다',
  };
}

/** 텔레그램 문구. 새벽에 받아도 바로 손쓸 수 있게 다음 행동까지 적는다. */
function buildDeployAlert(d) {
  if (!d || d.status !== '미도달') return null;
  return [
    '🔴 푸시가 배포에 도달하지 않았습니다',
    '',
    '· 라이브: ' + d.deployedSha,
    '· 원격  : ' + d.originSha,
    '· ' + d.ageMin + '분째 어긋나 있습니다',
    '',
    '고친 코드가 라이브에 없습니다. 그동안의 "배포됐다" 는 전부 사실이 아닙니다.',
    '할 일: Vercel 대시보드에서 최신 커밋을 Redeploy 하세요.',
    '(2026-09-03 에 같은 일이 있었고 한 시간 넘게 아무도 몰랐습니다.)',
  ].join('\n');
}

module.exports = { judgeDeployReach, buildDeployAlert, sameSha, GRACE_MIN };
