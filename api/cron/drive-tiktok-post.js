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

const { bearerOk } = require('../_lib/secretCompare');
const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { buildHashtags } = require('../_lib/youtubeMeta');
const { IG_HANDLE_URL } = require('../_lib/igFirstLink');
const drive = require('../_lib/driveVideos');
const buffer = require('../_lib/buffer');
const breaker = require('../_lib/bufferBreaker');   // 2026-10-30 429 차단기
const { matchArticle, groupUnmatched, fileCore } = require('../_lib/koMatch');
const { loadSubPosts, findSubPost, subPostAsArticle, subPostUrl } = require('../_lib/igSubPosts');
const { claimDriveFile, finishClaim, doneIdsFrom } = require('../_lib/driveClaim');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
/* 상한·파일 선별·기사 조회 창은 _lib/tiktokDrive 한 곳에만 둔다.
 * 여기 100MB, 스토리지 50MB 로 서로 달라서 50~100MB 영상이 10분마다
 * 영원히 재시도하며 영원히 실패했다 (2026-09-07). */
const tkd = require('../_lib/tiktokDrive');
/* 2026-10-08 도메니코 "틱톡과 유튜브에 빠짐없이 올라가게해줘" — drive-youtube-post 와 같은 함수 */
const noMiss = require('../_lib/driveNoMiss');
const { mp4Readable } = require('../_lib/mp4Check');   // 2026-10-25 손상 파일 사전 검사
/* 스토리쇼츠의 제목·설명 규칙을 그대로 쓴다. 필요할 때만 불러온다 — 크론끼리 모듈을
   통째로 물면 테스트의 가짜 모듈 바꿔치기가 새 경로로 샌다. */
function story() { return require('./drive-story-shorts'); }
const MAX_BYTES = tkd.MAX_BYTES;
const CAPTION_MAX = 2200;                 // Buffer 경유 TikTok 캡션 상한 (2026-08-07 실측)
const ART_COLS = tkd.ART_COLS;
const LOOKBACK_DAYS = tkd.LOOKBACK_DAYS;
const STORAGE_DIR = 'tiktok-drive';

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
  /* 2026-09-03 — 인스타가 먼저 (도메니코: 주 도달은 인스타, 서브가 웹).
     틱톡 캡션은 클릭이 안 돼 계측 불가 — 순서가 유일한 우선순위 표현이다. */
  lines.push('▶ 인스타그램 : ' + IG_HANDLE_URL);
  // 2026-09-21 — 부계정 게시물이 출처면 없는 기사 URL 대신 그 게시물로
  if (art.sub) lines.push('▶ 원문 (@' + art.account + ') : ' + subPostUrl(art));
  /* 2026-10-08 — 기사 없이 파일명으로 올리는 영상(noArticle)은 없는 기사 URL 을 적지 않는다 */
  else if (!art.noArticle) lines.push('▶ 기사 전문 : ' + url);
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

/* ── 같은 파일을 영원히 재시도하지 않는다 (2026-10-25) ─────────────────────
   실측: 1022_이동욱… .mp4 가 57회 연속 실패(Buffer "Video could not be read").
   원인은 moov 없는 손상 파일이었는데, 'failed' 는 재시도 대상이라 10분마다
   스토리지 업로드 + Buffer 거부를 반복했다. 알림도 57번 쌓였다.
   규칙: ① 올리기 전 mp4 구조 검사 → 손상이면 즉시 'rejected'(재시도 안 함)
         ② 그 외 사유로도 같은 파일이 GIVE_UP_AFTER 회 연속 실패하면 'given_up'
   둘 다 doneIdsFrom 이 '끝난 것' 으로 치므로 다음 영상으로 넘어간다.
   실패 횟수는 ops_alert_state(key=tiktok_drive_fail:<fileId>) 에 둔다 —
   tiktok_posts 는 파일당 한 줄이고 detail 이 덮어써져 횟수를 못 센다.
   사람에게는 텔레그램(개인)으로 한 번 알린다 — 드라이브에서 파일을 바꾸거나
   빼는 건 사람 몫이다. */
const GIVE_UP_AFTER = Number(process.env.TIKTOK_DRIVE_GIVE_UP_AFTER || 3);
const FAIL_KEY = (fileId) => 'tiktok_drive_fail:' + fileId;

async function bumpFailCount(fileId, reason) {
  try {
    const { data } = await supabaseAdmin.from('ops_alert_state').select('last_payload').eq('key', FAIL_KEY(fileId)).maybeSingle();
    const n = ((data && data.last_payload && Number(data.last_payload.n)) || 0) + 1;
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: FAIL_KEY(fileId), updated_at: new Date().toISOString(),
      last_payload: { n, last: String(reason || '').slice(0, 200), at: new Date().toISOString() },
    });
    return n;
  } catch (e) {
    console.warn('[drive-tiktok-post] 실패 횟수 기록 실패:', (e && e.message) || e);
    return 1;   // 못 세면 1회로 본다 — 세다가 못 세서 포기하는 일은 없게
  }
}

async function tellHuman(text) {
  try {
    const { sendTextToTelegramPersonalSafe } = require('../_lib/telegram');
    await sendTextToTelegramPersonalSafe(text);
  } catch (e) { console.warn('[drive-tiktok-post] 텔레그램 알림 실패:', (e && e.message) || e); }
}

module.exports = withCronGuard('drive-tiktok-post', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
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
  /* 2026-10-30 — Buffer 429 쿨다운 중이면 드라이브 조회·스토리지 업로드까지 가지 않는다.
     10분마다 올렸다 거부당하는 왕복이 요청 상한을 갉아먹던 구조를 여기서 끊는다.
     5xx 가 아니라 200 '보류' 다 — 연속 실패 알림 57회 같은 폭풍을 만들지 않는다.
     (차단기가 켜질 때 텔레그램으로 한 번 알린다 — 아래 catch 참조) */
  const cool = await breaker.check();
  if (cool.cooling) {
    return res.status(200).json({ ok: true, held: true, until: cool.until,
      note: note(res, '⏸ Buffer 쿨다운 중 (429) — ' + cool.until + ' 까지 보류') });
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
      .select('drive_file_id, status, created_at').not('drive_file_id', 'is', null).limit(5000);
    const done = doneIdsFrom(doneRows);

    const { candidates, skipped } = tkd.pickViable(files, done);

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

    const articles = await tkd.recentArticles();
    /* 이 채널에 이미 게시된 기사 — 동점일 때 '아직 없는 기사' 를 고르는 기준 */
    /* 조회가 실패하면 빈 집합 — 동점 해소가 '아직 없는 기사' 우선을 못 할 뿐, 게시는 막지 않는다 */
    let takenTt = new Set();
    try { if (typeof tkd.takenArticleIds === 'function') takenTt = await tkd.takenArticleIds(); } catch (_e) { takenTt = new Set(); }

    /* 2026-09-21 — 웹 기사가 없으면 부계정 게시물(papfashion_·papbeauty_·pap_celeb·
       pap_object)을 출처로 쓴다. drive-youtube-post 와 같은 규칙·같은 함수. */
    let subs = [];
    try { subs = await loadSubPosts(supabaseAdmin); } catch (_e) { subs = []; }

    const dryRun = !!(req.query && req.query.dry === '1');

    /* ── 중복 영상이 줄 전체를 막지 않게 (2026-09-28 도메니코 "틱톡에 영상 업로드가 안되고있어") ──
     * 실측: 9/23 00:06 ~ 9/28, 10분마다 780회 같은 파일("0922_윤호가 다시 찾은 디젤…")에서 멈췄다.
     *   흐름: 그 파일에는 예전 'failed' 줄이 있었다(재시도용) → 후보로 다시 잡힘 →
     *         기사가 이미 릴스로 나가 '중복 방지' → skipped 를 insert → drive_file_id
     *         유니크 충돌로 조용히 실패 → return. 다음 회차도 똑같이 반복.
     *   게다가 후보 첫 번째에서 return 하니 뒤에 있던 새 영상(0926_보테가 성찬)까지 막혔다.
     * 그래서: ① 중복 판정은 후보 루프 안에서 하고, 중복이면 기록만 남기고 다음 후보로 간다.
     *         ② 기록은 기존 줄이 있으면 update, 없으면 insert. 결과를 확인하고 실패하면 적는다. */
    async function articleAlreadyPosted(art, fileId) {
      if (!art || !art.id) return null;
      try {
        const { data: taken0 } = await supabaseAdmin.from('tiktok_posts')
          .select('drive_file_id, status').eq('article_id', art.id).limit(1).maybeSingle();
        if (taken0 && taken0.status !== 'failed' && taken0.drive_file_id !== fileId) return taken0;
      } catch (_) { /* 확인 실패는 게시를 막지 않는다 — 아래 기록 단계가 다시 본다 */ }
      return null;
    }
    async function recordDuplicateSkip(file, art) {
      const d = 'drive:' + file.name + ' · 이미 기사 경로로 게시된 기사(' + art.id + ') — 중복 방지로 올리지 않음';
      try {
        const { data: ex } = await supabaseAdmin.from('tiktok_posts')
          .select('id, status, detail').eq('drive_file_id', file.id).limit(1).maybeSingle();
        if (ex) {
          if (ex.status !== 'failed') return { ok: true, kept: ex.status };
          const { error } = await supabaseAdmin.from('tiktok_posts')
            .update({ status: 'skipped', detail: String((ex.detail ? ex.detail + ' → ' : '') + d).slice(0, 1000) })
            .eq('id', ex.id);
          return error ? { ok: false, error: error.message } : { ok: true };
        }
        const { error } = await supabaseAdmin.from('tiktok_posts').insert({
          drive_file_id: file.id, status: 'skipped', detail: d,
        });
        return error ? { ok: false, error: error.message } : { ok: true };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
      }
    }

    const unmatched = [];
    const dupSkipped = [];
    let pick = null;
    for (const f of candidates) {
      const m = noMiss.matchOrTieBreak(f.name, articles, takenTt, { matchArticle });
      let cand = null;
      if (m.matched) cand = { file: f, art: m.matched, match: m };
      else {
        const sp = subs.length ? findSubPost(fileCore(f.name), subs) : null;
        const sa = sp ? subPostAsArticle(sp) : null;
        if (sa) cand = { file: f, art: sa, match: { score: 1, reason: 'sub:@' + sa.account, runnerUp: null } };
      }
      if (!cand) { unmatched.push({ name: f.name, reason: m.reason }); continue; }
      /* 올리기 전에 확인한다 (2026-09-07). 이미 나간 기사면 올리지 않고 다음 후보로. */
      if (await articleAlreadyPosted(cand.art, f.id)) {
        const w = dryRun ? { ok: true, dry: true } : await recordDuplicateSkip(f, cand.art);
        dupSkipped.push({ name: f.name, article: cand.art.title, recorded: w.ok, error: w.error || null });
        continue;
      }
      pick = cand; break;
    }
    const dupNote = dupSkipped.length
      ? ' · 중복 방지 ' + dupSkipped.length + '건(' + dupSkipped.map((d) => d.name + (d.recorded ? '' : ' 기록실패:' + d.error)).join(', ').slice(0, 300) + ')'
      : '';
    /* 기사를 끝내 못 찾은 파일 — FALLBACK_HOURS 뒤 파일명을 제목으로 (유튜브와 같은 규칙) */
    if (!pick) {
      const fb = noMiss.pickFallback(unmatched, candidates, Date.now(), (n) => story().titleFromFilename(n));
      if (fb) {
        pick = { file: fb.file, art: { id: null, noArticle: true, title: fb.title, tags: [], content: '' },
          match: { score: 0, runnerUp: null, reason: '기사 없음 ' + Math.round(fb.ageH) + '시간 → 파일명 제목으로 대체 게시' } };
      }
    }
    if (!pick) {
      if (dupSkipped.length && !unmatched.length) {
        return res.status(200).json({
          ok: true, skippedDuplicate: true, dupSkipped, skipped,
          note: note(res, '중복 방지 — 이미 게시된 기사의 영상: ' + dupSkipped.map((d) => d.name).join(', ').slice(0, 400)),
        });
      }
      return res.status(200).json({
        ok: true, matched: 0, unmatched, skipped, dupSkipped,
        /* 유튜브 크론과 같은 모양으로 (2026-09-02). */
        note: note(res, '매칭 실패 ' + unmatched.length + '건 — '
          + groupUnmatched(unmatched).slice(0, 1500)
          + ' · 목록에서 빼려면 파일명 앞에 _ 를 붙이거나 이름에 완료 를 넣으세요 (지우지 않아도 됩니다)' + dupNote),
      });
    }

    const { file, art, match } = pick;

    const caption = buildCaption(art);
    const shortTitle = (String(art.title || '') + ' — PAP MAGAZINE').slice(0, 90);

    if (dryRun) {
      return res.status(200).json({
        ok: true, dry: true,
        note: note(res, 'dry: ' + file.name + ' → ' + art.title),
        file: { name: file.name, mb: Math.round(file.bytes / 1048576) },
        match: { article: art.title, score: match.score, runnerUp: match.runnerUp, reason: match.reason },
        tiktok: { title: shortTitle, caption }, unmatched, skipped,
      });
    }

    /* ─── 자리 먼저 찜하기 ──────────────────────────────────────────
     * 여기가 순서의 핵심이다. 위의 done 검사는 '읽기' 라서 50초 뒤 게시까지
     * 아무것도 보장하지 못한다. 2026-08-07 휴닝카이가 틱톡에 두 번 올라간 게
     * 정확히 그 틈이었다(30초 간격 두 실행). 유니크 인덱스에 INSERT 를 부딪혀
     * 여기서 승자를 가른다. 진 쪽은 아무것도 올리지 않고 나간다. */
    const claim = await claimDriveFile('tiktok_posts', file.id);
    if (!claim.ok) {
      return res.status(200).json({
        ok: true, claimed: false, file: file.name, unmatched, skipped,
        note: note(res, '건너뜀 — ' + claim.reason + ' (' + file.name + ')'),
      });
    }

    let post = null; let status = 'submitted'; let detail = null; let publicUrl = null;
    try {
      const channelId = await buffer.findChannelId('tiktok');
      const buf = await drive.downloadVideo(file.id, MAX_BYTES);
      /* 2026-10-25 — 올리기 전에 파일 구조를 본다. 손상이면 Buffer 까지 가지 않는다. */
      const chk = mp4Readable(buf);
      if (!chk.ok) {
        const err = new Error('영상 파일 손상: ' + chk.reason + ' — 드라이브에 다시 올려야 함');
        err.permanent = true;
        throw err;
      }
      publicUrl = await relayToStorage(file.id, file.name, buf);
      post = await buffer.createVideoPost({
        channelId, text: caption, title: shortTitle,
        videoUrl: publicUrl, mode: 'shareNow', maxText: CAPTION_MAX,
      });
      detail = (art.noArticle ? 'fallback:' : 'drive:') + file.name + ' · buffer:' + String(post && post.status || '')
        + (match.tieBreak ? ' · 동점 자동선택' : '');
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
      if (err && err.permanent) {
        status = 'rejected';                       // 재시도 안 함 (doneIdsFrom 이 끝난 것으로 본다)
        await tellHuman('🎬 틱톡 드라이브 영상 거부 — 재시도 안 함\n' + file.name + '\n' + detail
          + '\n\n드라이브에서 이 파일을 온전한 것으로 바꾸거나(같은 이름이면 새 파일 id 로 다시 잡힌다) 폴더에서 빼세요.');
      } else if (err && err.rateLimited) {
        /* 2026-10-30 — 429 는 파일 탓이 아니다. 실패 횟수를 올리지 않는다(포기 금지).
           차단기가 처음 켜진 순간만 사람에게 알린다. 이후 회차는 위 check 에서 보류된다. */
        if (err.newlyTripped) {
          await tellHuman('⏸ Buffer 레이트리밋(429) — 틱톡 게시 전부 ' + (err.until || '') + ' 까지 보류\n'
            + '무료 플랜 상한(30일 3,000 / 24h 250 요청)일 가능성이 큽니다. publish.buffer.com 에서 플랜·사용량 확인.\n'
            + '마지막 시도: ' + file.name);
        }
      } else {
        const n = await bumpFailCount(file.id, detail);
        if (n >= GIVE_UP_AFTER) {
          status = 'given_up';
          detail = n + '회 연속 실패 후 포기 · 마지막: ' + detail.slice(0, 300);
          await tellHuman('🎬 틱톡 드라이브 영상 포기 — ' + n + '회 연속 실패\n' + file.name + '\n' + detail.slice(0, 300)
            + '\n\n파일을 바꾸거나 폴더에서 빼세요. 다시 시도시키려면 ops_alert_state 의 ' + FAIL_KEY(file.id) + ' 를 지우고 tiktok_posts 상태를 failed 로.');
        }
      }
    }

    /* 기록 실패를 삼키지 않는다 — 2026-08-07 유튜브 경로에서 같은 영상이
     * 두 번 공개 게시된 원인이 정확히 이것이었다. 기록이 안 되면 '올렸다'고
     * 말하지 않는다. 중복 게시가 훨씬 나쁘다.
     * 찜해 둔 줄을 갱신하는 것이므로 upsert 가 아니라 update 다 — upsert 는
     * 덮어쓰기라 경합이 조용히 통과한다. */
    /* article_id 는 '비어 있을 때만' 적는다 (2026-08-12).
     *
     * ■ 실측 사고: 2026-08-09 16:45 ~ 08-12 00:45, 2시간마다 29회.
     *   같은 영상(오피셜히게단디즘 내한.mp4)이 틱톡에 계속 올라갔다.
     *     duplicate key value violates unique constraint "uq_tiktok_posts_article_id"
     *   흐름: 찜 → 틱톡 게시 성공 → 기록(update)에서 article_id 충돌 → 500
     *        → 다음 회차가 '죽은 찜' 으로 보고 회수 → 다시 게시 … 무한반복.
     *   기록이 실패하면 게시했다고 말하지 않는 설계는 **옳았다**. 문제는
     *   그 기록이 애초에 성공할 수 없는 값을 쓰고 있었다는 것이다.
     *
     * ■ 왜 충돌하나
     *   tiktok_posts.article_id 에는 유니크 인덱스가 있다("한 기사는 한 번만").
     *   그런데 그 기사는 이미 기사 경로로 게시돼 줄을 갖고 있었다.
     *   드라이브 경로는 drive_file_id 가 이미 자기 고유키라 article_id 는
     *   '어느 기사에 붙은 영상인가' 를 적어두는 참고값일 뿐이다.
     *   참고값 때문에 게시 기록 자체가 실패하면 안 된다.
     *
     * ■ 그래서: 그 기사에 이미 다른 줄이 있으면 article_id 를 비우고
     *   detail 에 기사 id 를 남긴다. 연결 정보는 지키고 충돌만 피한다.
     *   (유니크 인덱스를 부분 인덱스로 되돌리는 선택지는 버렸다 —
     *    기사 경로의 upsert(onConflict:'article_id') 가 부분 인덱스로는
     *    동작하지 않는다. 2026-08-10 에 정확히 그 이유로 전체 인덱스로 바꿨다.) */
    let articleIdForRow = art.id;
    if (art.sub) detail = (detail ? detail + ' · ' : '') + 'sub:@' + art.account + '/' + (art.shortcode || '');
    try {
      const { data: taken } = art.id ? await supabaseAdmin.from('tiktok_posts')
        .select('drive_file_id').eq('article_id', art.id).limit(1).maybeSingle() : { data: null };
      if (taken && taken.drive_file_id !== file.id) {
        articleIdForRow = null;
        detail = (detail ? detail + ' · ' : '') + 'article=' + art.id + '(이미 게시된 기사라 연결 생략)';
      }
    } catch (_) { /* 확인 실패는 무시 — 아래 update 가 실패하면 어차피 알린다 */ }

    const rec = await finishClaim('tiktok_posts', file.id, {
      article_id: articleIdForRow, publish_id: post && post.id || null, status, detail,
    });
    if (!rec.ok) {
      const msg = 'DB 기록 실패 — 같은 영상이 반복 게시될 수 있음! publish_id=' + (post && post.id)
        + ' file=' + file.name + ' :: ' + rec.reason;
      console.error('[drive-tiktok-post]', msg);
      note(res, msg);
      return res.status(500).json({ ok: false, error: 'record failed', publish_id: post && post.id, detail: msg });
    }

    if (status === 'failed' && /429|쿨다운/.test(String(detail))) {
      /* 레이트리밋은 다음 회차에 낫지 않는 종류 — 5xx 로 57번 우는 대신 200 '보류'.
         기록은 failed 로 남아 쿨다운이 끝나면 같은 파일이 다시 후보가 된다. */
      return res.status(200).json({ ok: true, held: true, file: file.name, detail,
        note: note(res, '⏸ 틱톡 보류(Buffer 429): ' + file.name + ' — ' + String(detail).slice(0, 160)) });
    }
    if (status === 'failed') {
      note(res, '틱톡 게시 실패: ' + file.name + ' — ' + detail);
      return res.status(502).json({ ok: false, error: 'tiktok post failed', file: file.name, detail });
    }
    if (status === 'rejected' || status === 'given_up') {
      /* 이번 회차는 실패지만 '다음 회차에 낫지 않는' 종류라 5xx 로 또 알리지 않는다.
         사람에겐 위에서 텔레그램으로 알렸고, 다음 회차부터 이 파일은 후보에서 빠진다. */
      return res.status(200).json({
        ok: true, [status]: true, file: file.name, detail,
        note: note(res, '틱톡 영상 ' + (status === 'rejected' ? '거부(손상 파일)' : '포기(연속 실패)') + ': ' + file.name + ' — ' + detail.slice(0, 200)),
      });
    }
    return res.status(200).json({
      ok: true, publish_id: post.id, file: file.name, article: art.title,
      score: match.score, video_url: publicUrl, unmatched, skipped,
      note: note(res, '틱톡 1건 게시: ' + file.name + ' → ' + art.title
        + ' (일치 ' + match.score.toFixed(2) + ')' + (unmatched.length ? ' · 매칭보류 ' + unmatched.length + '건' : '') + dupNote),
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
