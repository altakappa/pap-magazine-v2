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
const { claimDriveFile, finishClaim, doneIdsFrom } = require('../_lib/driveClaim');

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
        files: files.map((f) => ({ name: f.name, mb: Math.round(f.bytes / 1048576), skip: drive.shouldSkip(f.name, null, 'youtube') })),
      });
    }

    // ── 2. 제외·중복 거르기 ─────────────────────────────────
    const { data: doneRows } = await supabaseAdmin.from('youtube_posts')
      .select('drive_file_id, status, created_at').not('drive_file_id', 'is', null).limit(5000);
    // 실패 기록은 재시도를 허용한다 (일시 오류로 영구 배제되면 안 된다).
    // 'claiming' 은 살아 있는 동안만 제외한다 — 죽은 찜은 다시 후보로 돌아온다.
    const done = doneIdsFrom(doneRows);

    const skipped = [];
    const candidates = [];
    for (const f of files) {
      if (done.has(f.id)) continue;                    // 이미 올림 — 조용히
      const why = drive.shouldSkip(f.name, null, 'youtube');
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
    /* ─── 자리 먼저 찜하기 ──────────────────────────────────────────
     * 위 done 검사와 이 지점 사이에 업로드가 통째로 들어간다. 그 사이에
     * 시작한 실행은 done 을 다시 읽어도 아직 아무 기록을 못 본다.
     * 2026-08-07 틱톡에서 휴닝카이가 두 번 나간 게 정확히 그 틈이었고,
     * 이 크론도 구조가 같다. 유니크 인덱스에 INSERT 를 부딪혀 승자를 가른다. */
    const claim = await claimDriveFile('youtube_posts', file.id);
    if (!claim.ok) {
      return res.status(200).json({
        ok: true, claimed: false, file: file.name, unmatched, skipped,
        note: note(res, '건너뜀 — ' + claim.reason + ' (' + file.name + ')'),
      });
    }

    /* 이 기사가 이미 유튜브에 있으면 **업로드하지 않는다** (2026-08-17).
     *
     * 왜 필요한가 — 중복 판단 기준이 두 벌이었다.
     *   선정(위 done 검사)  drive_file_id 기준
     *   표 제약(UNIQUE)     article_id 기준
     * 드라이브를 거치지 않고 올린 기사는 drive_file_id 가 null 이라 done 에
     * 안 잡힌다. 그런데 UNIQUE 에는 걸린다. 그래서 업로드는 성공하고 기록만
     * 실패했고, 기록이 없으니 다음 회차가 같은 파일을 또 집어 올렸다.
     *
     * 실측: fbda0612 (오피셜히게단디즘 내한) 가 08-09 에 XwuhO_oqjeU 로 올라간 뒤
     * 08-17 에 ezayVsDK7jw 로 한 번 더 올라갔다. 08-07 에도 같은 사고가 있었다
     * (L3B-MNXZcZI 의 detail 참조). 두 번째 재발이다.
     *
     * 기록을 고치는 걸로는 부족하다. **유튜브 업로드는 되돌릴 수 없다.**
     * video_id 가 있는 행 = 실제로 채널에 올라간 것. 그러면 올리지 않는다.
     * status='failed' 는 video_id 가 없으므로 재시도가 계속 허용된다. */
    const { data: already } = await supabaseAdmin.from('youtube_posts')
      .select('video_id, status, drive_file_id')
      .eq('article_id', art.id)
      .not('video_id', 'is', null)
      .limit(1).maybeSingle();
    if (already && already.drive_file_id !== file.id) {
      const why = '이 기사는 이미 유튜브에 있다 (' + already.video_id + ')';
      await finishClaim('youtube_posts', file.id, {
        article_id: null, video_id: null, status: 'skipped',
        detail: 'drive:' + file.name + ' · ' + why,
      });
      return res.status(200).json({
        ok: true, skippedDuplicate: true, file: file.name, article: art.title,
        existing_video_id: already.video_id, unmatched, skipped,
        note: note(res, '중복 방지로 건너뜀 — ' + file.name + ' → ' + art.title + ' · ' + why),
      });
    }

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

    /* 기록 실패를 절대 삼키지 않는다.
     * 2026-08-07 사고: 107 이 부분 유니크 인덱스(where … is not null)를 만들었는데
     * PostgREST 의 onConflict 는 술어 없는 유니크 인덱스만 쓴다. upsert 가 에러를
     * 냈고 우리는 그걸 확인하지 않았다 → 유튜브엔 올라갔는데 표에는 안 남았고,
     * 크론이 2시간마다 같은 영상을 공개 채널에 다시 올릴 뻔했다.
     * 오늘 하루 종일 잡던 그 침묵 패턴을 새 코드에 그대로 심었던 셈이다.
     * 기록이 안 되면 '올렸다'고 말하지 않는다 — 중복 업로드가 훨씬 나쁘다. */
    const rec = await finishClaim('youtube_posts', file.id, {
      article_id: art.id, video_id: videoId, status, detail,
    });
    if (!rec.ok) {
      /* 안전망 (2026-08-17) — 여기서 그냥 500 을 내면 영상 정보가 어디에도
       * 안 남는다. 기록이 없으면 다음 회차가 같은 파일을 또 집어 올린다.
       * 실제로 그렇게 반복됐다. 그래서 원인이 무엇이든 **영상 정보만은
       * 반드시 남긴다** — 기사 연결을 포기하고 다시 기록한다.
       * 기사 연결은 나중에 사람이 붙일 수 있지만, 채널에 올라간 영상을
       * 되돌릴 수는 없다. 둘 중 하나를 버려야 하면 연결을 버린다. */
      const salvage = await finishClaim('youtube_posts', file.id, {
        article_id: null, video_id: videoId, status: status === 'failed' ? 'failed' : 'orphan',
        detail: 'drive:' + file.name + ' · 기사 연결 실패로 연결 없이 기록 :: ' + rec.reason,
      });
      const msg = 'DB 기록 실패 — video_id=' + videoId + ' file=' + file.name
        + ' :: ' + rec.reason + (salvage.ok ? ' (영상 정보는 연결 없이 남김 — 재업로드는 막힘)'
                                            : ' (구제 기록도 실패! 재업로드 위험)');
      console.error('[drive-youtube-post]', msg);
      note(res, msg);
      return res.status(500).json({ ok: false, error: 'record failed', video_id: videoId, salvaged: salvage.ok, detail: msg });
    }

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
