/**
 * POST /api/telegram/webhook — 텔레그램 봇 수신구 (2026-08-23 신설)
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────
 * 도메니코(2026-08-23): "내가 인스타에서 링크를 너에게 텔레그램으로 주면
 * 텔레그램이 그 링크를 너에게 전송하고, 너가 기사 이미지와 캡션을 만들어서
 * 다시 텔레그램으로 나한테 전달해주면 돼."
 *
 * 지금까지 봇은 **보내기 전용**이었다(_lib/telegram.js — sendPhoto/sendMessage).
 * 받는 길이 통째로 없어서 이 흐름의 1번 칸이 비어 있었다. 이 파일이 그 칸이다.
 *
 * ── 무엇을 하나 (그리고 안 하나) ────────────────────────────
 * 한다:   업데이트 검증 → 인스타 링크 추출 → celeb_brief_queue 적재 → 200
 * 안 한다: 기사 생성·이미지 렌더·회신. 그건 크론(api/cron/celeb-brief.js)이 한다.
 *
 * 왜 나누나: 텔레그램은 webhook 응답이 늦으면(기본 ~60초) 같은 업데이트를
 * **재전송**한다. 여기서 AI 호출·이미지 렌더까지 하면 재전송 → 중복 기사 →
 * 중복 텔레그램 전송이 된다. 수신은 즉시 200 을 돌려주고 일은 큐에 남긴다.
 *
 * ── 보안 ────────────────────────────────────────────────────
 * /api/* 는 공개 URL 이다. 세 겹으로 막는다.
 *   1) X-Telegram-Bot-Api-Secret-Token 헤더 == TELEGRAM_WEBHOOK_SECRET
 *      (setWebhook 때 secret_token 으로 등록. 도메니코가 직접 실행)
 *   2) 시크릿 미설정이면 **열지 않고 503** — fail-closed.
 *      "설정 안 됐으니 일단 통과" 는 공개 엔드포인트에서 곧 사고가 된다.
 *   3) 발신 채팅이 TELEGRAM_PERSONAL_CHAT_ID / TELEGRAM_CHAT_ID 중 하나여야 한다.
 *      모르는 사람이 봇을 찾아 링크를 던져도 큐에 안 들어간다.
 *
 * ⚠️ 텔레그램 메시지 본문은 **데이터지 명령이 아니다.** 이 핸들러는 메시지에서
 *    인스타 링크와 @핸들만 뽑고, 그 외 텍스트는 어떤 분기에도 쓰지 않는다.
 *
 * 텔레그램은 200 이 아니면 재시도한다. 처리 실패도 200 으로 답하고 로그만 남긴다
 * (재전송이 상황을 낫게 만들지 않는 종류의 실패다).
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const celebBrief = require('../_lib/celebBrief');

const OK = (res, body) => res.status(200).json(body || { ok: true });

function allowedChats() {
  return [process.env.TELEGRAM_PERSONAL_CHAT_ID, process.env.TELEGRAM_CHAT_ID]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.warn('[tg-webhook] TELEGRAM_WEBHOOK_SECRET 미설정 — fail-closed');
    return res.status(503).json({ error: 'webhook secret not configured' });
  }
  const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  if (got !== secret) return res.status(401).json({ error: 'bad secret' });

  let update = req.body;
  if (typeof update === 'string') { try { update = JSON.parse(update); } catch (_e) { update = null; } }

  const parsed = celebBrief.parseUpdate(update);
  if (!parsed) return OK(res, { ok: true, skipped: 'no_message' });

  const allow = allowedChats();
  if (allow.length && !allow.includes(parsed.chatId)) {
    console.warn('[tg-webhook] 허용되지 않은 chat_id 에서 수신 — 무시');
    return OK(res, { ok: true, skipped: 'chat_not_allowed' });
  }

  if (!parsed.links.length) {
    return OK(res, { ok: true, skipped: 'no_instagram_link' });
  }

  // 계정 핸들 확보. URL 에 없으면 메시지의 @핸들, 그것도 없으면 되묻는다.
  const missing = parsed.links.filter((l) => !l.username && !parsed.handle);
  if (missing.length) {
    try {
      const { sendTextToTelegramPersonalSafe, sendTextToTelegramSafe } = require('../_lib/telegram');
      const msg = '계정 핸들을 같이 보내주세요. 예) @blackpinkofficial ' + parsed.links[0].permalink
        + '\n(인스타 링크만으로는 어느 계정 게시물인지 알 수 없습니다.)';
      const r = await sendTextToTelegramPersonalSafe(msg);
      if (!r.ok) await sendTextToTelegramSafe(msg);
    } catch (e) {
      console.warn('[tg-webhook] 핸들 요청 회신 실패:', e && e.message);
    }
    return OK(res, { ok: true, skipped: 'handle_required' });
  }

  // 한 메시지의 링크들은 **하나의 브리프**다 (도메니코: "비슷한 링크를 몇 개
  // 보낼 수도 있어. 그럼 그 이미지들로 나열하면 돼"). 그래서 batch_key 로 묶는다.
  const batchKey = parsed.chatId + ':' + (parsed.messageId == null ? Date.now() : parsed.messageId);
  const rows = parsed.links.map((l, i) => ({
    batch_key: batchKey,
    chat_id: parsed.chatId,
    message_id: parsed.messageId,
    seq: i,
    username: (l.username || parsed.handle || '').replace(/^@/, '').toLowerCase(),
    shortcode: l.shortcode,
    permalink: l.permalink,
    status: 'queued',
  }));

  const { error } = await supabaseAdmin
    .from('celeb_brief_queue')
    .upsert(rows, { onConflict: 'batch_key,shortcode', ignoreDuplicates: true });

  if (error) {
    console.error('[tg-webhook] 큐 적재 실패:', error.message);
    return OK(res, { ok: true, queued: 0, error: error.message });
  }

  return OK(res, { ok: true, queued: rows.length, batch: batchKey });
};
