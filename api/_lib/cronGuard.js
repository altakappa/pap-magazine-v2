/**
 * cronGuard — 크론 wrapper. 조용한 실패 방지.
 *
 * 각 크론 핸들러를 감싸서:
 *   1) 실행 결과를 cron_runs 테이블에 기록 (성공/실패 · 소요시간 · note/error)
 *   2) 실패 시 관리자 이메일 즉시 발송
 *   3) admin 대시보드에서 최근 24시간 상태를 볼 수 있게 함
 *
 * 사용법:
 *   const { withCronGuard } = require('../_lib/cronGuard');
 *   async function handler(req, res) { ... }
 *   module.exports = withCronGuard('sync-instagram', handler);
 *
 * 요약 메시지를 남기려면 res.locals.cronNote 에 문자열 저장:
 *   res.locals = res.locals || {};
 *   res.locals.cronNote = '1건 임포트: xxx';
 *
 * 옵션 (3번째 인자):
 *   { silenceTransient: true }
 *     — 네트워크·타임아웃 류 '일시성' 실패는 cron_runs 에 기록은 하되
 *       텔레그램/이메일 알림은 보내지 않는다. (2026-07-27 신설)
 *       왜: sync-instagram 의 backfill 변형은 대량 조회라 20초 타임아웃이
 *       '정상 동작의 일부'다 — 실패해도 다음 10분 크론이 이어받고, 신규 유입은
 *       끊기지 않는다. 그런데 매 실행 실패로 기록돼 6시간마다 "🚨 크론 실패"가
 *       울렸다(24h 469회 실패 실측). 이건 노이즈다.
 *       진짜 '유입 정지'(크레딧 소진·토큰 만료로 아무것도 안 들어옴)는 이미
 *       pipeline-watch(신규 0건 감지)가 잡는다. 역할을 나눈다:
 *         cronGuard = 예상외 크래시(스키마·토큰 401·코드 버그)만 알림
 *         pipeline-watch = 결과(유입) 기반 정체 감지
 *       그래서 일시성 에러는 여기서 조용히 로그만 남긴다. 로그는 대시보드·DB 에
 *       그대로 있어 진단 가능하다.
 */

// 일시성(재시도로 자연 복구되는) 실패 패턴 — 알림에서 제외 대상.
// abort/timeout = fetch 20~45초 초과, 나머지는 소켓·DNS·순간 네트워크.
const TRANSIENT_RE = /aborted|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|fetch failed|und_err/i;

const { supabaseAdmin } = require('./supabase');
const { sendEmail } = require('./email');
const { sendTextToTelegramPersonalSafe } = require('./telegram');

// 관리자 이메일 (env 로 오버라이드 가능)
const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'contact@pap-magazine.com';

// 같은 크론이 짧은 시간에 여러 번 실패 시 이메일 스팸 방지.
// 최근 6시간 내에 같은 크론에서 이미 실패 알림을 보냈으면 스킵.
const ALERT_COOLDOWN_HOURS = 6;

async function _hasRecentAlert(cronName) {
  const cutoff = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from('cron_runs')
    .select('id')
    .eq('cron_name', cronName)
    .eq('ok', false)
    .gte('ran_at', cutoff)
    .limit(1);
  return !!(data && data.length);
}

async function _sendAlert(cronName, error, durationMs) {
  try {
    // 2026-07-23 (도메니코 지시) — 크론 실패 알림은 이메일 대신 개인
    // 텔레그램으로. TELEGRAM_PERSONAL_CHAT_ID 미설정/전송 실패 시에만
    // 기존 이메일로 폴백해 알림이 유실되지 않게 한다.
    const tg = await sendTextToTelegramPersonalSafe(
      '🚨 [PAP 크론 실패] ' + cronName + '\n' +
      '시각: ' + new Date().toISOString() + ' · 소요 ' + durationMs + 'ms\n\n' +
      '에러: ' + String(error || '').slice(0, 800) + '\n\n' +
      '다음 스텝: Vercel Function Logs 상세 확인 · 이 알림은 6시간에 1회'
    );
    if (tg && tg.ok) return;

    const subject = `[PAP 크론 실패] ${cronName}`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:600px;padding:20px">
        <h2 style="color:#c00">🚨 크론 실행 실패</h2>
        <p><strong>크론:</strong> ${cronName}</p>
        <p><strong>시각:</strong> ${new Date().toISOString()}</p>
        <p><strong>소요:</strong> ${durationMs}ms</p>
        <h3>에러</h3>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-word">${_escapeHtml(error)}</pre>
        <h3>다음 스텝</h3>
        <ul>
          <li>Vercel Function Logs 에서 상세 스택 확인</li>
          <li>스키마 캐시 오류라면 supabase_migrations/ 최신 파일이 Supabase 에 적용됐는지 확인</li>
          <li>Graph API 401 이라면 IG_ACCESS_TOKEN 갱신 필요 (60일 만료)</li>
          <li>이 알림은 6시간에 한 번만 옴 — 근본 원인 해결 안 하면 계속 실패 중</li>
        </ul>
        <hr>
        <p style="color:#888;font-size:12px">PAP Magazine 자동 알림 · cronGuard</p>
      </div>`;
    await sendEmail(ADMIN_EMAIL, { subject, html });
  } catch (e) {
    console.error('[cronGuard] alert email 발송 실패:', e && e.message);
  }
}

function _escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function _logRun(cronName, ok, durationMs, note, error) {
  try {
    await supabaseAdmin.from('cron_runs').insert({
      cron_name: cronName,
      ok,
      duration_ms: durationMs,
      note: note ? String(note).slice(0, 500) : null,
      error: error ? String(error).slice(0, 800) : null,
    });
  } catch (e) {
    console.error('[cronGuard] cron_runs INSERT 실패:', e && e.message);
  }
}

/**
 * 크론 핸들러를 감싸서 로깅·알림을 추가.
 * @param {string} cronName - 로그·이메일에 표시할 크론 이름
 * @param {function} handler - 원래 크론 핸들러 (req, res) => any
 * @returns {function} wrapped handler
 */
function withCronGuard(cronName, handler, opts) {
  const silenceTransient = !!(opts && opts.silenceTransient);
  return async function guarded(req, res) {
    const start = Date.now();
    let error = null;
    let ok = true;
    try {
      await handler(req, res);
    } catch (e) {
      ok = false;
      error = String(e && e.message || e);
      console.error(`[cronGuard:${cronName}] uncaught:`, e);
      if (!res.headersSent) {
        try { res.status(500).json({ error: 'cron failed', detail: error.slice(0, 300) }); } catch (_) {}
      }
    } finally {
      const duration = Date.now() - start;
      const note = (res.locals && res.locals.cronNote) ? res.locals.cronNote : null;

      // 2026-07-21 — 자체 try/catch 로 에러를 삼키고 res.status(500) 만 반환하는
      // 핸들러(브리핑 3종이 이 방식)를 '성공'으로 기록하던 구멍을 막는다.
      // 예외가 밖으로 안 나와도 5xx 응답이면 실패다.
      if (ok && res && typeof res.statusCode === 'number' && res.statusCode >= 500) {
        ok = false;
        error = 'HTTP ' + res.statusCode + ' (핸들러가 예외를 자체 처리하고 5xx 반환)';
      }

      // 로그는 항상 기록 (일시성 실패도 진단용으로 남긴다)
      await _logRun(cronName, ok, duration, note, error);
      // 실패 알림 (쿨다운 있음). 단, silenceTransient 크론의 일시성 실패는
      // 로그만 남기고 알림하지 않는다 — 재시도로 자연 복구되는 노이즈.
      if (!ok) {
        const transient = silenceTransient && TRANSIENT_RE.test(error || '');
        if (!transient) {
          try {
            const skip = await _hasRecentAlert(cronName);
            if (!skip) await _sendAlert(cronName, error, duration);
          } catch (e) {
            console.error('[cronGuard] alert check 실패:', e && e.message);
          }
        }
      }
    }
  };
}

module.exports = { withCronGuard };
