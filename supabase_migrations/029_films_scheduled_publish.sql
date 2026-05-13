-- 029_films_scheduled_publish.sql
-- ------------------------------------------------------------------
-- Bring films in line with editorials for publish state management.
-- editorials already supports three states via (status, scheduled_publish_at):
--
--   status='draft'                           → not public
--   status='published' + scheduled_publish_at NULL or in the past → live
--   status='published' + scheduled_publish_at in the future       → queued
--
-- films had only the boolean-ish (status='published' | 'draft') so admins
-- couldn't queue an upload for a specific go-live time. After this
-- migration the admin film modal exposes the same three options, and
-- /api/films GET hides rows whose scheduled_publish_at is still in the
-- future from the public-facing view (admin tools that pass an explicit
-- status param bypass the gate, same shape as editorials).
-- ------------------------------------------------------------------

ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ;

COMMENT ON COLUMN public.films.scheduled_publish_at IS
  'Optional go-live moment. NULL = visible immediately when status=published. When set, /api/films hides the row from the public list/detail until now() >= scheduled_publish_at.';

-- Partial index — the hot path is
--   SELECT * FROM films
--   WHERE status='published' AND (scheduled_publish_at IS NULL OR scheduled_publish_at <= now())
--   ORDER BY published_date DESC
-- which can use this index to skip the future-queued rows without a full
-- table scan once queues accumulate.
CREATE INDEX IF NOT EXISTS films_scheduled_publish_idx
  ON public.films (scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL;
