/**
 * PAP Magazine — 즉시 푸시 알림 (2026-07-17)
 *
 * 왜: 새벽 속보는 이메일로 알려도 못 본다. 폰이 울려야 한다.
 * 다중 채널 — 환경변수가 설정된 채널로만 발송하고, 한 채널 실패가
 * 다른 채널을 막지 않는다 (전부 실패해도 호출부 로직은 계속 진행).
 *
 * 채널별 환경변수 (Vercel):
 *   텔레그램 (팀 그룹 + 개인)
 *     TELEGRAM_BOT_TOKEN   BotFather 에서 발급
 *     TELEGRAM_CHAT_IDS    쉼표 구분 다중 채팅방 ID (그룹은 -100... 형식)
 *   카카오톡 나에게 보내기 (도메니코 개인 — 절대 놓치면 안 되는 채널)
 *     KAKAO_REST_API_KEY   카카오 디벨로퍼스 앱 REST API 키
 *     KAKAO_REFRESH_TOKEN  최초 1회 인가로 받은 리프레시 토큰
 *     ※ 액세스 토큰은 6시간 만료 → 발송 직전 리프레시로 새로 발급 (여기서 자동 처리)
 *   슬랙/디스코드 (선택)
 *     SLACK_WEBHOOK_URL / DISCORD_WEBHOOK_URL
 *
 * 카카오톡 그룹 채팅방 발송은 카카오 API 가 지원하지 않는다 (나에게/친구에게만).
 * 팀 공유는 텔레그램 그룹이 담당한다.
 */

const TIMEOUT = 8000;

/* ── 텔레그램 ─────────────────────────────────────── */
async function sendTelegram({ title, lines, url, urlLabel }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const idsRaw = process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID;
  if (!token || !idsRaw) return { skipped: 'telegram env 미설정' };

  const ids = String(idsRaw).split(',').map(s => s.trim()).filter(Boolean);
  const text = ['*' + escapeMd(title) + '*', '', ...lines.map(escapeMd)].join('\n');
  const results = [];
  for (const chatId of ids) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false,
          reply_markup: url ? { inline_keyboard: [[{ text: urlLabel || '열기', url }]] } : undefined,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      results.push({ chatId, ok: r.ok, status: r.status });
    } catch (e) {
      results.push({ chatId, ok: false, error: String(e && e.message || e).slice(0, 80) });
    }
  }
  return { telegram: results };
}
// MarkdownV2 예약문자 이스케이프
function escapeMd(s) {
  return String(s == null ? '' : s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/* ── 카카오톡 "나에게 보내기" ───────────────────────── */
async function sendKakaoMemo({ title, lines, url, urlLabel }) {
  const key = process.env.KAKAO_REST_API_KEY;
  const refresh = process.env.KAKAO_REFRESH_TOKEN;
  if (!key || !refresh) return { skipped: 'kakao env 미설정' };

  try {
    // 1) 리프레시 토큰으로 액세스 토큰 발급 (6시간 만료라 매번 새로)
    const tr = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: key,
        refresh_token: refresh,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!tr.ok) return { kakao: { ok: false, step: 'token', status: tr.status } };
    const tj = await tr.json();
    const accessToken = tj.access_token;
    if (!accessToken) return { kakao: { ok: false, step: 'token', detail: 'no access_token' } };

    // 2) 기본 템플릿(text)으로 나에게 전송
    const template = {
      object_type: 'text',
      text: [title, '', ...lines].join('\n').slice(0, 190), // 카카오 text 템플릿 200자 제한
      link: { web_url: url || 'https://www.pap-magazine.com', mobile_web_url: url || 'https://www.pap-magazine.com' },
      button_title: (urlLabel || '열기').slice(0, 14),
    };
    const mr = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + accessToken,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { kakao: { ok: mr.ok, status: mr.status } };
  } catch (e) {
    return { kakao: { ok: false, error: String(e && e.message || e).slice(0, 80) } };
  }
}

/* ── 슬랙 / 디스코드 웹훅 (선택) ─────────────────────── */
async function sendWebhooks({ title, lines, url }) {
  const out = {};
  const body = [title, ...lines, url ? url : ''].filter(Boolean).join('\n');
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const r = await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body }), signal: AbortSignal.timeout(TIMEOUT),
      });
      out.slack = { ok: r.ok };
    } catch (e) { out.slack = { ok: false }; }
  }
  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: body.slice(0, 1900) }), signal: AbortSignal.timeout(TIMEOUT),
      });
      out.discord = { ok: r.ok };
    } catch (e) { out.discord = { ok: false }; }
  }
  return out;
}

/**
 * 모든 설정된 채널로 동시 발송.
 * @param {{title:string, lines:string[], url?:string, urlLabel?:string}} msg
 * @returns {Promise<object>} 채널별 결과 (실패해도 throw 하지 않음)
 */
async function pushAlert(msg) {
  const jobs = await Promise.allSettled([
    sendTelegram(msg),
    sendKakaoMemo(msg),
    sendWebhooks(msg),
  ]);
  const merged = {};
  for (const j of jobs) {
    if (j.status === 'fulfilled' && j.value) Object.assign(merged, j.value);
    else if (j.status === 'rejected') merged.error = String(j.reason).slice(0, 80);
  }
  return merged;
}

module.exports = { pushAlert };
