/**
 * PAP Magazine — Per-user theme preferences
 * Step 13 in supabase_migrations/README.md execution order.
 *
 * Powers the personalized theme rows on index.html. Every time a logged-in
 * user opens an editorial, every tag on that editorial gets +1 to that user's
 * weight for that tag. The home then queries this table to surface the user's
 * top 3 themes (theme = bundle of related tags, defined in api/_lib/themes.js).
 *
 * Schema choices (briefly):
 *   - Composite PK (user_id, tag) — natural for UPSERT-on-open and gives us
 *     a clean "select where user=…" with no GROUP BY.
 *   - INTEGER weight, no decay — first iteration. If preferences ossify too
 *     hard (user discovers a new style and the old one keeps winning), a
 *     follow-up can subtract a fraction nightly via cron.
 *   - updated_at — supports later decay/expiry without another migration.
 *
 * RLS: users can only see/touch their own row. The serverless API uses
 * service-role to UPSERT and READ, but the policies are defense-in-depth
 * for any direct PostgREST access.
 *
 * Idempotent: CREATE IF NOT EXISTS + DO block with policy existence checks.
 */

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  weight     INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag)
);

-- Top-N-tags-per-user lookup hits (user_id, weight DESC).
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_weight
  ON public.user_preferences (user_id, weight DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_preferences' AND policyname = 'users_read_own_prefs'
  ) THEN
    CREATE POLICY users_read_own_prefs
      ON public.user_preferences
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_preferences' AND policyname = 'users_insert_own_prefs'
  ) THEN
    CREATE POLICY users_insert_own_prefs
      ON public.user_preferences
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_preferences' AND policyname = 'users_update_own_prefs'
  ) THEN
    CREATE POLICY users_update_own_prefs
      ON public.user_preferences
      FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;
END $$;
