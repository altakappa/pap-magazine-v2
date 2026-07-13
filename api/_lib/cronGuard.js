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
 */

const { supabaseAdmin } = require('./supabase');
const { sendEmail } = require('./email');

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
function withCronGuard(cronName, handler) {
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
      // 로그는 항상 기록
      await _logRun(cronName, ok, duration, note, error);
      // 실패 알림 (쿨다운 있음)
      if (!ok) {
        try {
          const skip = await _hasRecentAlert(cronName);
          if (!skip) await _sendAlert(cronName, error, duration);
        } catch (e) {
          console.error('[cronGuard] alert check 실패:', e && e.message);
        }
      }
    }
  };
}

module.exports = { withCronGuard };
