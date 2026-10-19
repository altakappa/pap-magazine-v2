/**
 * GET/POST /api/admin/instagram-diagnose — 인스타 자동 수집 진단·강제 임포트 (관리자 전용).
 *
 * QA #347. sync-instagram이 최근 게시물을 스킵한 이유를 관리자에게 명확히
 * 보여주고, 필요 시 필터를 우회해 강제로 아티클로 저장할 수 있게 한다.
 *
 * 사용법:
 *   GET  ?scan=1&days=14         — 최근 14일 게시물 목록 + 상태(imported/skipped/reason)
 *   GET  ?token=1                — 토큰 scopes·만료 (debug_token). 게시 권한(instagram_content_publish) 유무 확인용
 *   POST { instagramUrl, forceArticle: true }
 *        — 필터 우회하고 아티클로 강제 저장.
 *          isLikelyEditorialCaption / AI Editorial 분류를 모두 건너뜀.
 *
 * 스캔 결과 status:
 *   imported            — DB 에 이미 존재 (articles.source_instagram_post_id)
 *   editorial(db)       — editorials.source_instagram_url shortcode 매치 (정상 스킵)
 *   editorial(caption)  — 캡션 휴리스틱이 편집 크레딧으로 판정 (오탐 의심)
 *   pending             — 아직 미수집. 다음 크론(2시간마다)에 수집 예상
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const {
  listMediaPaged,
  listRecentMedia,
  fetchInstagramPost,
  generateArticleFromPost,
  buildArticleRow,
  archiveImagesToStorage,
  archiveVideosToStorage,
  isLikelyEditorialCaption,
  _extractShortcode,
} = require('../_lib/instagramImport');

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    return res.status(503).json({ error: 'IG_ACCESS_TOKEN / IG_USER_ID 환경변수 미설정.' });
  }

  try {
    /* ===== TOKEN 모드 (GET ?token=1) — 2026-10-19 신설 =====
       셀럽 브리프 게시가 "Graph GET 0 (400) Unsupported get request [code 100/33]" 로 죽었다.
       코드 힌트는 "토큰에 instagram_content_publish 없음" 인데 추측이었다. 토큰이 Vercel env 에만
       있어 사람이 확인할 길이 없었다. debug_token 은 자기 토큰으로 자기 토큰을 조회할 수 있다.
       응답에는 scopes·만료·유형만 싣고 토큰 값은 절대 싣지 않는다. */
    if (req.method === 'GET' && (req.query || {}).token === '1'){
      const tok = String(process.env.IG_ACCESS_TOKEN || '').trim();
      const qs = new URLSearchParams({ input_token: tok, access_token: tok });
      const r = await fetch('https://graph.facebook.com/v25.0/debug_token?' + qs, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      const d = (j && j.data) || {};
      if (!r.ok || j.error || !j.data){
        return res.status(502).json({ ok: false, error: 'debug_token 실패: ' + ((j.error && j.error.message) || ('HTTP ' + r.status)).slice(0, 200) });
      }
      const scopes = Array.isArray(d.scopes) ? d.scopes : [];
      const need = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'];
      return res.status(200).json({
        ok: true,
        type: d.type || null, app_id: d.app_id || null, is_valid: d.is_valid !== false,
        expires_at: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : (d.expires_at === 0 ? 'never' : null),
        data_access_expires_at: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : null,
        scopes,
        missing_for_publish: need.filter((p) => !scopes.includes(p)),
        can_publish: scopes.includes('instagram_content_publish'),
        granular: Array.isArray(d.granular_scopes) ? d.granular_scopes.map((g) => g.scope) : undefined,
      });
    }

    /* ===== CONTAINER 프로브 (GET ?container=1) — 2026-10-20 신설 =====
       게시가 "Graph GET 0" 으로 죽는데 토큰 scopes 는 멀쩡했다(?token=1). 컨테이너 생성 POST 가
       id 를 "0" 으로 돌려주는 것으로 보이나 원문 응답을 본 적이 없다. 공개 이미지 하나로 사진
       컨테이너만 만들어 보고(게시 안 함, 컨테이너는 24시간 뒤 소멸) 원문 응답을 그대로 돌려준다.
       이어서 그 id 로 status_code 를 한 번 읽는다. 토큰은 응답에 싣지 않는다. */
    if (req.method === 'GET' && (req.query || {}).container === '1'){
      const tok = String(process.env.IG_ACCESS_TOKEN || '').trim();
      const uid = String(process.env.IG_USER_ID || '').trim();
      const image = String(req.query.image || 'https://www.pap-magazine.com/pap-logo.png');
      const me = await fetch('https://graph.facebook.com/v25.0/' + uid + '?' + new URLSearchParams({ fields: 'id,username,media_count', access_token: tok }), { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));
      const body = new URLSearchParams({ image_url: image, caption: 'diagnose probe (not published)', access_token: tok });
      const r = await fetch('https://graph.facebook.com/v25.0/' + uid + '/media', { method: 'POST', body, signal: AbortSignal.timeout(30000) });
      const raw = await r.text();
      let j = {}; try { j = JSON.parse(raw); } catch (_e) { j = { unparsed: raw.slice(0, 300) }; }
      let statusProbe = null;
      if (j && j.id) {
        statusProbe = await fetch('https://graph.facebook.com/v25.0/' + j.id + '?' + new URLSearchParams({ fields: 'status_code,status', access_token: tok }), { signal: AbortSignal.timeout(15000) }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
      }
      return res.status(200).json({ ok: true, ig_user_id: uid, account: me, container_http: r.status, container_response: j, status_probe: statusProbe });
    }

    // ===== SCAN 모드 (GET) — 진단만 =====
    if (req.method === 'GET' && (req.query || {}).scan === '1'){
      const days = Math.max(1, Math.min(60, parseInt(req.query.days || '14', 10) || 14));
      const media = await listMediaPaged({ sinceDays: days, maxCount: 100 });
      if (!media.length) return res.status(200).json({ days, posts: [] });

      // articles + editorials 매핑 준비 (배치 조회)
      const allIds = media.map(m => m.id).filter(Boolean);
      const [{ data: arts }, { data: eds }] = await Promise.all([
        supabaseAdmin.from('articles')
          .select('id, source_instagram_post_id, title, slug, custom_url, status')
          .in('source_instagram_post_id', allIds),
        supabaseAdmin.from('editorials')
          .select('source_instagram_url').not('source_instagram_url', 'is', null),
      ]);
      const importedMap = new Map((arts || []).map(a => [a.source_instagram_post_id, a]));
      const editorialShortcodes = new Set(
        (eds || []).map(e => _extractShortcode(e.source_instagram_url)).filter(Boolean)
      );

      const posts = media.map(m => {
        const shortcode = _extractShortcode(m.permalink);
        const existing = importedMap.get(m.id);
        let status = 'pending';
        let reason = null;
        if (existing){
          status = 'imported';
          reason = 'articles.id ' + existing.id + ' (' + existing.status + ')';
        } else if (shortcode && editorialShortcodes.has(shortcode)){
          status = 'editorial(db)';
          reason = 'editorials.source_instagram_url 매치 — 정상 스킵';
        } else if (isLikelyEditorialCaption(m.caption)){
          status = 'editorial(caption)';
          reason = '캡션 휴리스틱 판정. 뉴스인데 잘못 걸렸다면 강제 임포트 사용.';
        }
        return {
          id: m.id,
          shortcode,
          permalink: m.permalink,
          timestamp: m.timestamp,
          caption_head: String(m.caption || '').slice(0, 120),
          media_type: m.media_type,
          status,
          reason,
          article_slug: existing ? (existing.custom_url || existing.slug || null) : null,
          article_title: existing ? existing.title : null,
        };
      });
      return res.status(200).json({ days, count: posts.length, posts });
    }

    // ===== FORCE IMPORT (POST) =====
    if (req.method === 'POST'){
      const body = req.body || {};
      const url = String(body.instagramUrl || '').trim();
      const forceArticle = body.forceArticle === true;
      if (!url) return res.status(400).json({ error: 'instagramUrl 필요.' });
      if (!/instagram\.com\/(?:p|reel|tv)\//.test(url) && !_extractShortcode(url)){
        return res.status(400).json({ error: '유효한 Instagram URL이 아닙니다.' });
      }

      const post = await fetchInstagramPost(url);
      if (!post || !post.id) return res.status(404).json({ error: '게시물을 찾지 못함.' });

      // 중복 체크 — 이미 있으면 그 row 반환.
      const { data: existing } = await supabaseAdmin
        .from('articles').select('*')
        .eq('source_instagram_post_id', post.id).maybeSingle();
      if (existing){
        return res.status(200).json({ article: existing, duplicate: true });
      }

      const generated = await generateArticleFromPost(post);
      // 강제 모드: AI 가 'Editorial' 로 분류해도 'News' 로 다운그레이드.
      if (forceArticle && String(generated.category || '').toLowerCase() === 'editorial'){
        generated.category = 'News';
        generated._forced_from_editorial = true;
      }
      const archivedUrls = await archiveImagesToStorage(post, 10);
      const videoUrls = await archiveVideosToStorage(post, 2);
      const row = buildArticleRow(post, generated, {
        // sync-instagram cron 과 동일한 정책: 강제 임포트도 즉시 발행.
        // (이전 'draft' 기본값은 게시물이 published 리스트/네이버 블로그 초안에 안 뜨는 문제 야기.)
        // 명시적으로 draft로 저장하려면 body.status='draft' 로 넘길 것.
        status: body.status || 'published',
        archivedUrls, videoUrls,
      });
      row.created_by = user.id;

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('articles').insert(row).select().single();
      if (insErr){
        if (insErr.code === '23505'){
          return res.status(409).json({ error: '이미 임포트된 게시물입니다.', code: 'duplicate' });
        }
        console.error('[instagram-diagnose] insert failed:', insErr);
        return res.status(500).json({ error: 'DB insert 실패: ' + insErr.message });
      }
      return res.status(201).json({
        article: inserted,
        duplicate: false,
        forced_from_editorial: !!generated._forced_from_editorial,
      });
    }

    return res.status(405).json({ error: 'Method not allowed. GET ?scan=1 또는 POST forceArticle.' });
  } catch (e){
    console.error('[instagram-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
