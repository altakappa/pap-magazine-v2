/**
 * PAP Magazine — 유튜브 영상 정리 크론: 재생목록(카테고리) 배치 + 제목·설명 재동기화
 * Route: /api/cron/youtube-organize   (매시 :25 · :55)
 *
 * 2026-09-23 도메니코:
 *   "너가 설명수정 해주고, 그리고 밀란패션위크에서 올라간 영상은 Fashion Week 카테고리에 넣어줘.
 *    너가 올리는 영상들이 각각 카테고리안에 배치가 잘되어있어야해"
 *
 * 하는 일 (한 회차에 최대 MAX_PER_RUN 건):
 *   ① meta_resync=true 인 행 — 연결 기사가 바뀐 영상. 제목 본문·설명을 지금 기사로 다시 쓴다.
 *      접두사([ Milan Fashion Week ] 등)는 두고 본문만 바꾼다 (ytPlaylist.retitle 참고).
 *   ② playlisted_at 이 비어 있는 행 — 재생목록 키를 정하고(ytPlaylist.pickCategory),
 *      이름이 맞는 채널 재생목록에 넣는다. 맞는 재생목록이 없으면 넣지 않고 알린다.
 *      재생목록을 새로 만들지 않는다 — 공개 재생목록 생성은 발행이라 도메니코 몫이다.
 *
 * 대상 범위: ORGANIZE_FROM 이후에 올라간 영상 + playlist_hint 가 있는 영상.
 *   그 전 영상은 사람이 이미 스튜디오에서 정리해 왔을 수 있어 건드리지 않는다.
 *
 * 전제: YouTube OAuth 에 youtube.force-ssl — 없으면 403 이고, 첫 회차에 '재인증 필요' 로 멈춘다.
 * 할당량: playlists.list 1 · videos.list 1 · playlistItems.insert 50 · videos.update 50 (하루 10,000).
 *
 * 진단: ?dry=1 (무엇을 어디에 넣을지만) · ?playlists=1 (채널 재생목록 목록만)
 */
'use strict';

const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const yt = require('../_lib/youtube');
const { classify } = require('../_lib/youtubeMeta');
const { pickCategory, matchPlaylist, fileNameFromDetail, retitle } = require('../_lib/ytPlaylist');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const ORGANIZE_FROM = process.env.YT_ORGANIZE_FROM || '2026-09-21T00:00:00Z';
const MAX_PER_RUN = 8;
const ART_COLS = 'id, title, slug, custom_url, content, category, tags';

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

/* 설명문은 드라이브 업로드 크론과 **같은 함수**를 쓴다. 따로 만들면 두 채널 설명이 갈라진다. */
function descriptionFor(art) {
  const { buildDescription } = require('./drive-youtube-post');
  return buildDescription(art, SITE + '/article/' + (art.custom_url || art.slug || ''));
}

async function loadArticles(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  const { data, error } = await supabaseAdmin.from('articles').select(ART_COLS).in('id', list);
  if (error) throw new Error('articles 조회 실패: ' + error.message);
  return new Map((data || []).map((a) => [a.id, a]));
}

module.exports = withCronGuard('youtube-organize', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET);
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = !!(req.query && req.query.dry === '1');

  try {
    // ── 0. 채널 재생목록 ───────────────────────────────────
    let playlists;
    try {
      playlists = await yt.listMyPlaylists();
    } catch (err) {
      const msg = String(err && err.message || err).slice(0, 200);
      note(res, '재생목록 조회 실패: ' + msg);
      return res.status(502).json({ ok: false, error: 'playlists.list failed', detail: msg });
    }
    if (req.query && req.query.playlists === '1') {
      return res.status(200).json({ ok: true, playlists, note: note(res, '재생목록 ' + playlists.length + '개: ' + playlists.map((p) => p.title).join(' · ')) });
    }

    // ── 1. 대상 행 ─────────────────────────────────────────
    const cols = 'id, video_id, article_id, detail, created_at, playlist_hint, playlist_id, playlisted_at, meta_resync';
    const { data: resync, error: e1 } = await supabaseAdmin.from('youtube_posts').select(cols)
      .eq('meta_resync', true).not('video_id', 'is', null).limit(MAX_PER_RUN);
    if (e1) throw new Error('youtube_posts(resync) 조회 실패: ' + e1.message);
    const { data: todo, error: e2 } = await supabaseAdmin.from('youtube_posts').select(cols)
      .is('playlisted_at', null).not('video_id', 'is', null).eq('status', 'submitted')
      .or('created_at.gte.' + ORGANIZE_FROM + ',playlist_hint.not.is.null')
      .order('created_at', { ascending: false }).limit(40);
    if (e2) throw new Error('youtube_posts(todo) 조회 실패: ' + e2.message);

    const arts = await loadArticles([...(resync || []), ...(todo || [])].map((r) => r.article_id));
    const done = []; const missing = []; const failed = [];
    let budget = MAX_PER_RUN;

    // ── 2. 제목·설명 재동기화 ──────────────────────────────
    for (const row of (resync || [])) {
      if (budget <= 0) break;
      const art = arts.get(row.article_id);
      if (!art) { failed.push(row.video_id + ' 기사 없음'); continue; }
      if (dry) { done.push('설명 재작성 예정 ' + row.video_id + ' → ' + art.title); continue; }
      try {
        const cur = await yt.getVideoSnippet(row.video_id);
        if (!cur) throw new Error('영상 없음');
        await yt.updateVideoSnippet(row.video_id, {
          title: retitle(cur.title, art.title, classify(art)),
          description: descriptionFor(art),
        });
        const { error } = await supabaseAdmin.from('youtube_posts')
          .update({ meta_resync: false, organize_error: null }).eq('id', row.id);
        if (error) throw new Error('기록 실패: ' + error.message);
        done.push('설명 재작성 ' + row.video_id);
        budget--;
      } catch (err) {
        if (err && err.needsReauth) {
          note(res, '재인증 필요 — /api/youtube/oauth 로 1회 승인하세요 (youtube.force-ssl 스코프). ' + String(err.message).slice(0, 120));
          return res.status(200).json({ ok: false, needsReauth: true, detail: String(err.message).slice(0, 300) });
        }
        failed.push(row.video_id + ' ' + String(err && err.message || err).slice(0, 80));
        await supabaseAdmin.from('youtube_posts').update({ organize_error: String(err && err.message || err).slice(0, 300) }).eq('id', row.id);
      }
    }

    // ── 3. 재생목록 배치 ───────────────────────────────────
    for (const row of (todo || [])) {
      if (budget <= 0) break;
      const fileName = fileNameFromDetail(row.detail);
      const art = arts.get(row.article_id) || { title: fileName, tags: [], category: '' };
      const key = pickCategory(art, row.playlist_hint, fileName);
      const pl = matchPlaylist(key, playlists);
      if (!pl) { missing.push(key + ':' + row.video_id); continue; }
      if (dry) { done.push(row.video_id + ' → ' + pl.title); continue; }
      try {
        await yt.addToPlaylist(pl.id, row.video_id);
        const { error } = await supabaseAdmin.from('youtube_posts').update({
          playlist_id: pl.id, playlist_title: pl.title, playlisted_at: new Date().toISOString(), organize_error: null,
        }).eq('id', row.id);
        if (error) throw new Error('기록 실패(재생목록엔 들어감): ' + error.message);
        done.push(row.video_id + ' → ' + pl.title);
        budget--;
      } catch (err) {
        if (err && err.needsReauth) {
          note(res, '재인증 필요 — /api/youtube/oauth 로 1회 승인하세요 (youtube.force-ssl 스코프). ' + String(err.message).slice(0, 120));
          return res.status(200).json({ ok: false, needsReauth: true, detail: String(err.message).slice(0, 300) });
        }
        failed.push(row.video_id + ' ' + String(err && err.message || err).slice(0, 80));
        await supabaseAdmin.from('youtube_posts').update({ organize_error: String(err && err.message || err).slice(0, 300) }).eq('id', row.id);
      }
    }

    const missKeys = [...new Set(missing.map((m) => m.split(':')[0]))];
    const parts = [];
    parts.push((dry ? '[dry] ' : '') + '정리 ' + done.length + '건');
    if (done.length) parts.push(done.slice(0, 6).join(' · '));
    if (missing.length) parts.push('⚠️ 맞는 재생목록 없음 ' + missing.length + '건 (' + missKeys.join(', ') + ') — 채널 재생목록: ' + playlists.map((p) => p.title).join(' / '));
    if (failed.length) parts.push('실패 ' + failed.length + '건: ' + failed.slice(0, 3).join(' · '));
    return res.status(200).json({ ok: true, dry, done, missing, failed, note: note(res, parts.join(' | ')) });
  } catch (err) {
    console.error('[youtube-organize] error:', err);
    note(res, '크론 예외: ' + String(err && err.message || err).slice(0, 200));
    return res.status(500).json({ error: 'youtube organize failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}, { silenceTransient: true });
