/**
 * PAP Magazine - Editorials API
 * GET  /api/editorials      → 에디토리얼 목록 조회 (공개)
 * POST /api/editorials      → 에디토리얼 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { embedAndStoreEditorial } = require('../_lib/embeddings');
const { recordContentChange, attachAuthorship } = require('../_lib/audit');
const { normalizeCreditsArray } = require('../_lib/credits');  // QA #301
const { sanitizeInstaLogoSettings } = require('../_lib/instaLogoSettings');  // 2026-07-28

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 에디토리얼 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, page = 1, limit: rawLimit = 25 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 25), 100);
      const offset = (parseInt(page) - 1) * limit;
      const requestedStatus = status || 'published';

      // QA #196 — 'scheduled' is a VIRTUAL status (no DB column change).
      // Translates to: rows with status='published' AND scheduled_publish_at
      // in the future. Previously these vanished from every admin tab
      // because the public list hides them via the .or() gate below and
      // the admin tabs were keyed on the raw DB status. Now admin can
      // pass status=scheduled to see only the queued rows + filter +
      // edit them before they go live.
      const isScheduledFilter = requestedStatus === 'scheduled';

      // Drafts (and any non-published view) are admin-only — submissions
      // are staged here before the editor publishes them, so leaking them
      // would expose work-in-progress.
      if (requestedStatus !== 'published') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
      }

      // QA #220 — edge cache for the anonymous public list. Same shape
      // as articles/films/shorts: 60s edge + 5min SWR for unauth GETs
      // on the published view, no-store otherwise so authenticated
      // editors never see a stale list after a save.
      {
        const { setListCacheHeader } = require('../_lib/cdnCache');
        setListCacheHeader(req, res, { isPublic: requestedStatus === 'published' });
      }

      // QA #186 — explicit column list (was '*'). The wildcard select
      // returned EVERY column including the 1536-dim `embedding` vector
      // (~10 KB/row), `description` / `description_en` / `instagram_caption`
      // (long text), and `gallery`/`credits`/`fashion` (heavy JSONB).
      // For a card-list view none of those are needed — index.html only
      // renders title + cover + tags + slug. Trimming the projection cut
      // the response from ~400 KB → ~30 KB in production testing, which
      // also lets Vercel edge cache it tightly.
      //
      // QA #163 — reverse-fan the films pointing at each editorial via
      // films.related_editorial_id so the SPA overlay can render a
      // "Related Films" card without a per-row second fetch.
      // QA #191 — re-include credits / fashion / description / description_en
      // / gallery / instagram_caption. The SPA's openEditorial reads from
      // this list cache (no per-row detail fetch) and renders the full
      // overlay (credits roles, fashion brands, look-by-look gallery),
      // so omitting those columns produced empty placeholders
      // ("PHOTOGRAPHY photographer" instead of "Photographer Pedro Braga").
      // We KEEP `embedding` excluded — it's the 1536-float pgvector that
      // dwarfed the original ~400KB response. Including credits/fashion/
      // description JSONB adds maybe ~5KB per row but restores full SPA
      // fidelity. Net response is still ~50-80KB for the homepage list,
      // well within the edge-cache budget.
      const LIST_COLUMNS = [
        'id','title','slug','cover_image','thumbnail','published_date',
        'url','tags','issue','status','scheduled_publish_at','title_en',
        'description','description_en','description_it','gallery','credits','fashion',
        'instagram_caption','og_image','seo_title','seo_description',
        'updated_at','source_submission_id',
        // 2026-07-28 — 인스타 합성 로고/프레이밍 설정 (관리자가 조정한 값).
        // 관리자 편집 폼이 리스트 캐시에서 하이드레이트할 때 필요하다.
        'insta_logo_settings',
        // QA #202 — surface authorship in the admin list so editors
        // see "who created / last edited" without a per-row lookup.
        'created_at','created_by','updated_by','admin_edited_at'
      ].join(',');

      // 성능 최적화 (2026-07) — 공개 홈 싱크(?public=1)용 슬림 컬럼.
      // apiEditorialToLocal 이 실제로 읽는 필드만 남긴다. instagram_caption
      // (트라이링구얼 블롭)·seo_*·감사 필드는 SPA 목록 소비자가 전혀 읽지
      // 않는 순수 페이로드 낭비였다 (12건 응답 510KB의 주범 중 하나).
      // gallery/credits/fashion/description(ko·en) 은 openEditorial 이
      // 목록 캐시에서 즉시 렌더하는 데 쓰므로 유지 (QA #191 회귀 방지).
      // 어드민 목록은 public 파라미터를 안 보내므로 영향 없음.
      const PUBLIC_LIST_COLUMNS = [
        'id','title','slug','cover_image','thumbnail','published_date',
        'url','tags','issue','status','title_en',
        'description','description_en','gallery','credits','fashion',
        'source_instagram_url',
        // 2026-07-28 — 회원 다운로드(_papDownloadLogoZip)가 관리자와 동일한
        // 로고/프레이밍으로 합성하려면 공개 목록에도 실려야 한다. 값이 없으면
        // NULL 이므로 페이로드 영향은 사실상 0.
        'insta_logo_settings',
        'created_at','updated_at'
      ].join(',');

      /* 관리자 목록(?fields=admin)용 슬림 컬럼 — QA(2026-07) 페이지네이션 건.
         관리자 게시글 목록은 2,448행을 전부 순회해야 하는데, LIST_COLUMNS 는
         gallery·credits·fashion·instagram_caption·description×3·seo_* 같은
         큰 JSON 블롭까지 실어 행당 6.7KB(100행 = 668KB, 3.8초)였다.
         전량을 받으면 16MB·95초가 되어 목록 관리가 불가능하다.

         여기 남긴 필드는 관리자 테이블 렌더러·검색·정렬·기간필터·일괄작업이
         "실제로 읽는" 것만 전수 조사해 추린 것이다. 큰 필드가 필요한 편집
         폼은 이미 단건 재조회를 한다(editEditorial, QA #216) — 그 주석도
         "목록 응답은 큰 필드를 뺀다"를 전제로 쓰여 있다.
         related_films 조인도 목록에선 쓰이지 않아 제외한다. */
      const ADMIN_LIST_COLUMNS = [
        'id','title','slug','cover_image','thumbnail','published_date',
        'scheduled_publish_at','status','tags','issue','view_count',
        'created_at','created_by','updated_at','updated_by',
        'admin_edited_at','source_submission_id'
      ].join(',');

      const isPublicSlim = req.query.public === '1';
      const isAdminList = req.query.fields === 'admin';
      const cols = isAdminList ? ADMIN_LIST_COLUMNS
                 : isPublicSlim ? PUBLIC_LIST_COLUMNS
                 : LIST_COLUMNS;
      let query = supabaseAdmin
        .from('editorials')
        .select(isAdminList
          ? cols
          : cols + ', related_films:films!related_editorial_id(id,slug,title,thumbnail_url,youtube_id,published_date,status)',
          { count: 'exact' });

      if (isScheduledFilter) {
        // QA #196 — scheduled = status='published' + future scheduled
        // publish date. Sorted by the PUBLISH date (soonest first) so
        // the admin sees what's about to go live at the top.
        query = query.eq('status', 'published')
                     .gt('scheduled_publish_at', new Date().toISOString())
                     .order('scheduled_publish_at', { ascending: true });
      } else if (requestedStatus === 'draft') {
        // QA #197 — split the 임시저장 (Drafts) tab into "actually edited
        // by an admin" vs "auto-staged at submission approval, untouched".
        // The latter no longer pollute the Drafts tab — they remain
        // accessible via 서브미션 심사 → '에디토리얼 편집' until the admin
        // saves a change (which stamps admin_edited_at). Two-arm OR:
        //   1. source_submission_id IS NULL  (admin-authored draft)
        //   2. admin_edited_at IS NOT NULL    (admin has touched it)
        query = query.eq('status', 'draft')
                     .or('source_submission_id.is.null,admin_edited_at.not.is.null')
                     .order('published_date', { ascending: false });
      } else {
        query = query.eq('status', requestedStatus)
                     .order('published_date', { ascending: false });
      }

      /* 2026-07-21 — published_date 기간 필터(from/to).
         QA("매거진 발행호 상세 구조 이원화") 대응. 발행호 상세는 분기
         단위라 그 분기의 에디토리얼만 있으면 되는데, 기간 필터가 없어서
         VOL.30+ 는 "전체 500건을 받아 클라이언트에서 거르는" 방식이었고
         VOL.1~29 는 아예 에디토리얼을 못 불러와 다른 화면을 쓰고 있었다.
         분기 범위를 서버에서 자르면 13~125건만 받아 두 경로가 같은
         템플릿을 쓸 수 있다. YYYY-MM-DD 형식만 허용한다. */
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (DATE_RE.test(String(req.query.from || ''))) {
        query = query.gte('published_date', req.query.from);
      }
      if (DATE_RE.test(String(req.query.to || ''))) {
        query = query.lte('published_date', req.query.to);
      }

      query = query.range(offset, offset + parseInt(limit) - 1);

      // For the public-facing 'published' view, hide editorials whose
      // scheduled_publish_at is still in the future. The OR clause
      // keeps backward-compat with rows that don't have
      // scheduled_publish_at set. (isScheduledFilter is already
      // filtering to FUTURE rows above, so we skip the gate.)
      if (requestedStatus === 'published' && !isScheduledFilter) {
        query = query.or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${new Date().toISOString()}`);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      // QA #186 — Cache the published list at Vercel's edge. Editorials
      // only change a few times per day; serving stale-while-revalidate
      // means the 2nd+ visitor in a 10-minute window gets an instant
      // response while the cache silently re-fetches in the background.
      // Drafts/scheduled stay no-cache because they're admin-only and
      // change far more frequently.
      if (requestedStatus === 'published') {
        // QA #294 — Disk IO 경고 대응. s-maxage 60→300 (5분), SWR 600→3600 (1시간).
        // Edge에서 캐시된 응답 5분간 재사용 → DB 호출 약 1/5로 감소.
        // 새 에디토리얼은 5분 후 반영.
        res.setHeader(
          'Cache-Control',
          'public, s-maxage=300, stale-while-revalidate=3600'
        );
      } else {
        res.setHeader('Cache-Control', 'private, no-store');
      }

      // Strip non-published films from the embedded array (service-role
      // bypasses RLS) and sort newest-first. Done in JS instead of an
      // .eq() on the joined table because PostgREST's join filter
      // doesn't take an .eq() through the alias syntax we use here.
      if (Array.isArray(data)) {
        for (const row of data) {
          if (Array.isArray(row.related_films)) {
            row.related_films = row.related_films
              .filter(f => f && f.status === 'published')
              .sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')));
          }
        }
        // QA #202 — batch-resolve created_by / updated_by into
        // _creator / _editor objects (one extra query, not N).
        await attachAuthorship(data);
      }

      return res.status(200).json({
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / parseInt(limit))
        }
      });
    } catch (err) {
      console.error('Editorials GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch editorials' });
    }
  }

  // POST: 에디토리얼 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const {
        title, slug, cover_image, published_date, url, tags, issue,
        thumbnail, gallery, credits, fashion, status, description,
        scheduled_publish_at, seo_title, seo_description, og_image,
        title_en, description_en,
        description_it,  // QA #204 — IT translation slot
        instagram_caption,  // QA #170 — editor-tunable IG caption
        source_instagram_url,  // 참여 증폭 2.0 — 원본 IG 게시물 링크
        insta_logo_settings,   // 2026-07-28 — 인스타 합성 로고/프레이밍 설정
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'title is required' });
      }

      const { data, error } = await supabaseAdmin
        .from('editorials')
        .insert({
          title,
          slug: slug || null,
          cover_image: cover_image || null,
          published_date: published_date || null,
          url: url || null,
          tags: tags || [],
          issue: issue || null,
          thumbnail: thumbnail || null,
          gallery: gallery || [],
          // QA #301 — credits 가 array 형태일 때 각 row 의 instagram 에
          // @ 자동 보강 + name/instagram/website 스왑 정정. object 형태이면
          // 그대로 통과 (헬퍼가 array 아닐 때 input 반환).
          credits: normalizeCreditsArray(credits) || credits || {},
          fashion: fashion || {},
          status: status || 'published',
          description: description || null,
          // Phase 4 fields — null when not provided keeps the column clean
          scheduled_publish_at: scheduled_publish_at || null,
          seo_title: seo_title || null,
          seo_description: seo_description || null,
          og_image: og_image || null,
          title_en: title_en || null,
          description_en: description_en || null,
          description_it: description_it || null,
          // QA #170 — Instagram caption (auto-filled at submission approval;
          // direct-admin-create starts NULL so the textarea shows the
          // "generate" button instead of stale content).
          instagram_caption: instagram_caption || null,
          // 참여 증폭 2.0 — 원본 IG 게시물 permalink (SSR/SPA 깔때기 착지점)
          source_instagram_url: source_instagram_url || null,
          // 2026-07-28 — 인스타 합성 설정. 클라이언트 JSON 이므로 반드시
          // 위생 검증을 거친다(범위 클램프 · 화이트리스트 · URL 스킴).
          // 유효한 값이 없으면 헬퍼가 null 을 돌려주므로 컬럼은 비어 있고
          // 회원 다운로드는 종전 기본값(15%/1%/85%)으로 합성된다.
          insta_logo_settings: sanitizeInstaLogoSettings(insta_logo_settings),
          // QA #202 — authorship stamps. Both columns get the same id
          // on POST because the creator IS the most recent editor for a
          // brand-new row; subsequent PUTs will bump updated_by.
          created_by: user.id,
          updated_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger entry (fire-and-forget; failures don't
      // block the save).
      await recordContentChange({
        content_type: 'editorial',
        content_id: data.id,
        action: 'create',
        actor: user,
        summary: `에디토리얼 등록: ${data.title}`,
      });

      // Best-effort semantic embedding. Done AFTER the insert succeeds so
      // the editorial is durably saved even if OpenAI is unreachable;
      // backfill endpoint can pick up rows where embedding stayed null.
      // Awaited so the home themes row reflects the new editorial on the
      // very next page load — admin save UX is already a few hundred ms,
      // an extra ~500ms is fine.
      try {
        await embedAndStoreEditorial(data);
      } catch (embedErr) {
        console.warn('[editorials POST] embed best-effort failed', embedErr && embedErr.message);
      }

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Editorials POST error:', err);
      return res.status(500).json({ error: 'Failed to create editorial' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
