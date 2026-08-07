/**
 * PAP Magazine — 구글 드라이브 → YouTube Shorts 업로드 크론
 * Route: /api/cron/drive-youtube-post   (2시간마다)
 *
 * ── 왜 이 경로가 생겼나 (2026-08-07) ───────────────────────────
 * 기존 youtube-post 는 인스타에서 회수한 mp4(articles.videos)를 올린다.
 * 그런데 2026-08-03 부터 회수 실패율이 18% → 69% 로 뛰었다. 라이선스 음원이
 * 붙은 릴스는 Graph API 가 media_url 을 **아예 주지 않는다**(영구, 복구 불가).
 * 도메니코: "노래가 있는 인스타 영상은 더이상 퍼올수가없대"
 *
 * 그래서 회수를 고치는 대신 **제작 시점에 원본을 보관**하는 쪽으로 뒤집었다.
 *   에디터 → 구글 드라이브 '유튜브' 폴더 → 맥미니 압축기(80MB 이하 mp4)
 *   → 이 크론 → YouTube Shorts
 *
 * ── 매칭이 이 파일의 급소다 ────────────────────────────────────
 * 파일명이 자유 형식이라("베이델리 규진") 어느 기사인지 서버가 모른다.
 * 도메니코가 '제목 유사도 자동 매칭'을 선택했다. 틀리면 **엉뚱한 영상이
 * 공개 유튜브에 올라간다.** 그래서 _lib/koMatch.js 는 확신할 때만 붙이고
 * 애매하면 거부한다. 거부된 파일은 note 와 텔레그램으로 사람에게 넘긴다.
 * 거부는 실패가 아니다 — 잘못 붙이는 것이 실패다.
 *
 * ── 소리 ───────────────────────────────────────────────────
 * 기존 릴스 경로는 무조건 음소거한다(인스타 음원 = Content ID 위험).
 * 드라이브 원본은 우리가 만든 것이라 **소리를 살린다** (도메니코 2026-08-07 결정).
 *
 * 전제:
 *   · YouTube OAuth 에 drive.readonly 스코프 + 1회 재인증
 *   · 맥미니 압축기가 돌아 mp4 가 80MB 이하로 준비돼 있을 것
 *
 * 진단: ?dry=1 (매칭 결과만) · ?list=1 (드라이브 파일 목록만)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { uploadVideo } = require('../_lib/youtube');
const { withCronGuard } = require('../_lib/cronGuard');
const { buildTitle, buildHashtags, buildTagList } = require('../_lib/youtubeMeta');
const drive = require('../_lib/driveVideos');
const { matchArticle } = require('../_lib/koMatch');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const MAX_BYTES = 100 * 1024 * 1024;   // Vercel 120초·1GB 안에서 다룰 수 있는 선
const ART_COLS = 'id, title, slug, custom_url, content, category, tags, source_media_type, published_date';
const LOOKBACK_DAYS = Number(process.env.DRIVE_MATCH_LOOKBACK_DAYS || 21);

// 조기 반환마다 흔적을 남긴다. (틱톡 21일 침묵의 원인이 이거였다)
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

function buildDescription(art, url) {
  const lines = [];
  /* < > 는 YouTube 가 거부한다 (2026-07-19 '<오디세이>' 사고). */
  lines.push(String(art.title || '').replace(/[<>]/g, '') + ' — PAP MAGAZINE');
  lines.push('');
  const fs = firstSentence(art.content);
  if (fs && fs.length <= 300) { lines.push(fs); lines.push(''); }
  lines.push('▶ 기사 전문 : ' + url);
  lines.push('▶ 인스타그램 : ' + SITE + '/ig/youtube');
  lines.push('▶ pap-magazine.com — 아트 기반 패션·뷰티·컬쳐 매거진');
  lines.push('');
  lines.push(buildHashtags(art).join(' '));
  return lines.join('\n').slice(0, 4900);
}

module.exports = withCronGuard('drive-youtube-post', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!drive.isConfigured()) {
    return res.status(200).json({ ok: true, note: note(res, 'YOUTUBE_CLIENT_ID/SECRET 미설정 — 건너뜀') });
  }

  try {
    // ── 1. 드라이브 목록 ────────────────────────────────────
    let files;
    try {
      files = await drive.listVideos();
    } catch (err) {
      const msg = String(err && err.message || err);
      note(res, '드라이브 조회 실패: ' + msg.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'drive list failed', detail: msg.slice(0, 400) });
    }

    if (req.query && req.query.list === '1') {
      return res.status(200).json({
        ok: true, note: note(res, '드라이브 영상 ' + files.length + '건'),
        folder: drive.folderId(),
        files: files.map((f) => ({ name: f.name, mb: Math.round(f.bytes / 1048576), skip: drive.shouldSkip(f.name) })),
      });
    }

    // ── 2. 제외·중복 거르기 ─────────────────────────────────
    const { data: doneRows } = await supabaseAdmin.from('youtube_posts')
      .select('drive_file_id, status').not('drive_file_id', 'is', null).limit(5000);
    // 실패 기록은 재시도를 허용한다 (일시 오류로 영구 배제되면 안 된다)
    const done = new Set((doneRows || []).filter((r) => r.status !== 'failed').map((r) => r.drive_file_id));

    const skipped = [];
    const candidates = [];
    for (const f of files) {
      if (done.has(f.id)) continue;                    // 이미 올림 — 조용히
      const why = drive.shouldSkip(f.name);
      if (why) { skipped.push({ name: f.name, why }); continue; }
      if (f.bytes > MAX_BYTES) {
        skipped.push({ name: f.name, why: Math.round(f.bytes / 1048576) + 'MB — 상한 초과 (맥미니 압축기 확인)' });
        continue;
      }
      candidates.push(f);
    }
    if (!candidates.length) {
      return res.status(200).json({
        ok: true, skipped,
        note: note(res, '올릴 영상 없음 (드라이브 ' + files.length + '건 · 기존 업로드 제외 · 보류 ' + skipped.length + '건)'),
      });
    }

    // ── 3. 기사 후보 ────────────────────────────────────────
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const { data: arts } = await supabaseAdmin.from('articles')
      .select(ART_COLS).eq('status', 'published')
      .gte('published_date', since)
      .order('published_date', { ascending: false }).limit(400);
    const articles = arts || [];

    // ── 4. 매칭 — 확신한 첫 건만 처리한다 ────────────────────
    const unmatched = [];
    let pick = null;
    for (const f of candidates) {
      const m = matchArticle(f.name, articles);
      if (m.matched) { pick = { file: f, art: m.matched, match: m }; break; }
      unmatched.push({ name: f.name, reason: m.reason });
    }

    if (!pick) {
      // 붙일 수 없는 것들은 조용히 두지 않는다 — 사람이 봐야 한다.
      // note 를 반환문 '안'에 두는 건 스타일이 아니라 규칙이다:
      // 테스트가 200 반환문마다 note(res,…) 를 강제해 침묵 재발을 막는다.
      return res.status(200).json({
        ok: true, matched: 0, unmatched, skipped,
        note: note(res, '매칭 실패 ' + unmatched.length + '건 — '
          + unmatched.slice(0, 3).map((u) => u.name).join(', ')),
      });
    }

    const { file, art, match } = pick;
    const artUrl = SITE + '/article/' + (art.custom_url || art.slug || '');
    const title = buildTitle(art);
    const description = buildDescription(art, artUrl);
    const isPublic = process.env.YOUTUBE_PUBLIC === '1';

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({
        ok: true, dry: true,
        note: note(res, 'dry: ' + file.name + ' → ' + art.title),
        file: { name: file.name, mb: Math.round(file.bytes / 1048576) },
        match: { article: art.title, score: match.score, runnerUp: match.runnerUp, reason: match.reason },
        youtube: { title, tags: buildTagList(art), privacy: isPublic ? 'public' : 'private' },
        description, unmatched, skipped,
      });
    }

    // ── 5. 내려받아 올린다 ──────────────────────────────────
    // 소리는 그대로 둔다. 드라이브 원본은 우리가 만든 것이라 인스타 음원이 아니다.
    let videoId = null; let status = 'submitted'; let detail = null;
    try {
      const buf = await drive.downloadVideo(file.id, MAX_BYTES);
      const v = await uploadVideo(buf, {
        title, description,
        tags: buildTagList(art),
        privacyStatus: isPublic ? 'public' : 'private',
      });
      videoId = v.id;
      const got = v.status && v.status.privacyStatus;
      detail = 'drive:' + file.name + (isPublic && got && got !== 'public' ? ' · privacy 강제 ' + got : '');
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
    }

    await supabaseAdmin.from('youtube_posts').upsert({
      drive_file_id: file.id, article_id: art.id, video_id: videoId, status, detail,
    }, { onConflict: 'drive_file_id' });

    if (status === 'failed') {
      note(res, '업로드 실패: ' + file.name + ' — ' + detail);
      return res.status(502).json({ ok: false, error: 'upload failed', file: file.name, detail });
    }
    return res.status(200).json({
      ok: true, video_id: videoId, file: file.name, article: art.title,
      score: match.score, unmatched, skipped,
      note: note(res, '드라이브 1건 업로드: ' + file.name + ' → ' + art.title
        + ' (일치 ' + match.score.toFixed(2) + ')' + (unmatched.length ? ' · 매칭보류 ' + unmatched.length + '건' : '')),
    });
  } catch (err) {
    console.error('[drive-youtube-post] error:', err);
    note(res, '크론 예외: ' + String(err && err.message || err).slice(0, 200));
    return res.status(500).json({ error: 'drive youtube cron failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}, { silenceTransient: true });

module.exports.buildDescription = buildDescription;
module.exports.MAX_BYTES = MAX_BYTES;
