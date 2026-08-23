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
 * 한다:   업데이트 검증 → 인스타 링크 추출 → celeb_brief_queue 적재
 *         → 처리 크론을 **즉시 깨우기**(응답은 안 기다림) → 200
 * 안 한다: 기사 생성·이미지 렌더·회신. 그건 크론(api/cron/celeb-brief.js)이 한다.
 *
 * 왜 나누나: 텔레그램은 webhook 응답이 늦으면(기본 ~60초) 같은 업데이트를
 * **재전송**한다. 여기서 AI 호출·이미지 렌더까지 하면 재전송 → 중복 기사 →
 * 중복 텔레그램 전송이 된다. 수신은 즉시 200 을 돌려주고 일은 큐에 남긴다.
 *
 * ── 그런데 왜 즉시 깨우나 (2026-08-23) ──────────────────────
 * 도메니코: "너무 느린데, 링크를 받자마자 빠른 속도로 대답할 순 없어?"
 * 10분 주기만 있으면 최악 10분을 기다린다. 그래서 큐에 넣은 **직후**
 * 크론 URL 을 한 번 친다. 다른 함수 실행이라 이 핸들러가 끝나도 계속 돈다.
 * 응답은 기다리지 않는다(짧은 타임아웃 후 끊고 200 반환) — 여기서 기다리면
 * 텔레그램 재전송 위험이 그대로 돌아온다.
 * 깨우기가 실패해도 **10분 주기 스케줄이 안전망**으로 남아 있다.
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

/* 허용된 채팅만 받는다. 모르는 사람이 봇을 찾아 링크를 던져도 큐에 안 들어간다.
   ⚠️ 2026-08-23: 깨우기 코드를 갈아끼우면서 이 함수를 통째로 지웠고,
      webhook 이 11분 동안 모든 메시지에 500 을 냈다(ReferenceError).
      소스를 문자열로만 검사하는 테스트는 이걸 못 잡는다 —
      tests 에 **핸들러를 실제로 실행하는** 검사를 넣어 재발을 막는다. */
function allowedChats() {
  return [process.env.TELEGRAM_PERSONAL_CHAT_ID, process.env.TELEGRAM_CHAT_ID]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

const TRIGGER_URL = () => (process.env.CELEB_BRIEF_TRIGGER_URL
  || 'https://www.pap-magazine.com/api/cron/celeb-brief') + '?now=1';
/* 폴백 경로에서만 쓰는 상한. 크론 콜드스타트(sharp·supabase 로드)가 넘어가지
   않을 만큼은 줘야 한다 — 2.5초로 뒀다가 실패했다. 아래 사고 기록 참조. */
const WAKE_TIMEOUT_MS = Number(process.env.CELEB_BRIEF_WAKE_TIMEOUT_MS || 9000);

/* 처리 크론을 깨운다.
 *
 * ── 2026-08-23 사고: 2.5초 타임아웃으로 끊었더니 아예 안 깨어났다 ──
 * 처음엔 "요청만 나가면 크론은 독립적으로 돈다" 고 보고 2.5초 뒤 abort 했다.
 * 실측 결과 15:31:48 에 링크가 들어왔는데 크론 런타임 로그에 **호출 흔적이
 * 아예 없었다**(10분 스케줄 호출만 있었다). 크론 함수는 sharp·supabase 를
 * 불러오느라 콜드스타트가 2.5초를 넘는다. 그 전에 끊으면 함수가 시작도 못 한다.
 * abort 는 '이미 출발한 요청을 놓아주는 것' 이 아니라 '요청을 취소하는 것' 이다.
 *
 * ── 지금 방식 ──
 * ① waitUntil 이 있으면(@vercel/functions): 200 을 즉시 돌려주고, 깨우기 요청은
 *    **끊지 않고** 백그라운드에서 끝까지 보낸다. 이게 정석이다.
 * ② 없으면 폴백: 9초 상한으로 기다린다. 콜드스타트를 넘길 만큼은 되고,
 *    텔레그램 재전송 한계(~60초)에는 한참 못 미친다.
 * 어느 쪽이든 실패하면 10분 스케줄이 안전망으로 남는다.
 */
function _waitUntil() {
  try {
    const fns = require('@vercel/functions');          // 지연 로드 (없어도 동작해야 한다)
    return typeof fns.waitUntil === 'function' ? fns.waitUntil : null;
  } catch (_e) {
    return null;
  }
}

/* 링크를 보낸 그 채팅으로 답한다. 실패해도 수신 자체를 막지 않는다. */
async function say(chatId, text) {
  try {
    const { sendTextToChatSafe } = require('../_lib/telegram');
    await sendTextToChatSafe(chatId, text);
  } catch (e) {
    console.warn('[tg-webhook] 회신 실패:', (e && e.message) || e);
  }
}

async function wakeProcessor() {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) { console.warn('[tg-webhook] CRON_SECRET 미설정 — 즉시 깨우기 생략'); return false; }
  const call = (signal) => fetch(TRIGGER_URL(), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + secret },
    signal,
  });

  const waitUntil = _waitUntil();
  if (waitUntil) {
    waitUntil(call(undefined).catch((e) => {
      console.warn('[tg-webhook] 깨우기 실패(스케줄이 받아줌):', (e && e.message) || e);
    }));
    return true;
  }

  try {
    await call(AbortSignal.timeout(WAKE_TIMEOUT_MS));
    return true;
  } catch (e) {
    const name = e && e.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      console.warn('[tg-webhook] 깨우기 응답 대기 초과 — 크론이 이미 돌고 있을 수 있다');
      return true;
    }
    console.warn('[tg-webhook] 깨우기 실패(스케줄이 받아줌):', (e && e.message) || e);
    return false;
  }
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

  /* ── 게시 명령 ("올려") ──────────────────────────────────────
     도메니코가 브리프를 보고 판단해서 내리는 명령이다. 여기서는 **표시만** 하고
     실제 게시는 크론이 한다 — 게시는 컨테이너 생성 + 릴스 인코딩 폴링까지
     길게는 3분이 걸려서 webhook 안에서 하면 텔레그램이 재전송한다.
     대상은 이 채팅의 **가장 최근에 완성된 브리프 하나**뿐이다. */
  if (parsed.publishCommand) {
    /* 2026-08-23 — 자동 감시로 브리프가 동시에 여러 건 도착할 수 있다.
       "올려"가 '가장 최근 것'을 집으면 도메니코가 보던 것과 다른 게 올라간다.
       규칙: 번호 지정("올려 12")이 최우선 · 번호 없으면 후보가 정확히 1건일 때만
       진행 · 여러 건이면 목록을 되물어본다. */
    const wantNum = parsed.publishCommand.num;
    const toWeb = !!parsed.publishCommand.web;
    /* IG 게시는 웹에만 낸 것도 나중에 올릴 수 있다. 웹 게시는 이미 웹에 낸 것을
       또 내지 않는다. 인스타에 이미 올라간 것(published)은 sync-instagram 이
       웹 기사를 만들므로 웹 게시 대상이 아니다. */
    const CAND = toWeb
      ? ['done', 'publish_failed', 'web_publish_failed']
      : ['done', 'publish_failed', 'web_published', 'web_publish_failed'];
    let row = null;
    if (wantNum != null) {
      const { data, error: findErr } = await supabaseAdmin
        .from('celeb_brief_queue')
        .select('id, batch_key, result, status')
        .eq('chat_id', parsed.chatId).eq('id', wantNum)
        .in('status', CAND).limit(1);
      row = data && data[0];
      if (findErr || !row) {
        await say(parsed.chatId, findErr
          ? ('브리프 조회 실패: ' + String(findErr.message).slice(0, 150))
          : ('#' + wantNum + ' 브리프를 찾을 수 없습니다. 이미 게시됐거나 번호가 다릅니다.'));
        return OK(res, { ok: true, skipped: 'brief_not_found' });
      }
    } else {
      const { data, error: findErr } = await supabaseAdmin
        .from('celeb_brief_queue')
        .select('id, batch_key, result, status, processed_at')
        /* publish_failed 도 대상 — 실패한 건이 재시도로 다시 잡혀야 한다 */
        .eq('chat_id', parsed.chatId).in('status', CAND)
        .order('processed_at', { ascending: false }).limit(5);
      const cands = data || [];
      if (findErr || !cands.length) {
        await say(parsed.chatId, findErr
          ? ('브리프 조회 실패: ' + String(findErr.message).slice(0, 150))
          : '올릴 브리프가 없습니다. 먼저 인스타 링크를 보내주세요.');
        return OK(res, { ok: true, skipped: 'no_brief_to_publish' });
      }
      if (cands.length > 1) {
        const list = cands.map((c) => '#' + c.id + ' — '
          + ((c.result && (c.result.title || c.result.title_en)) || '(제목 없음)')
          + (c.status === 'publish_failed' ? ' (이전 게시 실패)' : '')).join('\n');
        await say(parsed.chatId, '대기 중인 브리프가 ' + cands.length + '건입니다. 번호로 지정해주세요:\n'
          + list + '\n\n예) 올려 ' + cands[0].id);
        return OK(res, { ok: true, skipped: 'ambiguous_publish', candidates: cands.length });
      }
      row = cands[0];
    }
    const { error: markErr } = await supabaseAdmin.from('celeb_brief_queue')
      .update({ status: toWeb ? 'web_queued' : 'publish_queued', error: null })
      .eq('id', row.id).in('status', CAND);
    if (markErr) {
      await say(parsed.chatId, '게시 접수 실패: ' + String(markErr.message).slice(0, 150));
      return OK(res, { ok: true, skipped: 'publish_mark_failed' });
    }
    const title = (row.result && (row.result.title || row.result.title_en)) || '';
    await say(parsed.chatId, (toWeb ? '웹 게시 접수: ' : '게시 접수: ') + (title || '(제목 없음)')
      + (toWeb ? '\n웹사이트에만 올립니다 (인스타 게시 없음)…' : '\n올리는 중입니다…'));
    await wakeProcessor();
    return OK(res, { ok: true, [toWeb ? 'web_queued' : 'publish_queued']: row.id });
  }

  if (!parsed.links.length) {
    return OK(res, { ok: true, skipped: 'no_instagram_link' });
  }

  // 계정 핸들 확보. URL 에 없으면 메시지의 @핸들, 그것도 없으면 되묻는다.
  const missing = parsed.links.filter((l) => !l.username && !parsed.handle);
  if (missing.length) {
    await say(parsed.chatId, '계정 핸들을 같이 보내주세요. 예) @blackpinkofficial ' + parsed.links[0].permalink
      + '\n(인스타 링크만으로는 어느 계정 게시물인지 알 수 없습니다.)');
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

  // 처리 크론을 즉시 깨운다. 실패해도 스케줄(10분)이 받아준다.
  await wakeProcessor();

  return OK(res, { ok: true, queued: rows.length, batch: batchKey });
};
