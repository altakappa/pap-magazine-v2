/**
 * GET /api/admin/tiktok-diagnose — TikTok 자동 게시 현황 진단 (관리자 전용).
 *
 * QA #352. tiktok-post 크론 상태를 한 화면에서 확인.
 * 에디토리얼 슬라이드 + 아티클 슬라이드 두 크론이 모두 이 진단으로 커버.
 *
 * 응답 JSON:
 *   {
 *     schedule: 'editorial 매일 11:00 KST / article 2시간마다 :30 KST',
 *     env: { has_client_key, has_client_secret, public_gate, has_cron_secret },
 *     oauth: { authorized, open_id, access_token_expires_at, refresh_token_expires_at, ... },
 *     summary: { last24h_success, last24h_failed, pending_editorials, pending_articles, total_posts },
 *     diagnosis: [ {level, msg} ... ],
 *     recent_posts: [ ...20 ],
 *     candidates: { editorials: [...5], articles: [...5] },
 *   }
 *
 * 소비자: frontend/tiktok-diagnose.html
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
      has_client_key:    !!process.env.TIKTOK_CLIENT_KEY,
      has_client_secret: !!process.env.TIKTOK_CLIENT_SECRET,
      public_gate:       process.env.TIKTOK_PUBLIC || null,
      has_cron_secret:   !!process.env.CRON_SECRET,
    };

    let oauth = { authorized: false, error: null };
    try {
      const { data: row, error } = await supabaseAdmin.from('tiktok_auth').select('*').eq('id', 1).maybeSingle();
      if (error) oauth.error = error.message;
      else if (!row) oauth.error = 'tiktok_auth 레코드 없음 — /api/tiktok/oauth 로 최초 인증 필요';
      else {
        oauth.authorized = !!row.access_token;
        oauth.open_id = row.open_id || null;
        oauth.has_access_token = !!row.access_token;
        oauth.has_refresh_token = !!row.refresh_token;
        oauth.access_expires_at = row.expires_at || null;
        oauth.refresh_expires_at = row.refresh_expires_at || null;
        if (row.expires_at) {
          const d = new Date(row.expires_at).getTime() - Date.now();
          oauth.access_expires_in_hours = Math.round(d / 3600000);
        }
        if (row.refresh_expires_at) {
          const d = new Date(row.refresh_expires_at).getTime() - Date.now();
          oauth.refresh_expires_in_days = Math.round(d / 86400000);
        }
        oauth.scope = row.scope || null;
        oauth.updated_at = row.updated_at || null;
      }
    } catch (e) { oauth.error = String(e && e.message || e).slice(0, 200); }

    // 최근 게시 기록
    const { data: postsRaw } = await supabaseAdmin.from('tiktok_posts')
      .select('editorial_id, article_id, publish_id, status, detail, created_at, updated_at')
      .order('created_at', { ascending: false }).limit(20);
    const posts = postsRaw || [];

    // 에디토리얼/아티클 제목 조인
    const edIds = posts.map(p => p.editorial_id).filter(Boolean);
    const artIds = posts.map(p => p.article_id).filter(Boolean);
    const [{ data: eds }, { data: arts }] = await Promise.all([
      edIds.length
        ? supabaseAdmin.from('editorials').select('id, title, slug').in('id', edIds)
        : Promise.resolve({ data: [] }),
      artIds.length
        ? supabaseAdmin.from('articles').select('id, title, slug, custom_url').in('id', artIds)
        : Promise.resolve({ data: [] }),
    ]);
    const edMap = new Map((eds || []).map(e => [e.id, e]));
    const artMap = new Map((arts || []).map(a => [a.id, a]));
    const recent_posts = posts.map(p => {
      const isEd = !!p.editorial_id;
      const item = isEd ? edMap.get(p.editorial_id) : artMap.get(p.article_id);
      return {
        kind: isEd ? 'editorial' : 'article',
        content_id: isEd ? p.editorial_id : p.article_id,
        title: item ? item.title : null,
        content_url: item
          ? (isEd
              ? '/editorial/' + (item.slug || item.id)
              : '/article/' + (item.custom_url || item.slug || item.id))
          : null,
        publish_id: p.publish_id,
        status: p.status,
        detail: p.detail,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });

    // 후보 콘텐츠 (에디토리얼: 최근 30일, 아티클: 최근 3일)
    const edCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const artCutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const [{ data: freshEds }, { data: freshArts }] = await Promise.all([
      supabaseAdmin.from('editorials')
        .select('id, title, slug, published_date, gallery')
        .eq('status', 'published')
        .gte('published_date', edCutoff)
        .order('published_date', { ascending: false }).limit(20),
      supabaseAdmin.from('articles')
        .select('id, title, slug, custom_url, published_date, gallery')
        .eq('status', 'published')
        .gte('published_date', artCutoff)
        .order('published_date', { ascending: false }).limit(20),
    ]);
    const postedEdIds  = new Set(posts.filter(p => p.status !== 'failed' && p.editorial_id).map(p => p.editorial_id));
    const postedArtIds = new Set(posts.filter(p => p.status !== 'failed' && p.article_id).map(p => p.article_id));
    const candidates = {
      editorials: (freshEds || [])
        .filter(e => Array.isArray(e.gallery) && e.gallery.length >= 2)
        .map(e => ({
          id: e.id, title: e.title,
          published_date: e.published_date,
          posted: postedEdIds.has(e.id),
          content_url: '/editorial/' + (e.slug || e.id),
          image_count: (e.gallery || []).length,
        })),
      articles: (freshArts || [])
        .filter(a => Array.isArray(a.gallery) && a.gallery.length >= 2)
        .map(a => ({
          id: a.id, title: a.title,
          published_date: a.published_date,
          posted: postedArtIds.has(a.id),
          content_url: '/article/' + (a.custom_url || a.slug || a.id),
          image_count: (a.gallery || []).length,
        })),
    };

    const dayAgo = Date.now() - 86400000;
    const last24 = posts.filter(p => p.created_at && new Date(p.created_at).getTime() > dayAgo);
    const summary = {
      last24h_success: last24.filter(p => p.status === 'submitted' || p.status === 'PUBLISH_COMPLETE').length,
      last24h_failed:  last24.filter(p => p.status === 'failed' || p.status === 'FAILED').length,
      pending_editorials: candidates.editorials.filter(c => !c.posted).length,
      pending_articles:   candidates.articles.filter(c => !c.posted).length,
      total_posts: posts.length,
    };

    // 진단 메시지
    const diagnosis = [];
    if (!env.has_client_key || !env.has_client_secret){
      diagnosis.push({ level: 'error', msg: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET 미설정. TikTok Developers 앱에서 발급 후 Vercel 추가 필요.' });
    }
    if (!oauth.authorized){
      diagnosis.push({ level: 'error', msg: 'TikTok OAuth 미인증. @pap_magazine 로그인 브라우저로 /api/tiktok/oauth 1회 방문해 승인.' });
    }
    if (env.public_gate !== '1'){
      diagnosis.push({ level: 'warn', msg: 'TIKTOK_PUBLIC 이 "1"이 아님 — 크론이 대기 모드. 앱 심사(audit) 승인 후 Vercel에 TIKTOK_PUBLIC=1 추가 필요 (미승인 앱은 공개 계정 게시 불가).' });
    }
    if (oauth.authorized && typeof oauth.refresh_expires_in_days === 'number' && oauth.refresh_expires_in_days < 7){
      diagnosis.push({ level: 'error', msg: 'Refresh token 만료 임박 (' + oauth.refresh_expires_in_days + '일 남음). 재인증 필요.' });
    }
    if (!env.has_cron_secret){
      diagnosis.push({ level: 'warn', msg: 'CRON_SECRET 미설정.' });
    }
    if (oauth.authorized && env.public_gate === '1' && summary.last24h_success === 0
        && (summary.pending_editorials + summary.pending_articles) === 0){
      diagnosis.push({ level: 'info', msg: '갤러리 2장 이상인 후보 콘텐츠가 없음.' });
    }
    if (oauth.authorized && env.public_gate === '1' && summary.last24h_success === 0
        && (summary.pending_editorials + summary.pending_articles) > 0){
      diagnosis.push({ level: 'warn', msg: '후보가 있는데 최근 24시간 게시 없음. Vercel Cron Logs 확인 필요.' });
    }
    if (summary.last24h_failed > 0){
      diagnosis.push({ level: 'error', msg: '최근 24시간 실패 ' + summary.last24h_failed + '건. detail 확인 (PROCESSING_DOWNLOAD 실패는 이미지 도메인 소유권 인증 문제 가능성).' });
    }
    if (oauth.authorized && env.public_gate === '1' && summary.last24h_success > 0){
      diagnosis.push({ level: 'ok', msg: '자동 게시 정상 동작 중. 최근 24시간 성공 ' + summary.last24h_success + '건.' });
    }

    return res.status(200).json({
      schedule: 'editorial: 매일 11:00 KST / article: 2시간마다 :30 KST',
      env,
      oauth,
      summary,
      diagnosis,
      recent_posts,
      candidates,
    });
  } catch (e) {
    console.error('[tiktok-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
