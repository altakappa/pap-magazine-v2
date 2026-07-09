/**
 * GET /api/admin/threads-diagnose — Threads 자동 게시 현황 진단 (관리자 전용).
 *
 * QA #352. threads-post 크론이 왜 대기 상태인지 / 언제부터 자동으로 게시되는지
 * 한 화면에서 확인. 유튜브 진단(youtube-diagnose.js) 패턴을 그대로 차용.
 *
 * 응답 JSON:
 *   {
 *     schedule: '45 *\/3 * * * → KST 3시간마다 :45',
 *     env: { has_app_id, has_app_secret, has_cron_secret },
 *     oauth: { authorized, has_access_token, expires_at, expires_in_days, user_id, updated_at },
 *     summary: { last24h_success, last24h_failed, pending_candidates, total_posts },
 *     diagnosis: [ {level, msg} ... ],
 *     recent_posts: [ ...20 ],
 *     candidates: [ ...최근 3일 발행된 아티클 (thread 미게시) ],
 *   }
 *
 * 소비자: frontend/threads-diagnose.html
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const env = {
      has_app_id:      !!process.env.THREADS_APP_ID,
      has_app_secret:  !!process.env.THREADS_APP_SECRET,
      has_cron_secret: !!process.env.CRON_SECRET,
    };

    // OAuth 토큰 상태
    let oauth = { authorized: false, error: null };
    try {
      const { data: row, error } = await supabaseAdmin.from('threads_auth').select('*').eq('id', 1).maybeSingle();
      if (error) oauth.error = error.message;
      else if (!row) oauth.error = 'threads_auth 레코드 없음 — /api/threads/oauth 로 최초 인증 필요';
      else {
        oauth.authorized = !!row.access_token;
        oauth.has_access_token = !!row.access_token;
        oauth.user_id = row.user_id || null;
        oauth.expires_at = row.expires_at || null;
        if (row.expires_at) {
          const diffMs = new Date(row.expires_at).getTime() - Date.now();
          oauth.expires_in_days = Math.round(diffMs / 86400000);
        }
        oauth.updated_at = row.updated_at || null;
      }
    } catch (e) { oauth.error = String(e && e.message || e).slice(0, 200); }

    // 최근 20건
    const { data: postsRaw } = await supabaseAdmin.from('threads_posts')
      .select('article_id, thread_id, status, detail, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(20);
    const posts = postsRaw || [];

    const ids = posts.map(p => p.article_id).filter(Boolean);
    let artMap = new Map();
    if (ids.length){
      const { data: arts } = await supabaseAdmin.from('articles')
        .select('id, title, slug, custom_url').in('id', ids);
      artMap = new Map((arts || []).map(a => [a.id, a]));
    }
    const recent_posts = posts.map(p => {
      const a = artMap.get(p.article_id) || null;
      return {
        article_id: p.article_id,
        article_title: a ? a.title : null,
        article_url: a ? ('/article/' + (a.custom_url || a.slug || a.id)) : null,
        thread_id: p.thread_id,
        thread_url: p.thread_id ? ('https://www.threads.net/t/' + p.thread_id) : null,
        status: p.status,
        detail: p.detail,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });

    // 후보: 최근 3일 published 아티클 중 아직 성공 게시 안 된 것
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: fresh } = await supabaseAdmin.from('articles')
      .select('id, title, slug, custom_url, published_date')
      .eq('status', 'published')
      .gte('published_date', cutoff)
      .order('published_date', { ascending: false })
      .limit(50);
    const postedIds = new Set(posts.filter(p => p.status !== 'failed').map(p => p.article_id).filter(Boolean));
    const candidates = (fresh || []).map(a => ({
      id: a.id,
      title: a.title,
      published_date: a.published_date,
      posted: postedIds.has(a.id),
      article_url: '/article/' + (a.custom_url || a.slug || a.id),
    }));

    const dayAgo = Date.now() - 86400000;
    const last24 = posts.filter(p => p.created_at && new Date(p.created_at).getTime() > dayAgo);
    const summary = {
      last24h_success: last24.filter(p => p.status === 'submitted').length,
      last24h_failed:  last24.filter(p => p.status === 'failed').length,
      pending_candidates: candidates.filter(c => !c.posted).length,
      total_posts: posts.length,
    };

    // 진단 메시지
    const diagnosis = [];
    if (!env.has_app_id || !env.has_app_secret){
      diagnosis.push({ level: 'error', msg: 'THREADS_APP_ID / THREADS_APP_SECRET 미설정. Meta Developer 앱에서 발급 후 Vercel 환경변수 추가 필요.' });
    }
    if (!oauth.authorized){
      diagnosis.push({ level: 'error', msg: 'Threads OAuth 미인증. Meta 앱에 @pap_magazine을 Threads Tester로 추가한 뒤 /api/threads/oauth 를 방문해 승인 필요.' });
    }
    if (oauth.authorized && typeof oauth.expires_in_days === 'number' && oauth.expires_in_days < 7){
      diagnosis.push({ level: 'warn', msg: '토큰 만료 임박 (' + oauth.expires_in_days + '일 남음). 자동 갱신 로직이 갱신 못하면 재인증 필요.' });
    }
    if (!env.has_cron_secret){
      diagnosis.push({ level: 'warn', msg: 'CRON_SECRET 미설정 — Vercel 크론이 인증되지 않아 실행 안 될 수 있음.' });
    }
    if (oauth.authorized && summary.last24h_success === 0 && summary.pending_candidates === 0){
      diagnosis.push({ level: 'info', msg: '최근 3일 내 신규 published 아티클이 없어 게시할 소스가 없음.' });
    }
    if (oauth.authorized && summary.last24h_success === 0 && summary.pending_candidates > 0){
      diagnosis.push({ level: 'warn', msg: summary.pending_candidates + '건의 후보가 있는데 최근 24시간 게시 없음. Vercel Cron Logs 확인 필요.' });
    }
    if (summary.last24h_failed > 0){
      diagnosis.push({ level: 'error', msg: '최근 24시간 실패 ' + summary.last24h_failed + '건. 아래 목록의 detail 확인.' });
    }
    if (oauth.authorized && summary.last24h_success > 0){
      diagnosis.push({ level: 'ok', msg: '자동 게시 정상 동작 중. 최근 24시간 성공 ' + summary.last24h_success + '건.' });
    }

    return res.status(200).json({
      schedule: '45 */3 * * * (UTC) → KST 3시간마다 :45',
      env,
      oauth,
      summary,
      diagnosis,
      recent_posts,
      candidates,
    });
  } catch (e) {
    console.error('[threads-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
