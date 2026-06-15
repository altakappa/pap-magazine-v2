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
        // QA #202 — surface authorship in the admin list so editors
        // see "who created / last edited" without a per-row lookup.
        'created_at','created_by','updated_by','admin_edited_at'
      ].join(',');
      let query = supabaseAdmin
        .from('editorials')
        .select(LIST_COLUMNS + ', related_films:films!related_editorial_id(id,slug,title,thumbnail_url,youtube_id,published_date,status)', { count: 'exact' });

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
        res.setHeader(
          'Cache-Control',
          'public, s-maxage=60, stale-while-revalidate=600'
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
          credits: credits || {},
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
