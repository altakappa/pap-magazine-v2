/**
 * PAP Magazine — 셀럽 속보 브리프 처리 (2026-08-23 신설)
 * Route: /api/cron/celeb-brief        (10분 주기 · ?now=1 즉시처리 · ?dry=1 전송없이 점검)
 *
 * ── 흐름 (도메니코 2026-08-23 확정) ──────────────────────────
 *   ① 도메니코가 인스타 링크를 텔레그램으로 보낸다 (비슷한 링크 여러 개 가능)
 *   ② api/telegram/webhook.js 가 celeb_brief_queue 에 적재
 *   ③ **이 크론**: business_discovery 로 이미지·캡션 수집 → 기사 생성
 *      → 1번 이미지에만 썸네일 디자인 → 텔레그램으로 회신
 *   ④ 도메니코가 확인하고 **직접** 인스타에 게시
 *
 * ── 도메니코 규칙 두 개를 코드로 못박는다 ────────────────────
 *   "썸네일은 디자인으로 구성, 나머지는 아무 디자인도 입히지 않은 이미지"
 *      → 1장만 renderThumb, 2장부터는 원본 바이트 그대로 보낸다.
 *      영상은 **영상 그대로** 보낸다. 디자인은 커버 프레임(thumbnail_url)에만 얹는다
 *      (2026-08-23 도메니코 "영상은 불가능해?" — 첫 실전이 릴스였다).
 *   "댓글과 대댓글 해시태그" → 캡션은 해시태그 없이 깨끗하게 두고,
 *      **댓글 = 독자 질문 한 줄 · 대댓글 = 해시태그 블록** 을 따로 보낸다
 *      (볼트 50_Brand/톤앤매너 · PAP-브랜드-가이드 · 40_Community/댓글-작전).
 *   "비슷한 링크를 몇 개 보낼 수도 있어. 그럼 그 이미지들로 나열하면 돼"
 *      → 같은 batch_key 를 한 브리프로 묶어 보낸 순서대로 이어붙인다.
 *
 * ── 이 크론은 아무것도 발행하지 않는다 ───────────────────────
 * DB 에 기사를 넣지 않고(=발행 판단은 도메니코), 인스타에도 올리지 않는다.
 * 하는 일은 "만들어서 텔레그램으로 건네주기" 까지다.
 *
 * ── 실패를 조용히 넘기지 않는다 ──────────────────────────────
 * 큐 행마다 status(queued→working→done/failed)와 error 를 남기고,
 * 사람이 기다리고 있으므로 **실패도 텔레그램으로 알린다**. 링크를 던졌는데
 * 아무 답이 없는 게 가장 나쁜 실패다.
 */

'use strict';

const { withCronGuard } = require('../_lib/cronGuard');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const celebBrief = require('../_lib/celebBrief');
const igDiscovery = require('../_lib/igDiscovery');

/* 링크를 여러 메시지로 나눠 보내는 경우가 있다(도메니코: "비슷한 링크를 몇 개
   보낼 수도 있어"). 메시지마다 batch_key 가 달라지므로, **같은 채팅에서
   이 창 안에 들어온 링크는 한 브리프로 합친다.** 안 합치면 링크 3개가
   기사 3개로 쪼개져서 텔레그램에 따로 날아간다. */
const BATCH_WINDOW_MS = Number(process.env.CELEB_BRIEF_WINDOW_MS || 5 * 60 * 1000);
const BATCH_WAIT_MS = Number(process.env.CELEB_BRIEF_WAIT_MS || 45000);  // 마지막 링크를 기다리는 여유
const STALE_WORKING_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/* 텔레그램 봇 업로드 상한은 50MB. 여유를 두고 자른다.
   넘는 영상은 **조용히 빼지 않고** 캡션 끝에 몇 건을 뺐는지 적는다. */
const VIDEO_MAX_BYTES = Number(process.env.CELEB_BRIEF_VIDEO_MAX || 45 * 1024 * 1024);

/** 조기 반환마다 cron_runs 에 메모를 남긴다 — 없으면 '무음 실패' 가 된다. */
function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

async function fetchBuffer(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 15000) });
  if (!r.ok) throw new Error('이미지 다운로드 실패 HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function tell(text) {
  try {
    const { sendTextToTelegramPersonalSafe, sendTextToTelegramSafe } = require('../_lib/telegram');
    const r = await sendTextToTelegramPersonalSafe(text);
    if (!r.ok) await sendTextToTelegramSafe(text);
  } catch (e) {
    console.warn('[celeb-brief] 알림 실패:', e && e.message);
  }
}

module.exports = withCronGuard('celeb-brief', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = !!(req.query && req.query.dry);
  /* ?now=1 — webhook 이 링크를 받자마자 깨울 때. 합치기 대기를 건너뛴다.
     도메니코 2026-08-23: "링크를 받자마자 빠른 속도로 대답할 순 없어?"
     10분 주기 스케줄은 그대로 두어 **안전망**으로 남긴다 — 즉시 깨우기가
     실패해도(네트워크·콜드스타트) 늦어도 10분 안에는 반드시 처리된다. */
  const nowMode = !!(req.query && req.query.now);

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(200).json({ ok: true, note: note(res, 'IG_ACCESS_TOKEN/IG_USER_ID 미설정 — 건너뜀') });
  }

  // ── 0. 멈춰 있는 working 행 되살리기 (함수 타임아웃·재배포로 끊긴 경우) ──
  await supabaseAdmin.from('celeb_brief_queue')
    .update({ status: 'queued' })
    .eq('status', 'working')
    .lt('created_at', new Date(Date.now() - STALE_WORKING_MS).toISOString());

  // ── 1. 가장 오래된 batch 하나 (한 회차 1건 — 텔레그램 도배 방지) ──
  const { data: queued, error: qErr } = await supabaseAdmin.from('celeb_brief_queue')
    .select('*').eq('status', 'queued')
    .order('created_at', { ascending: true }).limit(50);
  if (qErr) {
    note(res, '큐 조회 실패: ' + String(qErr.message).slice(0, 150));
    return res.status(500).json({ ok: false, error: 'queue query failed' });
  }
  if (!queued || !queued.length) {
    return res.status(200).json({ ok: true, note: note(res, '대기 중인 브리프 없음') });
  }

  const head0 = queued[0];
  const windowEnd = new Date(head0.created_at).getTime() + BATCH_WINDOW_MS;
  const rows = queued
    .filter((r) => r.chat_id === head0.chat_id && new Date(r.created_at).getTime() <= windowEnd)
    .sort((a, b) => (new Date(a.created_at) - new Date(b.created_at)) || (a.seq - b.seq));

  /* 링크를 두세 번에 나눠 보내는 경우가 있다. 방금 들어온 batch 는 조금 기다렸다
     다음 회차에 처리한다 — 첫 링크만으로 브리프를 보내면 나머지가 버려진다. */
  const newest = Math.max(...rows.map((r) => new Date(r.created_at).getTime()));
  const age = Date.now() - newest;
  if (!nowMode && age < BATCH_WAIT_MS) {
    return res.status(200).json({ ok: true, note: note(res, '방금 들어온 브리프 — 다음 회차에 처리 (' + Math.round(age / 1000) + '초)') });
  }

  if (rows.some((r) => r.attempts >= MAX_ATTEMPTS)) {
    const ids = rows.map((r) => r.id);
    await supabaseAdmin.from('celeb_brief_queue')
      .update({ status: 'failed', processed_at: new Date().toISOString() }).in('id', ids);
    await tell('셀럽 속보 브리프 포기 (' + MAX_ATTEMPTS + '회 실패): ' + rows[0].permalink);
    return res.status(200).json({ ok: true, note: note(res, '재시도 상한 도달 — failed 처리') });
  }

  /* 자리를 **원자적으로** 찜한다. webhook 즉시 깨우기와 스케줄 크론이 겹쳐 돌 수 있어
     select→update 로 나누면 둘 다 같은 행을 집어 브리프가 두 번 전송된다.
     UPDATE ... WHERE status='queued' 는 한 쪽만 성공한다. 반환이 비면 남이 가져간 것. */
  const wantIds = rows.map((r) => r.id);
  const { data: claimed, error: claimErr } = await supabaseAdmin.from('celeb_brief_queue')
    .update({ status: 'working', attempts: (rows[0].attempts || 0) + 1 })
    .eq('status', 'queued').in('id', wantIds).select('id');
  if (claimErr) {
    note(res, '클레임 실패: ' + String(claimErr.message).slice(0, 150));
    return res.status(500).json({ ok: false, error: 'claim failed' });
  }
  if (!claimed || !claimed.length) {
    return res.status(200).json({ ok: true, note: note(res, '다른 실행이 이미 가져감 — 건너뜀') });
  }
  const ids = claimed.map((r) => r.id);

  const fail = async (msg) => {
    await supabaseAdmin.from('celeb_brief_queue')
      .update({ status: 'queued', error: String(msg).slice(0, 400) }).in('id', ids);
    await tell('셀럽 속보 브리프 실패 — ' + msg + '\n' + rows[0].permalink);
    return res.status(200).json({
      ok: false, error: String(msg).slice(0, 300),
      note: note(res, '브리프 실패: ' + String(msg).slice(0, 150)),
    });
  };

  try {
    // ── 2. 게시물 수집 ────────────────────────────────────────
    const posts = [];
    for (const r of rows) {
      const m = await igDiscovery.findPostByShortcode(r.username, r.shortcode, { maxCount: 25 });
      if (!m) {
        return await fail('@' + r.username + ' 최근 게시물에서 ' + r.shortcode + ' 를 못 찾았습니다.'
          + ' (business_discovery 는 최근 게시물만 봅니다. 비공개·개인 계정이거나 오래된 게시물일 수 있습니다.)');
      }
      posts.push(m);
    }

    const perPost = posts.map((m) => celebBrief.collectMediaItems(m));
    const items = celebBrief.mergeMediaItems(perPost);
    const coverUrl = celebBrief.pickCoverUrl(items);
    if (!items.length || !coverUrl) {
      return await fail('이 게시물에서 쓸 수 있는 사진·영상을 못 찾았습니다.'
        + ' (비공개이거나 미디어가 없는 게시물일 수 있습니다.)');
    }
    const mediaUrls = items.map((i) => i.thumb || i.url);   // 기사 생성용 비전 입력

    // ── 3. 기사 생성 (PAP 말투는 papVoice 가 담당) ────────────
    const { generateArticleFromPost } = require('../_lib/instagramImport');
    const head = posts[0];
    const gen = await generateArticleFromPost({
      id: rows[0].shortcode,
      caption: posts.map((p) => String(p.caption || '')).filter(Boolean).join('\n\n'),
      mediaUrls,
      permalink: head.permalink || rows[0].permalink,
      timestamp: head.timestamp,
      username: rows[0].username,
    });

    /* 멘션 줄: 소스 계정을 맨 앞에, 그다음 원 게시물 캡션에 찍힌 @핸들.
       실측 96% 가 2번째 줄에 멘션을 단다(브랜드·작업자 태그). */
    const mentions = [rows[0].username]
      .concat(celebBrief.extractMentions(posts.map((p) => p.caption || '').join(' '), 4));
    /* 영문은 실측 92/92 = 100% 다. 비어 있으면 캡션이 반쪽이 되므로
       조용히 넘기지 않고 사람에게 알린다(브리프 자체는 계속 보낸다 —
       국문이라도 있는 게 아무것도 없는 것보다 낫다). */
    const missingEn = !String(gen.body_en || '').trim();
    /* 본문 마지막의 독자 호명 질문을 떼어 **첫 댓글**로 옮긴다.
       캡션과 댓글에 같은 문장이 두 번 나오지 않게 하려는 것이고,
       질문을 새로 지어내지 않으므로 톤도 갈리지 않는다. */
    const koSplit = celebBrief.splitClosingQuestion(gen.body_ko);
    /* 캡션은 절반으로 줄인다 (2026-08-23 도메니코: "너무 캡션이 길다.
       기사내용은 절반으로 줄여달라"). 웹 본문은 그대로 두고 캡션만 줄인다 —
       단락 단위로 앞에서부터 남기고, 영문은 국문과 같은 단락 수로 맞춘다. */
    const koShort = celebBrief.halveBody(koSplit.body);
    const enShort = celebBrief.takeParagraphs(gen.body_en, koShort.paras);
    const caption = celebBrief.buildBriefCaption({
      hook: gen.title_ko || gen.title,          // 프롬프트가 '후킹 한 줄 10~26자'로 만든다
      bodyKo: koShort.text,
      bodyEn: enShort,
      mentions,
      creditKind: items[0].type === 'video' ? 'video' : 'photo',
    });
    const comments = celebBrief.buildComments({
      question: koSplit.question,
      seed: rows[0].shortcode,                  // 같은 게시물은 항상 같은 세트, 게시물마다 회전
    });

    // ── 4. 미디어 준비 — 커버 1장만 디자인, 나머지는 원본 그대로 ──
    const media = [];
    const cover = await fetchBuffer(coverUrl, 20000);
    const { renderThumb } = require('../_lib/celebThumb');
    /* 판형은 게시물이 정한다 — 영상이면 릴스(9:16), 사진이면 피드(4:5).
       릴스를 4:5 로 뽑으면 인스타에 릴스로 올릴 때 위아래가 잘린다. */
    const variant = items[0].type === 'video' ? 'reels' : 'feed';
    const coverDesigned = await renderThumb(cover, gen.title_ko || gen.title, gen.title_en || '', { variant });
    media.push({ kind: 'photo', buffer: coverDesigned });

    /* 영상 미리보기 커버로 쓸 축소본. 텔레그램 thumbnail 은 JPEG · 320px 이하
       · 200KB 이하가 권장 규격이라 그대로 넘기면 무시된다. */
    let videoThumb = null;
    try {
      const sharpLib = require('sharp');
      videoThumb = await sharpLib(coverDesigned).resize({ width: 320 }).jpeg({ quality: 80 }).toBuffer();
    } catch (e) {
      console.warn('[celeb-brief] 영상 커버 축소 실패(커버 없이 진행):', (e && e.message) || e);
    }

    /* 첫 슬라이드가 사진이면 그 원본은 커버로 이미 쓴 셈이라 다시 넣지 않는다.
       영상이면 커버는 프레임일 뿐이므로 **영상 본체를 이어서 넣는다.** */
    const rest = items[0].type === 'image' ? items.slice(1) : items;
    let tooBig = 0;
    const videoSizes = [];      // 크롭이 정말 필요한지 숫자로 보기 위해 기록한다
    for (const it of rest) {
      try {
        const buf = await fetchBuffer(it.url, it.type === 'video' ? 60000 : 20000);
        if (it.type === 'video' && buf.length > VIDEO_MAX_BYTES) { tooBig++; continue; }
        if (it.type === 'video') {
          /* 도메니코가 9:16 크롭을 요청했는데 크롭은 재인코딩이고 Vercel 에는
             ffmpeg 가 없다(_lib/mp4Mute.js 머리말). 그래서 **원본이 이미 9:16 인지**
             부터 잰다 — 그렇다면 할 일이 없다. 순수 JS 로 tkhd 만 읽는다. */
          try {
            const { mp4Dimensions } = require('../_lib/mp4Mute');
            const dim = mp4Dimensions(buf);
            if (dim) videoSizes.push(dim);
          } catch (e) {
            console.warn('[celeb-brief] 영상 해상도 읽기 실패:', (e && e.message) || e);
          }
        }
        media.push(it.type === 'video'
          ? { kind: 'video', buffer: buf, thumb: videoThumb }
          : { kind: 'photo', buffer: buf });
      } catch (e) {
        console.warn('[celeb-brief] 미디어 건너뜀:', (e && e.message) || e);
      }
    }
    /* 9:16 = 0.5625. 오차 2% 밖이면 세로 판형이 아니라는 뜻이다. */
    const offRatio = videoSizes.filter((d) => Math.abs(d.ratio - 0.5625) > 0.0113);
    const sizeNote = videoSizes.length
      ? (' · 영상 ' + videoSizes.map((d) => d.width + 'x' + d.height).join(', ')
         + (offRatio.length ? ' ⚠️9:16 아님' : ' (9:16)'))
      : '';
    const buffers = media;   // 아래 dry 응답 호환

    if (dry) {
      await supabaseAdmin.from('celeb_brief_queue').update({ status: 'queued' }).in('id', ids);
      return res.status(200).json({
        ok: true, dry: true, slides: buffers.length, title: gen.title_ko,
        note: note(res, 'dry — ' + buffers.length + '장 준비까지 확인 (전송 안 함)'),
      });
    }

    // ── 5. 텔레그램 회신 ──────────────────────────────────────
    const tg = require('../_lib/telegram');
    if (!tg.isConfigured()) return await fail('TELEGRAM_BOT_TOKEN/CHAT_ID 미설정');
    const capWithNote = caption + (tooBig ? ('\n\n※ 용량이 커서 영상 ' + tooBig + '건은 뺐습니다(45MB 초과).') : '');
    const split = celebBrief.splitCaptionForTelegram(capWithNote);
    await tg.sendMediaToTelegram(media, split.caption, rows[0].chat_id);
    if (split.overflow) await tg.sendTextToChatSafe(rows[0].chat_id, split.overflow);
    /* 댓글·대댓글은 **각각 따로** 보낸다 — 한 덩어리로 보내면 인스타에 붙일 때
       필요한 부분만 골라 복사하기 번거롭다. */
    if (comments.comment) await tg.sendTextToChatSafe(rows[0].chat_id, '💬 댓글\n' + comments.comment);
    if (comments.reply) await tg.sendTextToChatSafe(rows[0].chat_id, '↳ 대댓글\n' + comments.reply);

    await supabaseAdmin.from('celeb_brief_queue').update({
      status: 'done', processed_at: new Date().toISOString(), error: null,
      result: {
        slides: media.length, title: gen.title_ko, title_en: gen.title_en, variant,
        videos: media.filter((m) => m.kind === 'video').length,
        video_skipped_too_big: tooBig, missing_en: missingEn, video_sizes: videoSizes,
        has_comment: !!comments.comment,
      },
    }).in('id', ids);

    return res.status(200).json({
      ok: true, slides: media.length, title: gen.title_ko, variant,
      note: note(res, '브리프 1건 전송(' + variant + ')'
        + (missingEn ? ' ⚠️영문 누락' : '')
        + (comments.comment ? '' : ' ⚠️댓글 질문 없음')
        + (tooBig ? (' ⚠️영상 ' + tooBig + '건 용량초과 제외') : '')
        + ': ' + String(gen.title_ko || '').slice(0, 60) + ' (' + media.length + '장)' + sizeNote),
    });
  } catch (e) {
    return await fail(String((e && e.message) || e).slice(0, 300));
  }
});
