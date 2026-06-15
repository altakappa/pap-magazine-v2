-- QA #202 — content_audit_log: per-action history for editorials,
-- articles, films and shorts.
--
-- The created_by / updated_by columns in migration 037 answer "who
-- last did something" but not "what changed and when". This table is
-- the append-only ledger that does.
--
-- Shape:
--   id          BIGSERIAL                    — monotonic, good for ORDER BY
--   content_type TEXT     ('editorial'|'article'|'film'|'shorts')
--   content_id  UUID                        — the affected row's id
--   action      TEXT     ('create'|'update'|'delete'|'publish'|'unpublish')
--   actor_id    UUID                        — auth.users.id of who did it
--   actor_label TEXT                        — denormalised display name
--                                            so the admin UI can render
--                                            without a join even if the
--                                            actor's profile is later
--                                            renamed.
--   summary     TEXT                        — short Korean phrase for the
--                                            UI ("제목 변경", "공개 → 임시저장")
--   diff        JSONB                       — optional structured delta
--                                            (changed fields only).
--   created_at  TIMESTAMPTZ DEFAULT now()
--
-- We store diff in JSONB rather than full snapshots because:
--   1) snapshots blow up storage on long-content tables (editorials
--      with 30 gallery images, articles with rich block JSON);
--   2) diffs are what the editor actually wants to see ("title and
--      status changed"); a full snapshot is overkill.
-- An admin endpoint can still reconstruct prior values by walking
-- diffs backwards if forensic detail is ever needed.

CREATE TABLE IF NOT EXISTS public.content_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  content_type  TEXT NOT NULL CHECK (content_type IN ('editorial','article','film','shorts')),
  content_id    UUID NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create','update','delete','publish','unpublish')),
  actor_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label   TEXT,
  summary       TEXT,
  diff          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dominant read pattern is "show me the last N entries for this
-- particular row" — the composite index handles that without scanning.
CREATE INDEX IF NOT EXISTS idx_content_audit_log_row
  ON public.content_audit_log(content_type, content_id, created_at DESC);

-- Secondary index for the per-actor view (e.g. dashboard panel
-- "최근 내가 수정한 콘텐츠").
CREATE INDEX IF NOT EXISTS idx_content_audit_log_actor
  ON public.content_audit_log(actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- RLS is overkill for this internal admin table — the application
-- layer guards INSERT via the existing requireAdmin middleware, and
-- only the service role queries it. Skip enabling RLS to keep
-- read latency low for the admin dashboard.

COMMENT ON TABLE public.content_audit_log IS
  'Append-only history of mutations on editorials / articles / films / shorts. Written by the API on every POST/PUT/DELETE and surfaced in the admin UI as "수정 이력".';

-- Verification (run separately):
-- SELECT COUNT(*) FROM public.content_audit_log;
