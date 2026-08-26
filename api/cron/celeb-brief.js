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
const SITE = 'https://www.pap-magazine.com';
const igDiscovery = require('../_lib/igDiscovery');
const videoOverlay = require('../_lib/videoOverlay');   // ffmpeg 는 이 안에서 지연 로드

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


/* ── 게시 ──────────────────────────────────────────────────────
 * 도메니코가 "올려" 라고 친 브리프 하나를 @pap_magazine 에 게시한다.
 *
 * 순서: 자리 찜(원자적) → 커버 재렌더 → Storage 업로드 → 컨테이너 → 게시
 *       → 댓글(질문) → 대댓글(해시태그) → 링크 회신
 *
 * 실패는 전부 사람에게 알린다. 특히 **게시는 됐는데 댓글이 실패한 경우**를
 * 성공으로 뭉뚱그리지 않는다 — 해시태그가 안 붙은 걸 모르면 그대로 방치된다.
 */
/* Graph 오류를 "그래서 뭘 해야 하나" 로 번역한다.
   2026-08-23: 첫 게시가 (#10) instagram_content_publish 로 죽었는데
   텔레그램에는 Graph 원문만 떠서 도메니코가 할 일을 알 수 없었다. */
function publishHint(msg) {
  const m = String(msg || '');
  if (/instagram_content_publish|\(#10\)|code 10/i.test(m)) {
    return '\n\n👉 토큰에 게시 권한이 없습니다. Graph API Explorer 에서'
      + ' instagram_content_publish 를 포함해 토큰을 다시 받고'
      + ' Vercel 의 IG_ACCESS_TOKEN 을 교체한 뒤 Redeploy 해주세요.'
      + '\n(교체 시 하위 5계정 토큰도 같이 확인)';
  }
  if (/expired|malformed|OAuth|190/i.test(m)) {
    return '\n\n👉 토큰이 만료됐거나 잘못됐습니다. 재발급이 필요합니다.';
  }
  if (/too big|너무 큽니다/i.test(m)) {
    return '\n\n👉 영상 용량 문제입니다. 원본이 짧은 게시물로 다시 시도해주세요.';
  }
  return '';
}

/* ── 웹 전용 게시 ("웹만" — 2026-08-23) ─────────────────────────────
   인스타에는 올리지 않고 웹사이트 기사만 낸다. sync-instagram 과 같은 재료
   (buildArticleRow·archiveImagesToStorage)를 재사용한다 — 기사 모양이 두 벌로
   갈라지지 않게. status='published' 는 도메니코의 "웹만" 명령이 곧 발행 판단이다. */
async function runWebPublish(row, res, dry) {
  const imp = require('../_lib/instagramImport');

  const webFail = async (msg) => {
    await supabaseAdmin.from('celeb_brief_queue')
      .update({ status: 'web_publish_failed', error: String(msg).slice(0, 400) }).eq('id', row.id);
    await tell('웹 게시 실패 — ' + msg);
    return res.status(200).json({ ok: false, error: String(msg).slice(0, 300),
      note: note(res, '웹 게시 실패: ' + String(msg).slice(0, 150)) });
  };

  // 자리 찜 (게시와 같은 원자적 클레임)
  const { data: claimed } = await supabaseAdmin.from('celeb_brief_queue')
    .update({ status: 'web_publishing' }).eq('id', row.id).eq('status', 'web_queued').select('id');
  if (!claimed || !claimed.length) {
    return res.status(200).json({ ok: true, note: note(res, '다른 실행이 이미 웹 게시 중 — 건너뜀') });
  }

  try {
    // 이미 같은 소스로 기사가 있으면 링크만 알려준다 (중복 기사 방지)
    const { data: ex } = await supabaseAdmin.from('articles')
      .select('id, slug, custom_url').eq('source_instagram_post_id', row.shortcode).limit(1);
    if (ex && ex.length) {
      const url = SITE + '/article/' + (ex[0].slug || ex[0].custom_url || ex[0].id);
      await supabaseAdmin.from('celeb_brief_queue')
        .update({ status: 'web_published', error: null }).eq('id', row.id);
      await tell('이미 웹에 있는 기사입니다 —\n' + url);
      return res.status(200).json({ ok: true, existing: true, url,
        note: note(res, '이미 웹에 있는 기사 — 링크만 회신') });
    }

    // 미디어는 CDN 만료 때문에 지금 다시 가져온다 (브리프 시점 URL 은 죽었을 수 있다)
    const m = await igDiscovery.findPostByShortcode(row.username, row.shortcode, { maxCount: 25 });
    if (!m) return await webFail('@' + row.username + ' 최근 게시물에서 ' + row.shortcode + ' 를 못 찾았습니다.');
    const items = celebBrief.collectMediaItems(m);
    const imageUrls = items.filter((i) => i.type === 'image').map((i) => i.url);
    const videoUrls = items.filter((i) => i.type === 'video').map((i) => i.url);
    if (!imageUrls.length && items.length) imageUrls.push(items[0].thumb || items[0].url);

    // 본문: 브리프에서 검토된 것 우선, 없으면(구버전 브리프) 재생성
    let gen = row.result && row.result.gen;
    if (!gen || !gen.body_ko) {
      gen = await imp.generateArticleFromPost({
        id: row.shortcode,
        caption: String(m.caption || ''),
        mediaUrls: items.map((i) => i.thumb || i.url),
        permalink: m.permalink || row.permalink,
        timestamp: m.timestamp,
        username: row.username,
      });
    }

    const post = {
      id: row.shortcode,
      permalink: m.permalink || row.permalink,
      timestamp: m.timestamp || (row.result && row.result.web && row.result.web.timestamp) || null,
      mediaUrls: imageUrls,
      videoUrls,
      mediaType: items[0] && items[0].type === 'video' ? 'VIDEO' : 'IMAGE',
      caption: String(m.caption || ''),
    };

    // IG CDN 은 수일 내 만료 — 영구본으로 복사 (sync-instagram 과 동일 경로)
    const archivedUrls = await imp.archiveImagesToStorage(post, 10, 'celeb-web');
    let archivedVideos = [];
    if (videoUrls.length) {
      try { archivedVideos = await imp.archiveVideosToStorage(post, 2, 'celeb-web'); }
      catch (e) { console.warn('[celeb-web] 영상 보관 실패(기사에는 이미지로 진행):', (e && e.message) || e); }
    }

    const art = imp.buildArticleRow(post, gen, { status: 'published', archivedUrls, videoUrls: archivedVideos });
    const { data: inserted, error: insErr } = await supabaseAdmin.from('articles')
      .insert(art).select('id, slug, custom_url').single();
    if (insErr) {
      if (insErr.code === '23505') return await webFail('같은 기사가 방금 다른 실행에서 만들어졌습니다.');
      throw insErr;
    }

    const url = SITE + '/article/' + (inserted.slug || inserted.custom_url || inserted.id);
    await supabaseAdmin.from('celeb_brief_queue').update({
      status: 'web_published', error: null,
      result: Object.assign({}, row.result || {}, { webArticle: { id: inserted.id, url } }),
    }).eq('id', row.id);

    await tell('🌐 웹 게시 완료 — ' + (gen.title_ko || gen.title_en || '') + '\n' + url
      + '\n(인스타에는 올라가지 않았습니다. 인스타도 올리려면 "올려 ' + row.id + '")');
    return res.status(200).json({ ok: true, article_id: inserted.id, url,
      note: note(res, '웹 게시 완료: ' + String(gen.title_ko || '').slice(0, 60)) });
  } catch (e) {
    return await webFail(String((e && e.message) || e).slice(0, 300));
  }
}

async function runPublish(row, res, dry) {
  const igPublish = require('../_lib/igPublish');
  const pub = (row.result && row.result.publish) || null;

  const pubFail = async (msg) => {
    await supabaseAdmin.from('celeb_brief_queue')
      .update({ status: 'publish_failed', error: String(msg).slice(0, 400) }).eq('id', row.id);
    await tell('인스타 게시 실패 — ' + msg + publishHint(msg));
    return res.status(200).json({
      ok: false, error: String(msg).slice(0, 300),
      note: note(res, '게시 실패: ' + String(msg).slice(0, 150)),
    });
  };

  if (!pub) return await pubFail('게시 재료가 없습니다. 브리프를 다시 만들어 주세요(이전 버전으로 만들어진 건일 수 있습니다).');
  if (!igPublish.isConfigured()) return await pubFail('IG_USER_ID / IG_ACCESS_TOKEN 미설정');

  // 자리를 원자적으로 찜한다 — 즉시 깨우기와 스케줄이 겹쳐도 두 번 올리지 않는다.
  const { data: claimed, error: cErr } = await supabaseAdmin.from('celeb_brief_queue')
    .update({ status: 'publishing' }).eq('id', row.id).eq('status', 'publish_queued').select('id');
  if (cErr) {
    note(res, '게시 클레임 실패: ' + String(cErr.message).slice(0, 150));
    return res.status(500).json({ ok: false, error: 'publish claim failed' });
  }
  if (!claimed || !claimed.length) {
    return res.status(200).json({ ok: true, note: note(res, '다른 실행이 이미 게시 중 — 건너뜀') });
  }

  try {
    const { renderThumb } = require('../_lib/celebThumb');
    const cover = await renderThumb(
      await fetchBuffer(pub.coverUrl, 20000), pub.titleKo, pub.titleEn,
      { variant: pub.variant, focusTop: pub.focusTop },
    );
    const base = 'celeb-publish/' + row.shortcode + '-' + row.id;
    const coverUrl = await igPublish.uploadPublic(cover, base + '/cover.jpg', 'image/jpeg');

    if (dry) {
      await supabaseAdmin.from('celeb_brief_queue').update({ status: 'publish_queued' }).eq('id', row.id);
      return res.status(200).json({
        ok: true, dry: true, cover: coverUrl,
        note: note(res, 'dry — 커버 업로드까지 확인 (게시 안 함)'),
      });
    }

    let mediaId;
    if (pub.variant === 'reels') {
      const vid = (pub.items || []).find((i) => i.type === 'video');
      if (!vid) return await pubFail('릴스인데 영상을 못 찾았습니다.');
      /* 브리프 때 구워서 보관해 둔 영상이 있으면 그대로 쓴다.
         여기서 다시 구우면 릴스 컨테이너 폴링(최대 180초)과 합쳐 함수 상한을 넘긴다. */
      let videoUrl = pub.burnedVideoUrl || null;
      if (!videoUrl) {
        const buf = await fetchBuffer(vid.url, 60000);
        if (buf.length > VIDEO_MAX_BYTES) return await pubFail('영상이 너무 큽니다(' + Math.round(buf.length / 1048576) + 'MB).');
        videoUrl = await igPublish.uploadPublic(buf, base + '/clip.mp4', 'video/mp4');
      }
      mediaId = await igPublish.publishReel(videoUrl, pub.caption, coverUrl);
    } else {
      /* 캐러셀: 1번은 디자인 커버, 그다음 원본 사진.
         첫 장이 사진이면 그 원본은 커버로 이미 쓴 것이라 다시 넣지 않는다. */
      const items = pub.items || [];
      const restPhotos = (items[0] && items[0].type === 'image' ? items.slice(1) : items)
        .filter((i) => i.type === 'image');
      const urls = [coverUrl];
      /* 인스타 캐러셀 상한 20장 (2026-08-26, celebBrief.MAX_SLIDES 와 같이 올린다). */
      for (let i = 0; i < restPhotos.length && urls.length < celebBrief.MAX_SLIDES; i++) {
        try {
          const b = await fetchBuffer(restPhotos[i].url, 20000);
          /* 브리프에서 본 것과 **같은 그림**이 올라가야 한다. 여기서 자르지 않으면
             텔레그램에서 확인한 비율과 실제 게시물이 갈린다. */
          const cropped = await require('../_lib/slideCrop').cropSlideToVariant(b, pub.variant);
          urls.push(await igPublish.uploadPublic(cropped.buffer, base + '/' + (i + 1) + '.jpg', 'image/jpeg'));
        } catch (e) {
          console.warn('[celeb-brief] 게시용 이미지 건너뜀:', (e && e.message) || e);
        }
      }
      mediaId = await igPublish.publishPhotos(urls, pub.caption);
    }

    // ── 댓글 · 대댓글 ─────────────────────────────────────────
    let commentWarn = '';
    try {
      const cid = await igPublish.addComment(mediaId, pub.comment);
      if (cid && pub.reply) await igPublish.replyToComment(cid, pub.reply);
      else if (!cid && pub.reply) commentWarn = ' ⚠️댓글이 없어 해시태그를 못 달았습니다';
    } catch (e) {
      commentWarn = ' ⚠️댓글/해시태그 실패: ' + String((e && e.message) || e).slice(0, 150);
    }

    const permalink = await igPublish.permalinkOf(mediaId);
    await supabaseAdmin.from('celeb_brief_queue').update({
      status: 'published', published_media_id: mediaId,
      published_permalink: permalink || null, published_at: new Date().toISOString(), error: null,
    }).eq('id', row.id);

    await tell('인스타 게시 완료 — ' + (pub.titleKo || '') + (permalink ? ('\n' + permalink) : '') + commentWarn);
    return res.status(200).json({
      ok: true, media_id: mediaId, permalink,
      note: note(res, '게시 완료(' + pub.variant + '): ' + String(pub.titleKo || '').slice(0, 60) + commentWarn),
    });
  } catch (e) {
    return await pubFail(String((e && e.message) || e).slice(0, 300));
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

  /* ── 0.5 게시 명령 처리 ────────────────────────────────────────
     브리프 생성보다 **먼저** 본다. 사람이 기다리고 있는 작업이다.
     이 분기는 도메니코가 "올려" 라고 쳐서 publish_queued 가 된 행에서만 돈다 —
     코드가 스스로 이 상태로 넘기는 경로는 어디에도 없다(절대 규칙). */
  const { data: pubRows, error: pubErr } = await supabaseAdmin.from('celeb_brief_queue')
    .select('*').eq('status', 'publish_queued')
    .order('created_at', { ascending: true }).limit(1);
  if (pubErr) {
    note(res, '게시 큐 조회 실패: ' + String(pubErr.message).slice(0, 150));
    return res.status(500).json({ ok: false, error: 'publish queue query failed' });
  }
  if (pubRows && pubRows.length) return await runPublish(pubRows[0], res, dry);

  /* ── 0.6 웹 전용 게시 ("웹만") ─────────────────────────────────
     인스타 인사이트에 부담 없이 웹사이트에만 기사를 낸다(도메니코 2026-08-23).
     이 상태도 도메니코의 명령("웹만")으로만 진입한다 — 발행 판단은 사람. */
  const { data: webRows } = await supabaseAdmin.from('celeb_brief_queue')
    .select('*').eq('status', 'web_queued')
    .order('created_at', { ascending: true }).limit(1);
  if (webRows && webRows.length) return await runWebPublish(webRows[0], res, dry);

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
  /* 한 브리프 = 하나의 batch_key. 자동감시는 게시물마다, 수동 붙여넣기는 한 메시지마다
     batch_key 가 하나다. 예전엔 "같은 방 + 5분 창" 으로 묶었는데(BATCH_WINDOW_MS), 자동감시로
     서로 다른 게시물이 동시에 들어오면 한 덩어리로 뭉쳐 영상·기사가 섞였다(2026-08-24 수정).
     이제 batch_key 로만 묶는다 — 정확히 한 게시물(또는 한 메시지)이 한 브리프다. */
  const rows = queued
    .filter((r) => (head0.batch_key ? r.batch_key === head0.batch_key : r.id === head0.id))
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

    /* 셀럽 게이트 (2026-08-26) ────────────────────────────────────────
       도메니코: "모두 셀럽이 포함된 기사여야만해. 그냥 디올 기사같은건 필요없어."
       실측(브리프 42건): 디올 단독 9건, 4시간 안에 같은 테일러링 캠페인 3건.
       계정을 지우지 않는 이유는 celebBrief.celebGate 머리말에 적었다.

       버리지 않고 상태로 남긴다 — 게이트가 과하게 잡는지 나중에 셀 수 있어야
       한다. 텔레그램에는 아무것도 보내지 않는다(조용해지는 게 목적이다). */
    const gate = celebBrief.celebGate(gen.entities);
    if (!gate.pass) {
      await supabaseAdmin.from('celeb_brief_queue').update({
        status: 'skipped_no_celeb', processed_at: new Date().toISOString(),
        error: gate.reason,
        result: { title: gen.title_ko || gen.title, entities: gen.entities, skipped: gate.reason },
      }).in('id', ids);
      return res.status(200).json({
        ok: true, skipped: 'no_celeb', title: gen.title_ko,
        note: note(res, '셀럽 없음으로 건너뜀: ' + String(gen.title_ko || '').slice(0, 50)
          + ' — ' + gate.reason),
      });
    }

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
      question: koSplit.question,               // 기사 마지막이 질문이면 그걸 그대로 쓴다
      fallbackQuestion: gen.comment_question,   // 아니면 모델이 따로 만든 질문 (댓글이 비면 대댓글도 못 단다)
      entities: gen.entities,                   // 인물·그룹·브랜드 — 대댓글 해시태그의 본체(도메니코 2026-08-23)
      tags: gen.tags,                           // 주체를 하나도 못 뽑았을 때만 쓰인다
    });

    /* ── 4. 미디어 준비 — 판형은 **실측 뒤에** 정한다 (2026-08-26) ────────
       종전 순서: 커버를 먼저 그리고(영상이면 무조건 9:16) 영상을 나중에 쟀다.
       그래서 4:5 영상 게시물에 9:16 커버가 붙었다 — 브리프 25(프라다) 720x900.
       인스타 캐러셀은 첫 장이 비율을 정하므로 뒤 영상이 눌리거나 잘린다.
       도메니코 2026-08-26: "위아래 납짝해지지 않게 … 비율이 엉망이야."

       순서를 뒤집는다: ① 원본을 받아 재고 → ② 실측으로 판형을 정하고 → ③ 커버.
       내려받기는 한 번뿐이다 — 재려고 두 번 받으면 시간·비용이 두 배가 된다. */

    /* 첫 슬라이드가 사진이면 그 원본은 커버로 이미 쓴 셈이라 다시 넣지 않는다.
       영상이면 커버는 프레임일 뿐이므로 **영상 본체를 이어서 넣는다.** */
    const rest = items[0].type === 'image' ? items.slice(1) : items;
    let tooBig = 0;
    const videoSizes = [];      // 크롭이 정말 필요한지 숫자로 보기 위해 기록한다
    let firstDim = null;        // items[0] 이 영상일 때의 실측값 — 판형의 유일한 근거
    const fetched = [];         // { type, buffer } — 받아만 두고 조립은 판형 확정 뒤에
    for (let ri = 0; ri < rest.length; ri++) {
      const it = rest[ri];
      try {
        const buf = await fetchBuffer(it.url, it.type === 'video' ? 60000 : 20000);
        if (it.type === 'video' && buf.length > VIDEO_MAX_BYTES) { tooBig++; continue; }
        if (it.type === 'video') {
          /* 크롭은 재인코딩이고 Vercel 에는 ffmpeg 가 없다(_lib/mp4Mute.js 머리말).
             그래서 **원본이 어떤 비율인지**를 잰다. 순수 JS 로 tkhd 만 읽는다. */
          try {
            const { mp4Dimensions } = require('../_lib/mp4Mute');
            const dim = mp4Dimensions(buf);
            if (dim) {
              videoSizes.push(dim);
              if (ri === 0 && items[0].type === 'video') firstDim = dim;
            }
          } catch (e) {
            console.warn('[celeb-brief] 영상 해상도 읽기 실패:', (e && e.message) || e);
          }
        }
        fetched.push({ type: it.type, buffer: buf });
      } catch (e) {
        console.warn('[celeb-brief] 미디어 건너뜀:', (e && e.message) || e);
      }
    }

    /* 판형 확정. 못 쟀으면 종전 동작(영상=reels)을 그대로 유지한다. */
    const variant = celebBrief.pickVariant(items, firstDim);

    const media = [];
    const cover = await fetchBuffer(coverUrl, 20000);
    const { renderThumb } = require('../_lib/celebThumb');
    const coverDesigned = await renderThumb(cover, gen.title_ko || gen.title, gen.title_en || '',
      { variant, focusTop: gen.cover_focus_top });   // 4:5 크롭에서 얼굴이 안 잘리게
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

    /* 디자인 굽기도 판형이 정해진 뒤에 한다 — 종전에는 'reels' 로 **고정**돼
       있어서 4:5 영상에 9:16 오버레이가 구워졌다. 기본은 꺼져 있고
       CELEB_BURN_OVERLAY=on 일 때만 돈다. 실패하면 원본으로 계속 간다 —
       굽기가 안 된다고 브리프가 사라지면 안 된다. */
    let burnedCount = 0;
    let burnFailed = 0;
    const burnedVideos = [];
    /* 사진은 전부 판형 비율로 채워 자른다 (2026-08-26 도메니코: "가로형 이미지는
       확대를해서 다른 세로형 이미지들과 같게 잘라줘"). 인물 보호와 그 한계는
       _lib/slideCrop.js 머리말에 적었다 — 많이 잘린 컷은 번호로 지목한다. */
    const slideCrop = require('../_lib/slideCrop');
    let croppedCount = 0;
    const severeSlides = [];      // 원본의 60% 미만만 남은 컷 = 사람이 봐야 하는 컷
    for (const f of fetched) {
      if (f.type !== 'video') {
        const c = await slideCrop.cropSlideToVariant(f.buffer, variant);
        if (c.changed) croppedCount++;
        if (c.severe) severeSlides.push(media.length + 1);   // 커버가 1번
        media.push({ kind: 'photo', buffer: c.buffer });
        continue;
      }
      let vbuf = f.buffer;
      if (videoOverlay.isEnabled()) {
        try {
          const { renderOverlay } = require('../_lib/celebThumb');
          const ov = await renderOverlay(gen.title_ko || gen.title, gen.title_en || '', { variant });
          const burned = await videoOverlay.burnIntro(f.buffer, ov);
          if (burned) { vbuf = burned; burnedCount++; }
          else burnFailed++;
        } catch (e) {
          burnFailed++;
          console.error('[celeb-brief] 디자인 굽기 실패(원본으로 진행):', (e && e.message) || e);
        }
      }
      media.push({ kind: 'video', buffer: vbuf, thumb: videoThumb });
      if (vbuf !== f.buffer) burnedVideos.push(vbuf);
    }

    /* 경고는 **고른 판형 기준**으로 낸다. 종전에는 0.5625 로 고정 비교라
       4:5 를 올바르게 feed 로 보낸 경우까지 "9:16 아님" 이라고 짖었다. */
    const targetRatio = variant === 'reels' ? 0.5625 : 0.8;
    const offRatio = videoSizes.filter((d) => Math.abs(d.ratio - targetRatio) > 0.02);
    /* 자른 결과를 숨기지 않는다. 특히 많이 잘린 컷은 **번호로** 알린다 —
       attention 은 휴리스틱이라 단체 사진에서 누군가를 놓칠 수 있다.
       "인물이 안 잘렸다"고 장담하는 대신 위험한 컷을 지목한다. */
    const cropNote = croppedCount
      ? (' · 사진 ' + croppedCount + '장 ' + variant + ' 비율로 자름'
         + (severeSlides.length
            ? (' ⚠️많이 잘린 컷 ' + severeSlides.join('·') + '번 — 인물 확인 필요')
            : ''))
      : '';
    const sizeNote = videoSizes.length
      ? (' · 영상 ' + videoSizes.map((d) => d.width + 'x' + d.height).join(', ')
         + ' · 커버 ' + variant
         + (offRatio.length ? (' ⚠️비율 불일치 ' + offRatio.length + '건') : ' (비율 일치)'))
      : '';
    const buffers = media;   // 아래 dry 응답 호환

    /* 구운 영상은 Storage 에 올려 둔다 — 게시할 때 다시 굽지 않기 위해서다. */
    let burnedVideoUrl = null;
    if (burnedVideos.length) {
      try {
        const igPublish = require('../_lib/igPublish');
        burnedVideoUrl = await igPublish.uploadPublic(
          burnedVideos[0], 'celeb-burn/' + rows[0].shortcode + '-' + rows[0].id + '.mp4', 'video/mp4');
      } catch (e) {
        console.error('[celeb-brief] 구운 영상 보관 실패(게시 때 다시 굽는다):', (e && e.message) || e);
      }
    }

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
    const capWithNote = caption
      + (tooBig ? ('\n\n※ 용량이 커서 영상 ' + tooBig + '건은 뺐습니다(45MB 초과).') : '')
      /* 많이 잘린 컷은 캡션에 적어 텔레그램에서 바로 보이게 한다. 크론 노트에만
         적으면 도메니코가 못 본다 — 확인해야 할 사람이 볼 자리에 둔다. */
      + (severeSlides.length
         ? ('\n\n⚠️ ' + severeSlides.join('·') + '번 사진은 가로형이라 많이 잘렸습니다. 인물이 잘리지 않았는지 확인해 주세요.')
         : '');
    const split = celebBrief.splitCaptionForTelegram(capWithNote);
    await tg.sendMediaToTelegram(media, split.caption, rows[0].chat_id);
    if (split.overflow) await tg.sendTextToChatSafe(rows[0].chat_id, split.overflow);
    /* 댓글·대댓글은 **검토용**으로 보여준다. 도메니코가 붙여넣는 게 아니라
       "올려" 하면 게시 직후 우리가 직접 단다(도메니코 2026-08-23 확인).
       그래서 라벨에 그 사실을 적는다 — 안 적으면 손으로 달아야 하는 줄 안다. */
    if (comments.comment || comments.reply) {
      const preview = ['📝 게시하면 아래가 자동으로 달립니다']
        .concat(comments.comment ? ['', '💬 댓글', comments.comment] : [])
        .concat(comments.reply ? ['', '↳ 대댓글', comments.reply] : [])
        .join('\n');
      await tg.sendTextToChatSafe(rows[0].chat_id, preview);
    }
    /* 브리프 번호 — 여러 건이 동시에 대기할 때 "올려 <번호>" 로 고르게 한다
       (자동 감시 도입으로 동시 도착이 정상 상황이 됐다). */
    await tg.sendTextToChatSafe(rows[0].chat_id,
      '✅ 브리프 #' + rows[0].id + ' — 게시: "올려 ' + rows[0].id + '" (대기가 이것뿐이면 그냥 "올려")');

    await supabaseAdmin.from('celeb_brief_queue').update({
      status: 'done', processed_at: new Date().toISOString(), error: null,
      result: {
        slides: media.length, title: gen.title_ko, title_en: gen.title_en, variant,
        /* "웹만" 게시가 브리프에서 검토한 본문을 그대로 쓰도록 전문을 보관.
           재생성하면 도메니코가 본 것과 다른 글이 나간다. */
        gen: {
          title_ko: gen.title_ko, title_en: gen.title_en,
          body_ko: gen.body_ko, body_en: gen.body_en,
          category: gen.category, tags: gen.tags, slug: gen.slug, faq: gen.faq,
        },
        web: { permalink: head.permalink || rows[0].permalink, timestamp: head.timestamp || null },
        videos: media.filter((m) => m.kind === 'video').length,
        video_skipped_too_big: tooBig, missing_en: missingEn, video_sizes: videoSizes,
        has_comment: !!comments.comment,
        /* 게시 명령("올려")이 오면 이 재료로 그대로 올린다.
           이미지를 미리 Storage 에 올려두지 않는 이유: 올리지 않을 브리프까지
           전부 저장하면 낭비다. 원본 URL 과 제목만 남기면 커버는 다시 렌더해도
           **결정적으로 같은 그림**이 나온다(렌더러에 난수가 없다). */
        publish: {
          variant, coverUrl, burnedVideoUrl,
          items: items.map((i) => ({ type: i.type, url: i.url })),
          caption, comment: comments.comment, reply: comments.reply,
          titleKo: gen.title_ko || gen.title || '', titleEn: gen.title_en || '',
      focusTop: gen.cover_focus_top,       // 게시 때 커버를 다시 그리므로 같이 보관한다
        },
      },
    }).in('id', ids);

    return res.status(200).json({
      ok: true, slides: media.length, title: gen.title_ko, variant,
      note: note(res, '브리프 1건 전송(' + variant + ')'
        + (missingEn ? ' ⚠️영문 누락' : '')
        + (comments.comment ? '' : ' ⚠️댓글 질문 없음')
        + (burnedCount ? (' · 디자인 굽기 ' + burnedCount + '건') : '')
        + (burnFailed ? (' ⚠️굽기 실패 ' + burnFailed + '건(원본 사용)') : '')
        + (tooBig ? (' ⚠️영상 ' + tooBig + '건 용량초과 제외') : '')
        + ': ' + String(gen.title_ko || '').slice(0, 60) + ' (' + media.length + '장)' + sizeNote + cropNote),
    });
  } catch (e) {
    return await fail(String((e && e.message) || e).slice(0, 300));
  }
});
