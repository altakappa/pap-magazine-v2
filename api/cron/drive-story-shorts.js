/**
 * PAP Magazine — 스토리 전용 영상 → 유튜브 쇼츠 (2026-08-21 신설)
 *
 * ── 왜 이 경로가 따로 필요한가 ─────────────────────────────
 * 기존 `drive-youtube-post` 는 **기사 1건 = 영상 1건** 을 전제로 한다.
 * 제목·설명·기사 링크를 전부 articles 행에서 가져오기 때문이다.
 *
 * 그런데 인스타 **스토리에만** 올라간 영상은 피드 게시물이 없고, 따라서
 * 기사도 없다. 2026-08-21 라쁠레뜨·팔라스가 정확히 그 경우였고, 매칭기가
 * 2시간마다 '매칭 실패' 만 뱉었다. 실패 로그가 상시로 깔리면 **진짜 실패가
 * 그 안에 묻힌다** — 그게 이 파일을 만든 진짜 이유다.
 *
 * ── 제목을 어디서 가져오나 (도메니코 2026-08-21 결정) ──────
 * **파일명 그대로 쓴다.** AI 판단을 끼우지 않는다.
 *   `조니워커 변우석 스토리.mp4` → `[ CELEBRITY ] 조니워커 변우석 스토리 | PAP MAGAZINE`
 * 접두사(`[ CELEBRITY ]` 등)는 기존 youtubeMeta.classify 가 제목 문자열만 보고
 * 정한다 — 기사 카테고리가 없어도 동작한다.
 *
 * 대안으로 검토했던 것과 왜 안 골랐는지:
 *   · 첫 프레임 비전 판독 → 장면을 잘못 읽으면 틀린 제목이 공개로 나간다
 *   · 틱톡 캡션 가져오기  → video.list 스코프가 아직 안 열린다(non_sandbox_target)
 * 파일명은 사람이 쓴 값이라 둘 다보다 정확하고 비용이 0 이다.
 * 틱톡 권한이 열리면 캡션을 우선 쓰도록 이 파일만 고치면 된다.
 *
 * ── 폴더 ────────────────────────────────────────────────
 * 내 드라이브 / 유튜브 / **스토리쇼츠**
 * 하위 폴더라 기존 크론(최상위만 훑음)은 절대 건드리지 않는다. 서로 안 겹친다.
 *
 * ── 기록 ────────────────────────────────────────────────
 * youtube_posts 에 `article_id = null` 로 남긴다. 중복 방지는 drive_file_id 기준
 * (claimDriveFile / doneIdsFrom) — 기존 경로와 같은 장치를 그대로 쓴다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { uploadVideo } = require('../_lib/youtube');
const { buildTitle, buildHashtags, buildTagList } = require('../_lib/youtubeMeta');
const drive = require('../_lib/driveVideos');
const { claimDriveFile, finishClaim, doneIdsFrom } = require('../_lib/driveClaim');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const MAX_BYTES = 100 * 1024 * 1024;
const FOLDER_NAME = process.env.DRIVE_STORY_FOLDER_NAME || '스토리쇼츠';

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

/** 파일명 → 제목용 문자열. 확장자·압축기 접미사·군더더기만 걷어낸다. */
function titleFromFilename(name) {
  return String(name || '')
    .replace(/\.[A-Za-z0-9]{2,4}$/, '')      // 확장자
    .replace(/_압축$/, '')                    // 맥미니 압축기가 붙이는 접미사
    .replace(/[<>]/g, '')                     // YouTube 제목 금지 문자
    .replace(/\s+/g, ' ')
    .trim();
}

/** 스토리 영상용 설명문. 기사가 없으므로 사이트 홈으로 보낸다. */
function buildDescription(title, tagLine) {
  const lines = [];
  lines.push(title);
  lines.push('');
  /* 성장 헌법 3항 — 외부 발신 링크는 전부 utm. */
  lines.push('▶ PAP MAGAZINE : ' + SITE + '/?utm_source=youtube&utm_medium=social&utm_campaign=pap_story');
  /* 웹→IG 는 계측 경로만 (성장 헌법 3항). /ig/:src 는 경로형이라 외부 앱이
     쿼리를 지워도 귀속이 살아남는다 (2026-07-30 미디어킷 교훈). */
  lines.push('▶ Instagram : ' + SITE + '/ig/youtube');
  if (tagLine) { lines.push(''); lines.push(tagLine); }
  return lines.join('\n');
}

module.exports = withCronGuard('drive-story-shorts', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  if (!drive.isConfigured()) {
    return res.status(200).json({ ok: true, note: note(res, '유튜브 OAuth 미설정 — 건너뜀') });
  }

  /* 폴더가 아직 없으면 그것도 정상 상태다. 도메니코가 안 만들었을 뿐이다.
     '없다' 와 '접근 실패' 를 뭉개지 않는다 — 대응이 다르다. */
  let folder = null;
  try {
    folder = await drive.findSubfolderId(FOLDER_NAME);
  } catch (e) {
    return res.status(502).json({
      ok: false, error: 'drive lookup failed',
      note: note(res, '드라이브 조회 실패: ' + String((e && e.message) || e).slice(0, 200)),
    });
  }
  if (!folder) {
    return res.status(200).json({
      ok: true, note: note(res, "'" + FOLDER_NAME + "' 폴더가 아직 없음 — 만들면 자동으로 잡는다"),
    });
  }

  let files = [];
  try {
    files = await drive.listVideos(folder);
  } catch (e) {
    return res.status(502).json({
      ok: false, error: 'drive list failed',
      note: note(res, '드라이브 목록 실패: ' + String((e && e.message) || e).slice(0, 200)),
    });
  }

  if (req.query && req.query.list === '1') {
    return res.status(200).json({
      ok: true, folder, folderName: FOLDER_NAME,
      note: note(res, '스토리 영상 ' + files.length + '건'),
      files: files.map((f) => ({
        name: f.name, mb: Math.round(f.bytes / 1048576),
        skip: drive.shouldSkip(f.name, null, 'youtube'),
        title: buildTitle({ title: titleFromFilename(f.name), tags: [] }),
      })),
    });
  }

  const { data: doneRows } = await supabaseAdmin.from('youtube_posts')
    .select('drive_file_id, status, created_at').not('drive_file_id', 'is', null).limit(5000);
  const done = doneIdsFrom(doneRows);

  const skipped = [];
  let file = null;
  for (const f of files) {
    if (done.has(f.id)) continue;
    /* 압축 중인 임시 파일·시스템 파일 차단 — 2026-08-21 사고(b_4-WtPB6rA)와
       같은 규칙을 여기서도 그대로 탄다. 새 경로라고 예외를 두지 않는다. */
    const why = drive.shouldSkip(f.name, null, 'youtube');
    if (why) { skipped.push({ name: f.name, why }); continue; }
    if (f.bytes > MAX_BYTES) {
      skipped.push({ name: f.name, why: Math.round(f.bytes / 1048576) + 'MB — 상한 초과 (맥미니 압축기 확인)' });
      continue;
    }
    file = f; break;   // 한 회차에 한 건 (기존 경로와 같은 보폭)
  }

  if (!file) {
    return res.status(200).json({
      ok: true, skipped,
      note: note(res, '올릴 스토리 영상 없음 (폴더 ' + files.length + '건 · 기존 업로드 제외 · 보류 ' + skipped.length + '건)'),
    });
  }

  const claim = await claimDriveFile('youtube_posts', file.id);
  if (!claim.ok) {
    return res.status(200).json({
      ok: true, claimed: false, file: file.name, skipped,
      note: note(res, '건너뜀 — ' + claim.reason + ' (' + file.name + ')'),
    });
  }

  const base = titleFromFilename(file.name);
  const pseudo = { title: base, tags: [] };
  const title = buildTitle(pseudo);
  const tagLine = buildHashtags(pseudo, 6).join(' ');
  const description = buildDescription(base, tagLine);
  const isPublic = process.env.YOUTUBE_PUBLIC === '1';

  let videoId = null; let status = 'submitted'; let detail = null;
  try {
    const buf = await drive.downloadVideo(file.id, MAX_BYTES);
    const v = await uploadVideo(buf, {
      title, description,
      tags: buildTagList(pseudo),
      privacyStatus: isPublic ? 'public' : 'private',
    });
    videoId = v.id;
    const got = v.status && v.status.privacyStatus;
    detail = 'story:' + file.name + (isPublic && got && got !== 'public' ? ' · privacy 강제 ' + got : '');
  } catch (err) {
    status = 'failed';
    detail = 'story:' + file.name + ' :: ' + String((err && err.message) || err).slice(0, 360);
  }

  /* 기록 실패를 삼키지 않는다 — 기록이 없으면 다음 회차가 같은 영상을 또 올린다.
     유튜브 업로드는 되돌릴 수 없다 (2026-08-07·08-17 실사고). */
  const rec = await finishClaim('youtube_posts', file.id, {
    article_id: null, video_id: videoId, status, detail,
  });
  if (!rec.ok) {
    return res.status(500).json({
      ok: false, error: 'record failed', video_id: videoId, file: file.name,
      note: note(res, 'DB 기록 실패 — video_id=' + videoId + ' file=' + file.name + ' :: ' + rec.reason),
    });
  }

  return res.status(200).json({
    ok: status !== 'failed',
    video_id: videoId, file: file.name, title, skipped,
    note: note(res, status === 'failed'
      ? '스토리 쇼츠 실패: ' + file.name + ' — ' + detail
      : '스토리 쇼츠 1건 업로드: ' + file.name + ' → ' + title),
  });
}, { silenceTransient: true });
