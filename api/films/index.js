/**
 * PAP Magazine - Films API
 * GET  /api/films         → 필름 목록 조회 (공개)
 * POST /api/films         → 필름 등록 (관리자)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { recordContentChange, attachAuthorship } = require('../_lib/audit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // GET: 필름 목록 (공개)
  if (req.method === 'GET') {
    try {
      const { status, category, page = 1, limit: rawLimit = 50 } = req.query;
      const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 100);
      const offset = (parseInt(page) - 1) * limit;

      // QA #162 + #164 — joins editorials!related_editorial_id and hides
      // future-scheduled rows from the public ("published") view, mirroring
      // the editorials GET behaviour so admin tools (status=draft/scheduled)
      // bypass the schedule gate while consumers never see queued rows.
      const requestedStatus = status || 'published';
      // QA #220 — edge cache for anonymous public list (60s + SWR 5min).
      {
        const { setListCacheHeader } = require('../_lib/cdnCache');
        setListCacheHeader(req, res, { isPublic: requestedStatus === 'published' });
      }
      // QA #186 — explicit list-view projection (drops `description` so
      // the homepage card list isn't shipping payloads it doesn't render).
      //
      // QA #230 — re-include `credits` + `related_editorial_id`. They
      // were originally trimmed for list-payload size, but the admin
      // film-edit modal hydrates from the SAME list cache (no per-row
      // re-fetch on Edit click), so leaving them out meant clicking
      // "편집" landed the editor on a form with no credits and no
      // linked-editorial selection — looked like the saved data had
      // been wiped. Matches the fix already applied to editorials
      // (QA #191) and articles (QA #221). Films are a small table
      // (~hundreds of rows), so the extra bytes are negligible.
      const LIST_COLUMNS = [
        'id','title','slug','youtube_id','thumbnail_url','published_date',
        'categories','tags','status','scheduled_publish_at',
        // QA #202 — authorship columns for admin list rendering.
        'created_at','created_by','updated_by',
        // QA #230 — needed by admin edit-modal hydrate (see note above).
        'credits','related_editorial_id',
        // QA #250 — Instagram caption (mirrors editorials column). Also
        // hydrates the admin edit modal directly from the list cache so
        // editors can re-edit without a per-row refetch.
        'instagram_caption',
        // QA #251 — KR/EN/IT description slots. Same admin edit-modal
        // hydration concern as above — ship the three TEXT columns in
        // the list payload so opening "편집" doesn't need a per-row GET.
        'description','description_en','description_it'
      ].join(',');
      // QA #248 — `?status=scheduled` semantics.
      //
      // Films are saved with `status='published'` + a future
      // `scheduled_publish_at` (see saveFilm in pap-admin.js — mirrors
      // the editorial flow per QA #127/#164). There is no literal
      // 'scheduled' value in the films.status column, so the previous
      // `.eq('status', requestedStatus)` clause turned a scheduled
      // query into `WHERE status='scheduled'`, which always returned
      // []. As a result the admin "예약 필름" stat card stayed at 0
      // and queued films were invisible until the cron actually
      // released them.
      //
      // Pattern matches editorials/index.js (QA #196): translate the
      // `scheduled` filter into `status='published' AND scheduled
      // publish date > now()`, sorted by publish date ascending so the
      // soonest-to-go-live sits at the top.
      const isScheduledFilter = requestedStatus === 'scheduled';
      let query = supabaseAdmin
        .from('films')
        .select(LIST_COLUMNS + ', related_editorial:editorials!related_editorial_id(id,slug,title,cover_image,thumbnail,published_date)', { count: 'exact' });

      if (isScheduledFilter) {
        query = query.eq('status', 'published')
                     .gt('scheduled_publish_at', new Date().toISOString())
                     .order('scheduled_publish_at', { ascending: true });
      } else {
        query = query.eq('status', requestedStatus)
                     .order('published_date', { ascending: false });
        // Schedule gate (QA #164) — hide future-queued rows from the
        // public 'published' view. isScheduledFilter already restricts
        // to FUTURE rows above so we skip the gate there.
        if (requestedStatus === 'published') {
          query = query.or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${new Date().toISOString()}`);
        }
      }

      query = query.range(offset, offset + parseInt(limit) - 1);

      if (category) {
        query = query.ilike('categories', `%${category}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      // QA #202 — denormalise authorship for admin list views.
      if (Array.isArray(data)) await attachAuthorship(data);

      // QA #186 — edge cache the published list.
      if (requestedStatus === 'published') {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      } else {
        res.setHeader('Cache-Control', 'private, no-store');
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
      console.error('Films GET error:', err);
      return res.status(500).json({ error: 'Failed to fetch films' });
    }
  }

  // POST: 필름 등록 (관리자)
  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;

    try {
      const {
        title, youtube_id, thumbnail_url, published_date,
        categories, tags, credits, slug, status,
        related_editorial_id,
        scheduled_publish_at,
        // QA #250 — film Instagram caption (mirrors editorials.instagram_caption
        // from QA #170). Optional, plain TEXT; admin modal drafts + persists it.
        instagram_caption,
        // QA #251 — trilingual description slots (KR / EN / IT). All optional;
        // the admin modal exposes one textarea per language with a 🤖 AI
        // 자동 번역 button that fills the missing slots from whichever
        // language the editor wrote first.
        description, description_en, description_it,
      } = req.body;

      if (!title || !youtube_id) {
        return res.status(400).json({ error: 'title and youtube_id are required' });
      }

      // categories / tags expected as TEXT[] (films schema). Coerce string-shape
      // bodies (legacy admin payloads) into arrays so the column accepts them.
      const toArray = v =>
        Array.isArray(v) ? v
        : (v == null || v === '' ? [] : [String(v)]);

      const insertRow = {
        title,
        youtube_id,
        thumbnail_url: thumbnail_url || null,
        published_date: published_date || null,
        categories: toArray(categories).length ? toArray(categories) : ['Film'],
        tags:       toArray(tags).length       ? toArray(tags)       : [title],
        credits: Array.isArray(credits) ? credits : [],
        status: status || 'published',
        // QA #164 — explicit null when unset so the column is clean rather
        // than absent (matters for the GET schedule gate to short-circuit
        // on IS NULL instead of evaluating a missing column).
        scheduled_publish_at: scheduled_publish_at || null,
        // QA #202 — authorship.
        created_by: user.id,
        updated_by: user.id,
      };
      if (slug)                  insertRow.slug = slug;
      if (related_editorial_id)  insertRow.related_editorial_id = related_editorial_id;
      // QA #250 — accept null/empty as "clear the caption", not "leave
      // unchanged" (POST always sets a fresh row, so trim + null is
      // the correct shape).
      if (typeof instagram_caption !== 'undefined') {
        const trimmed = String(instagram_caption || '').trim();
        insertRow.instagram_caption = trimmed ? trimmed : null;
      }
      // QA #251 — trilingual description; trim + null on empty, same
      // semantics as instagram_caption above.
      const _trimOrNull = v => {
        if (typeof v === 'undefined') return undefined;
        const t = String(v || '').trim();
        return t ? t : null;
      };
      if (typeof description    !== 'undefined') insertRow.description    = _trimOrNull(description);
      if (typeof description_en !== 'undefined') insertRow.description_en = _trimOrNull(description_en);
      if (typeof description_it !== 'undefined') insertRow.description_it = _trimOrNull(description_it);

      const { data, error } = await supabaseAdmin
        .from('films')
        .insert(insertRow)
        .select()
        .single();

      if (error) throw error;

      // QA #202 — audit ledger.
      await recordContentChange({
        content_type: 'film',
        content_id: data.id,
        action: 'create',
        actor: user,
        summary: `필름 등록: ${data.title}`,
      });

      return res.status(201).json({ data });
    } catch (err) {
      console.error('Films POST error:', err);
      return res.status(500).json({ error: 'Failed to create film' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
