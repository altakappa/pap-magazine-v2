/**
 * PAP Magazine — YouTube 채널 → 필름 페이지 자동 연동 크론 (2026-07-20, 도메니코 승인)
 * Route: /api/cron/youtube-sync
 *
 * QA(2026-07): 필름 페이지가 유튜브 채널 신규 업로드를 자동 반영하지 못한다는 지적.
 * 원인 = 인바운드 자동 연동 기능이 애초에 없었고 관리자 수동 등록만 존재했다.
 * 이 크론이 그 자동 연동을 구현한다.
 *
 * 동작:
 *   1) 채널 uploads 재생목록의 최근 업로드를 YouTube Data API(공개 데이터, API 키)로 조회
 *   2) 다음은 제외:
 *      - 이미 films.youtube_id 로 등록된 영상 (중복 방지)
 *      - youtube_posts.video_id (우리 IG 릴스 → 쇼츠 자동 업로드분) — 에디토리얼
 *        필름이 아니므로 필름 페이지 오염 방지
 *   3) 남은 신규 업로드를 films 에 자동 등록. 기본은 status='draft' (발행은 도메니코가
 *      검수 후 1클릭 — 절대 규칙 '발행은 사람이' 준수 + 비에디토리얼 영상 오노출 방지).
 *      YOUTUBE_SYNC_AUTOPUBLISH=1 설정 시 status='published' 로 즉시 노출.
 *
 * 의존 env (도메니코가 Vercel 콘솔에서 설정 — 공개값/비밀값):
 *   YOUTUBE_API_KEY        (필수) — YouTube Data API v3 키 (공개 데이터 읽기 전용)
 *   YOUTUBE_CHANNEL_ID     (필수) — PAP 채널 ID (UC... 형식)
 *   YOUTUBE_SYNC_AUTOPUBLISH=1 (선택) — 자동 발행. 미설정 시 draft(관리자 검수)
 *   YOUTUBE_SYNC_MAX       (선택) — 1회 최대 등록 수 (기본 8)
 *
 * cronGuard 로 매 실행이 cron_runs 에 기록되고, 실패 시 관리자 이메일 발송(모니터링).
 * 수동 트리거: 관리자 토큰 GET (?dry=1 로 선택 결과만 확인).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');

const API = 'https://www.googleapis.com/youtube/v3';

async function ytGet(path, params) {
  const q = new URLSearchParams(Object.assign({ key: process.env.YOUTUBE_API_KEY }, params));
  const r = await fetch(API + path + '?' + q.toString(), { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = (j.error && (j.error.message || (j.error.errors && j.error.errors[0] && j.error.errors[0].reason))) || r.status;
    throw new Error('YouTube API ' + path + ' 실패: ' + String(reason).slice(0, 200));
  }
  return j;
}

// 채널의 uploads 재생목록 ID 조회 (channels.contentDetails.relatedPlaylists.uploads).
async function uploadsPlaylistId(channelId) {
  const j = await ytGet('/channels', { part: 'contentDetails', id: channelId });
  const item = j.items && j.items[0];
  const pid = item && item.contentDetails && item.contentDetails.relatedPlaylists && item.contentDetails.relatedPlaylists.uploads;
  if (!pid) throw new Error('채널의 uploads 재생목록을 찾을 수 없음 (CHANNEL_ID 확인 필요)');
  return pid;
}

// 대표 썸네일 URL (maxres → standard → high → default 순).
function pickThumb(sn) {
  const t = (sn && sn.thumbnails) || {};
  return (t.maxres || t.standard || t.high || t.medium || t.default || {}).url || '';
}

module.exports = withCronGuard('youtube-sync', async function handler(req, res) {
  res.locals = res.locals || {};

  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  if (!process.env.YOUTUBE_API_KEY || !process.env.YOUTUBE_CHANNEL_ID) {
    res.locals.cronNote = 'env 미설정 대기 (YOUTUBE_API_KEY / YOUTUBE_CHANNEL_ID)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  const dry = String((req.query && req.query.dry) || '') === '1';
  const MAX = Math.max(1, Math.min(25, parseInt(process.env.YOUTUBE_SYNC_MAX || '8', 10) || 8));
  const autoPublish = process.env.YOUTUBE_SYNC_AUTOPUBLISH === '1';

  // 1) 채널 최근 업로드 조회
  const pid = await uploadsPlaylistId(process.env.YOUTUBE_CHANNEL_ID);
  const list = await ytGet('/playlistItems', { part: 'snippet,contentDetails', playlistId: pid, maxResults: '25' });
  const uploads = (list.items || []).map(it => ({
    videoId: it.contentDetails && it.contentDetails.videoId,
    title: (it.snippet && it.snippet.title) || '',
    publishedAt: (it.contentDetails && it.contentDetails.videoPublishedAt) || (it.snippet && it.snippet.publishedAt) || '',
    thumb: pickThumb(it.snippet),
  })).filter(v => v.videoId && v.title && !/^(private|deleted) video$/i.test(v.title));

  // 2) 제외 대상 로드 — 이미 등록된 필름 + 우리가 올린 쇼츠
  const [{ data: existingFilms }, { data: ourShorts }] = await Promise.all([
    supabaseAdmin.from('films').select('youtube_id').not('youtube_id', 'is', null),
    supabaseAdmin.from('youtube_posts').select('video_id').not('video_id', 'is', null),
  ]);
  const skip = new Set();
  (existingFilms || []).forEach(f => f.youtube_id && skip.add(f.youtube_id));
  (ourShorts || []).forEach(p => p.video_id && skip.add(p.video_id));

  const fresh = uploads.filter(v => !skip.has(v.videoId)).slice(0, MAX);

  if (dry) {
    res.locals.cronNote = 'dry: 신규 후보 ' + fresh.length + '건';
    return res.status(200).json({ ok: true, dry: true, uploadsPlaylist: pid, candidates: fresh, wouldPublish: autoPublish ? 'published' : 'draft' });
  }

  if (!fresh.length) {
    res.locals.cronNote = '신규 업로드 없음 (조회 ' + uploads.length + ' / 기존 제외)';
    return res.status(200).json({ ok: true, imported: 0, note: res.locals.cronNote });
  }

  // 3) films 자동 등록 (기본 draft — 발행은 도메니코 검수)
  const imported = [];
  const failed = [];
  for (const v of fresh) {
    const row = {
      title: v.title.slice(0, 200),
      youtube_id: v.videoId,
      thumbnail_url: v.thumb || null,
      published_date: v.publishedAt ? v.publishedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      categories: ['Film'],
      tags: [v.title.slice(0, 60)],
      credits: [],
      status: autoPublish ? 'published' : 'draft',
      created_by: null,   // 자동 연동 (관리자 아님) — 감사 로그상 시스템 유입 표시
      updated_by: null,
    };
    const { error } = await supabaseAdmin.from('films').insert(row);
    if (error) {
      // unique(youtube_id) 충돌은 동시 실행 race — 스킵 처리.
      if (error.code === '23505') continue;
      failed.push({ videoId: v.videoId, error: error.message });
    } else {
      imported.push({ videoId: v.videoId, title: v.title, status: row.status });
    }
  }

  res.locals.cronNote = '자동 등록 ' + imported.length + '건 (' + (autoPublish ? 'published' : 'draft') + ')'
    + (failed.length ? ' · 실패 ' + failed.length : '');
  return res.status(200).json({ ok: true, imported: imported.length, status: autoPublish ? 'published' : 'draft', items: imported, failed });
});
