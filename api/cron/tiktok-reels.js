/**
 * PAP Magazine — 릴스 기사 영상 → TikTok (Buffer 경유)
 * Route: /api/cron/tiktok-reels        (?dry=1 선택만 · ?days=N 신선도 창)
 *
 * ── 왜 만들었나 (2026-08-22) ─────────────────────────────────
 * 도메니코: "최근에 유튜브에 올라간 영상들이 틱톡에는 안올라갔어"
 * 실측: 카스쿨 페스티벌 2건(몬스타엑스 4naTFOWI1YY · 하이라이트 HuieJ_Os8C0)이
 * 유튜브에만 올라가 있었다. 고장이 아니라 **경로가 없었다**.
 *
 *   youtube-post        릴스 기사(source_media_type=VIDEO) mp4 → 유튜브   ✅
 *   tiktok-post         에디토리얼/기사 **사진** 슬라이드                  ❌ 영상 안 다룸
 *                       (게다가 기사 모드는 ARTICLE_MODE_ENABLED=false 로 꺼져 있고
 *                        vercel.json 에 등재조차 안 돼 있다)
 *   drive-tiktok-post   드라이브 파일 → 틱톡                              ❌ 드라이브만
 *
 * 즉 인스타에서 수집한 릴스 영상을 틱톡에 올리는 길이 통째로 비어 있었다.
 * 이 파일이 그 한 칸을 채운다.
 *
 * ── 유튜브와 같은 것 / 다른 것 ──────────────────────────────
 * 같은 것: 선택 기준(published · source_media_type=VIDEO · 신선도 3일 ·
 *          videos[0] 존재), 크레딧 게이트(verdictForMedia), 한 회차 1건.
 *          두 채널이 늘 짝이 맞아야 "왜 저건 유튜브에만 있지"가 안 생긴다.
 *
 * 다른 것: **소리를 벗기지 않는다.**
 *   유튜브 경로는 인스타 음원 Content ID 클레임을 피하려고 음소거한다.
 *   틱톡은 소리가 절반인 플랫폼이라 무음이면 노출 자체가 안 난다.
 *   도메니코가 2026-08-22 에 위험을 알고 '원본 소리 그대로' 로 결정했다.
 *   ⚠️ 남는 위험: 인스타 음원 라이브러리 곡이 쓰인 영상은 틱톡에서 음소거
 *      되거나 삭제될 수 있고, 반복되면 계정에 불이익이 쌓인다. 그런 일이
 *      실제로 생기면 이 파일에서 muteMp4(youtube-post 와 같은 헬퍼)를 태우고
 *      스토리지에 재업로드하는 경로로 바꾸면 된다 — 그때 고칠 자리는 여기 한 곳이다.
 *
 * ── 영상 전달 ────────────────────────────────────────────────
 * art.videos[0] 은 이미 우리 Supabase Storage 의 공개 HTTPS 보관본이다
 * (수집 때 영구 저장). Buffer 는 공개 URL 을 그대로 가져가므로 다운로드도
 * 재업로드도 필요 없다 — drive-tiktok-post 가 하는 스토리지 중계가 여기선 불필요하다.
 *
 * ── 중복 방지 ────────────────────────────────────────────────
 * tiktok_posts.article_id 는 **전체 유니크**다 (마이그레이션 116).
 * 그 인덱스를 방패로 **자리를 먼저 찜한다**(status='claiming' INSERT).
 * 왜 tiktok-post.js 처럼 '올린 뒤 기록' 하지 않나 — 2026-08-09 에 그 순서로
 * 기사 6편이 17번 게시됐다. 게시는 성공하고 기록이 실패하면 다음 회차가
 * '아직 안 올린 기사' 로 또 고른다. 밖으로 이미 나간 뒤라 되돌릴 수도 없다.
 * 먼저 찜하면 최악이 '올리지 못함' 이고, 그건 중복 게시보다 훨씬 낫다.
 */

'use strict';

const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');
const { withCronGuard } = require('../_lib/cronGuard');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { verdictForMedia } = require('../_lib/igCredit');
const { IG_HANDLE_URL } = require('../_lib/igFirstLink');
const buffer = require('../_lib/buffer');

const CAPTION_MAX = 2200;          // Buffer 경유 상한 (TikTok 자체는 4000)
const CREDIT_SCAN_MAX = 8;         // 크레딧 재조회 비용 상한 (youtube-post 와 동일)
const STALE_CLAIM_MS = 15 * 60 * 1000;
const ART_COLS = 'id, title, slug, custom_url, content, videos, category, tags, source_media_type, source_instagram_post_id';

/** 조기 반환마다 cron_runs 에 메모를 남긴다 — 없으면 '무음 실패' 가 된다. */
function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

function firstSentence(html) {
  return String(html || '')
    .replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?다요])\s/)[0] || '';
}

function buildCaption(art) {
  const url = 'pap-magazine.com/article/' + (art.custom_url || art.slug || '');
  const lines = [String(art.title || '') + ' — PAP MAGAZINE', ''];
  const s = firstSentence(art.content);
  if (s && s.length <= 200) { lines.push(s); lines.push(''); }
  /* 2026-09-03 — 인스타가 먼저 (도메니코: 주 도달은 인스타, 서브가 웹).
     틱톡 캡션은 클릭이 안 돼 계측 불가 — 순서가 유일한 우선순위 표현이다. */
  lines.push('▶ 인스타그램 : ' + IG_HANDLE_URL);
  lines.push('▶ 기사 전문 : ' + url);
  lines.push('');
  lines.push([
    '#PAPMAGAZINE', '#패션',
    art.category ? '#' + String(art.category).replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase() : null,
  ].filter(Boolean).join(' '));
  return lines.join('\n').slice(0, CAPTION_MAX);
}

module.exports = withCronGuard('tiktok-reels', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  if (!buffer.isConfigured()) {
    return res.status(200).json({ ok: true, note: note(res, 'BUFFER_API_KEY 미설정 — 건너뜀') });
  }

  // ── 1. 이미 처리한 기사 (failed 는 제외해 재시도를 허용) ──────────
  const { data: posted } = await supabaseAdmin.from('tiktok_posts')
    .select('article_id, status').not('article_id', 'is', null).limit(5000);
  const done = new Set((posted || [])
    .filter((p) => p.status !== 'failed')
    .map((p) => p.article_id).filter(Boolean));

  // ── 2. 후보 (유튜브와 같은 잣대) ───────────────────────────────
  const freshDays = Math.max(1, Math.min(14, Number((req.query && req.query.days) || 3) || 3));
  const freshCutoff = new Date(Date.now() - freshDays * 86400000).toISOString();
  const { data: arts, error: artErr } = await supabaseAdmin.from('articles')
    .select(ART_COLS)
    .eq('status', 'published')
    .eq('source_media_type', 'VIDEO')
    .gte('published_date', freshCutoff)
    .order('published_date', { ascending: false }).limit(200);
  if (artErr) {
    note(res, '기사 조회 실패: ' + String(artErr.message).slice(0, 150));
    return res.status(500).json({ ok: false, error: 'article query failed' });
  }
  const candidates = (arts || []).filter((a) =>
    !done.has(a.id) && Array.isArray(a.videos) && a.videos.length >= 1
    && typeof a.videos[0] === 'string' && /^https:\/\//.test(a.videos[0]));

  /* 크레딧 게이트는 후보를 '건너뛴다'. 첫 후보가 외부 크레딧이라고 거기서
     멈추면 그 릴스가 신선도 창에 있는 동안 틱톡이 통째로 죽는다.
     (youtube-post 와 같은 규칙 — 두 채널의 선택 결과가 갈리면 안 된다) */
  let art = null; let credit = null;
  const skipped = [];
  for (const cand of candidates.slice(0, CREDIT_SCAN_MAX)) {
    const v = await verdictForMedia(cand.source_instagram_post_id);
    if (v.owned) { art = cand; credit = v; break; }
    skipped.push({ title: cand.title, reason: v.reason });
  }
  if (!art) {
    return res.status(200).json({
      ok: true, skipped,
      note: note(res, '올릴 릴스 기사 없음 (최근 ' + freshDays + '일 · 후보 '
        + candidates.length + '건 / 크레딧 스킵 ' + skipped.length + '건)'),
    });
  }

  const caption = buildCaption(art);
  const shortTitle = String(art.title || '').slice(0, 90);

  if (req.query && req.query.dry === '1') {
    return res.status(200).json({
      ok: true, dry: true, credit,
      note: note(res, 'dry: ' + art.title),
      pick: { id: art.id, title: art.title, video: art.videos[0] }, caption,
    });
  }

  // ── 3. 자리 먼저 찜하기 (article_id 유니크가 방패) ─────────────
  // 죽은 찜(크래시로 남은 것)은 먼저 치운다. failed 도 재시도를 위해 치운다.
  const staleCut = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  await supabaseAdmin.from('tiktok_posts').delete()
    .eq('article_id', art.id).eq('status', 'failed');
  await supabaseAdmin.from('tiktok_posts').delete()
    .eq('article_id', art.id).eq('status', 'claiming').lt('created_at', staleCut);

  const { error: claimErr } = await supabaseAdmin.from('tiktok_posts')
    .insert({ article_id: art.id, status: 'claiming', detail: 'reels:' + shortTitle });
  if (claimErr) {
    // 유니크 충돌 = 다른 회차가 이미 잡았다. 실패가 아니라 정상 스킵이다.
    return res.status(200).json({
      ok: true, claimed: false,
      note: note(res, '건너뜀 — 이미 다른 회차가 처리 중/완료 (' + shortTitle + ')'),
    });
  }

  // ── 4. 게시 ────────────────────────────────────────────────
  let status = 'submitted'; let detail = null; let post = null;
  try {
    const channelId = await buffer.findChannelId('tiktok');
    post = await buffer.createVideoPost({
      channelId, text: caption, title: shortTitle,
      videoUrl: art.videos[0],       // 스토리지 공개 보관본 · 소리 그대로
      mode: 'shareNow', maxText: CAPTION_MAX,
    });
    detail = 'reels:' + shortTitle + ' · buffer:' + String((post && post.status) || '');
  } catch (err) {
    status = 'failed';
    detail = String((err && err.message) || err).slice(0, 400);
  }

  /* 기록 실패를 삼키지 않는다. 밖으로 이미 나간 뒤에 기록이 없으면
     다음 회차가 같은 영상을 또 올린다 (2026-08-09 사고). */
  const { error: recErr } = await supabaseAdmin.from('tiktok_posts')
    .update({ status, detail }).eq('article_id', art.id).eq('status', 'claiming');
  if (recErr) {
    note(res, '⛔ 게시 후 기록 실패 — 중복 게시 위험: ' + String(recErr.message).slice(0, 150));
    return res.status(500).json({ ok: false, error: 'record failed', posted: status === 'submitted', title: art.title });
  }

  if (status === 'failed') {
    note(res, '틱톡 게시 실패 — ' + String(detail).slice(0, 150));
    return res.status(502).json({ ok: false, error: 'tiktok post failed', detail, title: art.title });
  }

  return res.status(200).json({
    ok: true, title: art.title, article_id: art.id,
    note: note(res, '릴스 1건 게시: ' + art.title + (skipped.length ? ' (크레딧 스킵 ' + skipped.length + '건)' : '')),
  });
});
