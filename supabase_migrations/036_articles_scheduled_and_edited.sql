-- QA #199 — bring articles (news) up to editorial parity.
--
-- Two new columns:
--
-- 1) scheduled_publish_at TIMESTAMPTZ
--    Same virtual-status pattern editorials use (QA #196):
--    status='published' + scheduled_publish_at in the future → hidden
--    from the public list, but surfaced under a synthetic 'scheduled'
--    filter on the admin side so the editor can see / edit / publish-now
--    queued posts.
--
-- 2) admin_edited_at TIMESTAMPTZ
--    Stamped by PUT /api/articles/:id on every save. Lets the Drafts
--    tab tell apart "admin-authored drafts" from "auto-staged
--    placeholders that nobody touched" — same split editorials got in
--    QA #197. Future-proof: even though articles don't currently
--    auto-create from submissions, we still want the timestamp for
--    "last edited" surfacing and audit.

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_edited_at      TIMESTAMPTZ;

-- Index the "in the future" subset only — cheap and covers the
-- common admin query (scheduled tab + cron promote-to-live).
CREATE INDEX IF NOT EXISTS idx_articles_scheduled_publish_at
  ON public.articles(scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_admin_edited_at
  ON public.articles(admin_edited_at)
  WHERE admin_edited_at IS NOT NULL;

COMMENT ON COLUMN public.articles.scheduled_publish_at IS
  'Future timestamp at which a published article actually becomes visible to the public. NULL → publishes immediately on status=published. Combined with status=published it gates the row off the public list while still letting admin surface it under a "scheduled" view.';

COMMENT ON COLUMN public.articles.admin_edited_at IS
  'Timestamp of the last explicit admin edit via PUT /api/articles/:id. Used to separate genuinely-edited drafts from any auto-staged placeholders, and surfaces a "last edited" pill on the admin list.';

-- Backfill: any existing row that was clearly touched after creation
-- (updated_at materially later than created_at) gets a stamp so the
-- Drafts tab keeps it visible immediately, the same heuristic we used
-- for editorials in migration 035.
UPDATE public.articles
   SET admin_edited_at = updated_at
 WHERE admin_edited_at IS NULL
   AND updated_at IS NOT NULL
   AND created_at IS NOT NULL
   AND EXTRACT(EPOCH FROM (updated_at - created_at)) > 60;

-- Verification (run separately):
-- SELECT
--   COUNT(*) FILTER (WHERE scheduled_publish_at IS NOT NULL AND scheduled_publish_at > NOW()) AS scheduled_count,
--   COUNT(*) FILTER (WHERE admin_edited_at IS NOT NULL) AS edited_count,
--   COUNT(*) AS total
-- FROM public.articles;
