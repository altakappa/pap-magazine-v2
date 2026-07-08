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

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

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
    });
  } catch (e) {
    console.error('[youtube-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
