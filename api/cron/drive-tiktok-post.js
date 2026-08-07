/**
 * PAP Magazine — 구글 드라이브 영상 → TikTok 게시 크론
 * Route: /api/cron/drive-tiktok-post   (2시간마다 :45)
 *
 * ── 왜 중계가 필요한가 ────────────────────────────────────────
 * Buffer 는 파일 업로드를 받지 않는다. **공개 HTTPS 직링크**만 받고, 게시가
 * 끝날 때까지 그 URL 이 살아 있어야 한다. 구글 드라이브 링크는 못 쓴다 —
 * 로그인을 요구하고, 100MB 넘으면 바이러스 검사 페이지가 끼어든다.
 * 그래서 드라이브 → 우리 스토리지(media 버킷, 공개) → Buffer 순으로 옮긴다.
 *
 *   드라이브 mp4 ──(다운로드)──▶ Vercel ──(업로드)──▶ Supabase media
 *                                                       │ 공개 URL
 *                                                       ▼
 *                                              Buffer ──▶ TikTok
 *
 * ── 유튜브 경로와 같은 것 / 다른 것 ───────────────────────────
 * 같은 것: 파일 선택·제외 규칙·제목 유사도 매칭(_lib/koMatch)·중복 판정 키.
 * 다른 것: 유튜브는 바이트를 직접 올리지만 틱톡은 Buffer 가 URL 로 가져간다.
 *          그래서 스토리지 중계가 한 단계 더 붙는다.
 *
 * ── 2026-08-07 사고에서 배운 것 ──────────────────────────────
 * 유튜브 경로에서 upsert 오류를 확인하지 않아 같은 영상이 두 번 공개 게시됐다.
 * 여기서는 처음부터 기록 실패를 500 으로 떨어뜨린다. 그리고 인덱스도
 * 부분(where … is not null)이 아니라 전체 유니크로 만들었다(마이그레이션 109).
 *
 * 전제: BUFFER_API_KEY · Buffer 에 TikTok 채널 연결 · drive.readonly 재인증.
 * 진단: ?dry=1 (매칭·캡션만) · ?list=1 (후보 목록만).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { buildHashtags } = require('../_lib/youtubeMeta');
const drive = require('../_lib/driveVideos');
const buffer = require('../_lib/buffer');
const { matchArticle } = require('../_lib/koMatch');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const MAX_BYTES = 100 * 1024 * 1024;
const CAPTION_MAX = 2200;                 // Buffer 경유 TikTok 캡션 상한 (2026-08-07 실측)
const ART_COLS = 'id, title, slug, custom_url, content, category, tags, published_date';
const LOOKBACK_DAYS = Number(process.env.DRIVE_MATCH_LOOKBACK_DAYS || 21);
const STORAGE_DIR = 'tiktok-drive';

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

function firstSentence(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?다요])\s/)[0] || '';
}

/**
 * 틱톡 캡션 (순수 함수, 테스트 대상).
 * 틱톡은 API 로 넣은 줄바꿈을 클라이언트에 따라 뭉갠다. 그래서 줄을 공백 두 칸으로
 * 잇고 각 줄 앞에 ▶ 를 둬, 한 줄로 흘러도 구획이 보이게 한다(포토 경로와 같은 규칙).
 */
function buildCaption(art) {
  const url = 'pap-magazine.com/article/' + (art.custom_url || art.slug || '');
  const lines = [String(art.title || '') + ' — PAP MAGAZINE', ''];
  const fs = firstSentence(art.content);
  if (fs && fs.length <= 200) { lines.push(fs); lines.push(''); }
  lines.push('▶ 기사 전문 : ' + url);
  lines.push('');
  lines.push(buildHashtags(art, 5).join(' '));
  return lines.join('  ').slice(0, CAPTION_MAX);
}

/** 드라이브 파일을 우리 스토리지에 올리고 공개 URL 을 돌려준다. */
async function relayToStorage(fileId, fileName, buf) {
  const safe = String(fileName || 'video').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  const path = STORAGE_DIR + '/' + fileId + '/' + safe.replace(/\.[^.]*$/, '') + '.mp4';
  const { error } = await supabaseAdmin.storage.from('media')
    .upload(path, buf, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error('스토리지 업로드 실패: ' + (error.message || error));
  const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
  if (!data || !data.publicUrl) throw new Error('스토리지 공개 URL 없음');
  return data.publicUrl;
}

module.exports = withCronGuard('drive-tiktok-post', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!buffer.isConfigured()) {
    return res.status(200).json({ ok: true, note: note(res, 'BUFFER_API_KEY 미설정 — 건너뜀') });
  }
  if (!drive.isConfigured()) {
    return res.status(200).json({ ok: true, note: note(res, 'YOUTUBE_CLIENT_ID/SECRET 미설정 — 드라이브 접근 불가') });
  }

  try {
    let files;
    try {
      files = await drive.listVideos();
    } catch (err) {
      const msg = String(err && err.message || err);
      note(res, '드라이브 조회 실패: ' + msg.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'drive list failed', detail: msg.slice(0, 400) });
    }

    const { data: doneRows } = await supabaseAdmin.from('tiktok_posts')
      .select('drive_file_id, status').not('drive_file_id', 'is', null).limit(5000);
    const done = new Set((doneRows || []).filter((r) => r.status !== 'failed').map((r) => r.drive_file_id));

    const skipped = [];
    const candidates = [];
    for (const f of files) {
      if (done.has(f.id)) continue;
      const why = drive.shouldSkip(f.name, null, 'tiktok');
      if (why) { skipped.push({ name: f.name, why }); continue; }
      if (f.bytes > MAX_BYTES) {
        skipped.push({ name: f.name, why: Math.round(f.bytes / 1048576) + 'MB — 상한 초과' });
        continue;
      }
      candidates.push(f);
    }

    if (req.query && req.query.list === '1') {
      return res.status(200).json({
        ok: true, note: note(res, '틱톡 후보 ' + candidates.length + '건 / 보류 ' + skipped.length + '건'),
        candidates: candidates.map((c) => ({ name: c.name, mb: Math.round(c.bytes / 1048576) })), skipped,
      });
    }
    if (!candidates.length) {
      return res.status(200).json({
        ok: true, skipped,
        note: note(res, '틱톡에 올릴 영상 없음 (드라이브 ' + files.length + '건 · 기게시 제외 · 보류 ' + skipped.length + '건)'),
      });
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const { data: arts } = await supabaseAdmin.from('articles')
      .select(ART_COLS).eq('status', 'published')
      .gte('published_date', since)
      .order('published_date', { ascending: false }).limit(400);
    const articles = arts || [];

    const unmatched = [];
    let pick = null;
    for (const f of candidates) {
      const m = matchArticle(f.name, articles);
      if (m.matched) { pick = { file: f, art: m.matched, match: m }; break; }
      unmatched.push({ name: f.name, reason: m.reason });
    }
    if (!pick) {
      return res.status(200).json({
        ok: true, matched: 0, unmatched, skipped,
        note: note(res, '매칭 실패 ' + unmatched.length + '건 — '
          + unmatched.slice(0, 3).map((u) => u.name).join(', ')),
      });
    }

    const { file, art, match } = pick;
    const caption = buildCaption(art);
    const shortTitle = (String(art.title || '') + ' — PAP MAGAZINE').slice(0, 90);

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({
        ok: true, dry: true,
        note: note(res, 'dry: ' + file.name + ' → ' + art.title),
        file: { name: file.name, mb: Math.round(file.bytes / 1048576) },
        match: { article: art.title, score: match.score, runnerUp: match.runnerUp, reason: match.reason },
        tiktok: { title: shortTitle, caption }, unmatched, skipped,
      });
    }

    let post = null; let status = 'submitted'; let detail = null; let publicUrl = null;
    try {
      const channelId = await buffer.findChannelId('tiktok');
      const buf = await drive.downloadVideo(file.id, MAX_BYTES);
      publicUrl = await relayToStorage(file.id, file.name, buf);
      post = await buffer.createVideoPost({
        channelId, text: caption, title: shortTitle,
        videoUrl: publicUrl, mode: 'shareNow', maxText: CAPTION_MAX,
      });
      detail = 'drive:' + file.name + ' · buffer:' + String(post && post.status || '');
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
    }

    /* 기록 실패를 삼키지 않는다 — 2026-08-07 유튜브 경로에서 같은 영상이
     * 두 번 공개 게시된 원인이 정확히 이것이었다. 기록이 안 되면 '올렸다'고
     * 말하지 않는다. 중복 게시가 훨씬 나쁘다. */
    const { error: recErr } = await supabaseAdmin.from('tiktok_posts').upsert({
      drive_file_id: file.id, article_id: art.id,
      publish_id: post && post.id || null, status, detail,
    }, { onConflict: 'drive_file_id' });
    if (recErr) {
      const msg = 'DB 기록 실패 — 같은 영상이 반복 게시될 수 있음! publish_id=' + (post && post.id)
        + ' file=' + file.name + ' :: ' + String(recErr.message || recErr).slice(0, 200);
      console.error('[drive-tiktok-post]', msg);
      note(res, msg);
      return res.status(500).json({ ok: false, error: 'record failed', publish_id: post && post.id, detail: msg });
    }

    if (status === 'failed') {
      note(res, '틱톡 게시 실패: ' + file.name + ' — ' + detail);
      return res.status(502).json({ ok: false, error: 'tiktok post failed', file: file.name, detail });
    }
    return res.status(200).json({
      ok: true, publish_id: post.id, file: file.name, article: art.title,
      score: match.score, video_url: publicUrl, unmatched, skipped,
      note: note(res, '틱톡 1건 게시: ' + file.name + ' → ' + art.title
        + ' (일치 ' + match.score.toFixed(2) + ')' + (unmatched.length ? ' · 매칭보류 ' + unmatched.length + '건' : '')),
    });
  } catch (err) {
    console.error('[drive-tiktok-post] error:', err);
    note(res, '크론 예외: ' + String(err && err.message || err).slice(0, 200));
    return res.status(500).json({ error: 'drive tiktok cron failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}, { silenceTransient: true });

module.exports.buildCaption = buildCaption;
module.exports.CAPTION_MAX = CAPTION_MAX;
module.exports.STORAGE_DIR = STORAGE_DIR;
