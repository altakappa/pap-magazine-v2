/**
 * GET /api/admin/youtube-diagnose — YouTube 자동 업로드 현황 진단 (관리자 전용).
 *
 * QA #348. 웹사이트에 올라간 게시물이 YouTube Shorts 로 자동 업로드되고
 * 있는지 한 눈에 확인. 반환 JSON:
 *   {
 *     schedule: '15 1,13 * * * UTC → KST 10:15 / 22:15',
 *     env: { public_gate: '1'|'0'|null, has_client_id: bool, ... },
 *     oauth: { authorized, expires_at, expires_in_sec, scope },
 *     recent_posts: [ {article_id, video_id, status, detail, created_at, article: {...}} ... ],
 *     candidates: [ {id, title, published_date, has_video, ...} ...],
 *     summary: { last24h_success, last24h_failed, pending_candidates }
 *   }
 *
 * 소비자: frontend/youtube-diagnose.html
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { getAccessToken } = require('../_lib/youtube');

const YT_VIDEOS_API = 'https://www.googleapis.com/youtube/v3/videos';
const YT_PARTS = 'status,contentDetails,snippet,processingDetails';

function chunk(arr, n){
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * 업로드된 영상이 '지금 유튜브에서 어떤 상태인지' 를 정리한다 — 2026-08-05 신설.
 *
 * 왜 필요한가 ─────────────────────────────────────────────────────────
 * youtube_posts 는 '우리가 올렸다' 까지만 안다. status='submitted' 는 업로드
 * 요청이 200 을 받았다는 뜻이지, 그 영상이 지금 사람들에게 보인다는 뜻이
 * 아니다. 실측(2026-08-05): 업로드 52건 중 28건이 공개 URL 로 열리지 않았다.
 * 우리 DB 안에는 그 이유를 설명할 정보가 한 글자도 없다 — detail 은 전부 null.
 *
 * 답은 유튜브만 안다. videos.list 가 돌려주는
 *   status.privacyStatus   (private/unlisted/public)
 *   status.uploadStatus    (processed/failed/rejected)
 *   status.rejectionReason (copyright/duplicate/claim ...)
 *   contentDetails.regionRestriction.blocked  (Content ID 로 막힌 나라)
 * 네 값이 '왜 안 보이는지' 를 확정한다. 추측(음원 때문일 것이다)을 사실로
 * 바꾸는 유일한 방법이므로, 진단에 이 모드를 붙인다.
 *
 * 순수 함수로 떼어 둔 이유: 네트워크 없이 판정 규칙만 테스트하기 위해서다.
 *
 * @param {Array} items - videos.list 응답의 items
 * @param {Array<string>} requestedIds - 우리가 물어본 video id 전체
 */
function summarizeVideoStates(items, requestedIds){
  const byId = new Map((items || []).filter(Boolean).map((v) => [v.id, v]));
  const ids = (requestedIds || []).filter(Boolean);
  const counts = { public: 0, unlisted: 0, private: 0, missing: 0, rejected: 0, failed: 0 };
  const rows = [];

  for (const id of ids){
    const v = byId.get(id);
    if (!v){
      /* 우리 채널의 영상인데 목록에 없다 = 삭제됐거나 다른 채널 소유다.
         '조용히 빠진' 것을 빈칸이 아니라 명시적 상태로 남긴다. */
      counts.missing++;
      rows.push({ video_id: id, found: false, privacy: null, upload: null, why: '유튜브에 없음 (삭제됨 또는 다른 채널)' });
      continue;
    }
    const st = v.status || {};
    const cd = v.contentDetails || {};
    const sn = v.snippet || {};
    const privacy = st.privacyStatus || null;
    const upload = st.uploadStatus || null;
    const rejection = st.rejectionReason || null;
    const failure = st.failureReason || null;
    const blocked = (cd.regionRestriction && Array.isArray(cd.regionRestriction.blocked))
      ? cd.regionRestriction.blocked : [];

    if (counts[privacy] !== undefined) counts[privacy]++;
    if (upload === 'rejected') counts.rejected++;
    if (upload === 'failed') counts.failed++;

    let why = null;
    if (rejection) why = '유튜브가 거절: ' + rejection;
    else if (failure) why = '업로드 실패: ' + failure;
    else if (privacy && privacy !== 'public') why = '공개 상태가 ' + privacy;
    else if (blocked.length) why = '차단 국가 ' + blocked.length + '곳 (Content ID 가능성)';

    rows.push({
      video_id: id,
      found: true,
      title: sn.title || null,
      published_at: sn.publishedAt || null,
      privacy,
      upload,
      rejection,
      failure,
      licensed_content: !!cd.licensedContent,
      blocked_regions: blocked.length,
      embeddable: (st.embeddable === undefined) ? null : !!st.embeddable,
      why,
    });
  }

  const problems = rows.filter((r) => !r.found || r.privacy !== 'public' || r.upload !== 'processed' || r.rejection);
  return { requested: ids.length, counts, problems: problems.length, rows };
}

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  /* ?videos=1 — 올린 영상이 지금 유튜브에서 어떤 상태인지 실측한다.
     기본 진단(아래)은 우리 DB 만 본다. 이 모드만 유튜브에 직접 묻는다.
     쿼터를 쓰므로 기본 진단에 섞지 않고 요청했을 때만 호출한다.
     (videos.list part=status 는 호출당 1 unit · 50개씩 묶어 조회) */
  if (String((req.query && req.query.videos) || '') === '1'){
    try {
      const { data: rows } = await supabaseAdmin.from('youtube_posts')
        .select('video_id, article_id, status, created_at')
        .not('video_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);
      const ids = [...new Set((rows || []).map((r) => r.video_id).filter(Boolean))];
      if (!ids.length){
        return res.status(200).json({ ok: true, note: '조회할 video_id 가 없음', requested: 0 });
      }
      const token = await getAccessToken();
      const items = [];
      for (const part of chunk(ids, 50)){
        const url = YT_VIDEOS_API + '?part=' + encodeURIComponent(YT_PARTS) + '&id=' + part.join(',') + '&maxResults=50';
        const r = await fetch(url, {
          headers: { authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok){
          const body = await r.text().catch(() => '');
          throw new Error('videos.list 실패 (' + r.status + '): ' + body.slice(0, 300));
        }
        const j = await r.json();
        for (const it of (j.items || [])) items.push(it);
      }
      const out = summarizeVideoStates(items, ids);
      return res.status(200).json({ ok: true, mode: 'videos', ...out });
    } catch (e) {
      console.error('[youtube-diagnose] videos mode failed:', e);
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
    }
  }

  try {
    // 1) 환경변수 상태 (실제 값은 노출하지 않고 유무만)
    const env = {
      public_gate: process.env.YOUTUBE_PUBLIC || null, // '1' 이면 자동 업로드 진행
      has_client_id: !!process.env.YOUTUBE_CLIENT_ID,
      has_client_secret: !!process.env.YOUTUBE_CLIENT_SECRET,
      has_cron_secret: !!process.env.CRON_SECRET,
    };

    // 2) OAuth 토큰 상태 (youtube_auth id=1)
    let oauth = { authorized: false, error: null };
    try {
      const { data: row, error } = await supabaseAdmin.from('youtube_auth').select('*').eq('id', 1).maybeSingle();
      if (error) {
        oauth.error = error.message;
      } else if (!row) {
        oauth.error = 'youtube_auth 레코드 없음 — /api/youtube/oauth 로 최초 인증 필요';
      } else {
        oauth.authorized = !!row.refresh_token;
        oauth.has_refresh_token = !!row.refresh_token;
        oauth.expires_at = row.expires_at || null;
        oauth.expires_in_sec = row.expires_at
          ? Math.round((new Date(row.expires_at).getTime() - Date.now()) / 1000)
          : null;
        oauth.scope = row.scope || null;
        oauth.updated_at = row.updated_at || null;
      }
    } catch (e) {
      oauth.error = String(e && e.message || e).slice(0, 200);
    }

    // 3) 최근 youtube_posts 20건 (기사 join)
    const { data: postsRaw } = await supabaseAdmin
      .from('youtube_posts')
      .select('article_id, video_id, status, detail, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(20);
    const posts = postsRaw || [];

    // 관련 기사 정보 배치 조회 (제목/슬러그)
    const ids = posts.map(p => p.article_id).filter(Boolean);
    let artMap = new Map();
    if (ids.length){
      const { data: arts } = await supabaseAdmin
        .from('articles')
        .select('id, title, slug, custom_url, published_date')
        .in('id', ids);
      artMap = new Map((arts || []).map(a => [a.id, a]));
    }
    const recent_posts = posts.map(p => {
      const a = artMap.get(p.article_id) || null;
      return {
        article_id: p.article_id,
        article_title: a ? a.title : null,
        article_url: a ? ('/article/' + (a.custom_url || a.slug || a.id)) : null,
        video_id: p.video_id,
        video_url: p.video_id ? ('https://youtube.com/shorts/' + p.video_id) : null,
        status: p.status,
        detail: p.detail,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });

    // 4) 후보 기사 (최근 3일 + 영상 있음 + 아직 성공 업로드 안 됨)
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: fresh } = await supabaseAdmin.from('articles')
      .select('id, title, slug, custom_url, videos, published_date')
      .eq('status', 'published')
      .gte('published_date', cutoff)
      .order('published_date', { ascending: false })
      .limit(50);
    const postedIds = new Set(posts.filter(p => p.status !== 'failed').map(p => p.article_id).filter(Boolean));
    const candidates = (fresh || [])
      .filter(a => Array.isArray(a.videos) && a.videos.length >= 1 && a.videos[0])
      .map(a => ({
        id: a.id,
        title: a.title,
        published_date: a.published_date,
        video_url: a.videos[0],
        posted: postedIds.has(a.id),
        article_url: '/article/' + (a.custom_url || a.slug || a.id),
      }));

    // 5) 요약 통계 (최근 24h)
    const dayAgo = Date.now() - 86400000;
    const last24 = posts.filter(p => p.created_at && new Date(p.created_at).getTime() > dayAgo);
    const summary = {
      last24h_success: last24.filter(p => p.status === 'submitted').length,
      last24h_failed: last24.filter(p => p.status === 'failed').length,
      pending_candidates: candidates.filter(c => !c.posted).length,
      total_youtube_posts: posts.length,
    };

    // 6) 사람이 읽는 종합 진단
    const diagnosis = [];
    if (!oauth.authorized){
      diagnosis.push({ level: 'error', msg: 'YouTube OAuth 미인증. /api/youtube/oauth 를 관리자 브라우저로 1회 방문해 승인 필요.' });
    }
    if (env.public_gate !== '1'){
      diagnosis.push({ level: 'warn', msg: 'YOUTUBE_PUBLIC 환경변수가 "1"이 아님 — 크론이 자동 업로드 없이 대기 모드. 첫 수동 테스트 후 Vercel에 YOUTUBE_PUBLIC=1 추가 필요.' });
    }
    if (!env.has_client_id || !env.has_client_secret){
      diagnosis.push({ level: 'error', msg: 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET 미설정.' });
    }
    if (!env.has_cron_secret){
      diagnosis.push({ level: 'warn', msg: 'CRON_SECRET 미설정 — Vercel 크론이 인증되지 않아 실행 안 될 수 있음.' });
    }
    if (oauth.authorized && env.public_gate === '1' && summary.last24h_success === 0 && summary.pending_candidates === 0){
      diagnosis.push({ level: 'info', msg: '최근 3일 내 영상 있는 신규 기사가 없어 업로드할 소스가 없음.' });
    }
    if (oauth.authorized && env.public_gate === '1' && summary.last24h_success === 0 && summary.pending_candidates > 0){
      diagnosis.push({ level: 'warn', msg: summary.pending_candidates + '건의 후보가 있는데 최근 24시간 업로드 없음. 크론 로그(Vercel) 확인 필요.' });
    }
    if (summary.last24h_failed > 0){
      diagnosis.push({ level: 'error', msg: '최근 24시간 실패 ' + summary.last24h_failed + '건. 아래 목록의 detail 확인.' });
    }
    if (oauth.authorized && env.public_gate === '1' && summary.last24h_success > 0){
      diagnosis.push({ level: 'ok', msg: '자동 업로드 정상 동작 중. 최근 24시간 성공 ' + summary.last24h_success + '건.' });
    }

    return res.status(200).json({
      schedule: '15 1,13 * * * (UTC) → KST 10:15 / 22:15 daily',
      env,
      oauth,
      summary,
      diagnosis,
      recent_posts,
      candidates,
      hint: '올린 영상이 실제로 공개돼 있는지는 ?videos=1 로 확인 (유튜브에 직접 조회)',
    });
  } catch (e) {
    console.error('[youtube-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};

module.exports.summarizeVideoStates = summarizeVideoStates;
