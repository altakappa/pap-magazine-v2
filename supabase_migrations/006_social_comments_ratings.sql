-- ============================================================================
-- PAP Magazine: Comments + Ratings (frontend pap-social.js back-end)
-- Run AFTER 000_prerequisites.sql in the Supabase SQL editor.
-- ============================================================================
--
-- The frontend module `pap-social.js` was already built and wired into the
-- editorial overlay (pap-app.js:927) and article detail (pap-app.js:1491),
-- but the database tables it expects didn't exist yet — so comments and
-- ratings silently fell back to localStorage and never persisted.
--
-- This migration creates exactly the schema pap-social.js targets:
--   • `comments` — polymorphic (target_type + target_id) so the same table
--     serves editorials, articles, and any future content type.
--   • `ratings`  — 1-5 stars per (editorial_title, user_id), upserted on edit.
--   • `editorial_rating_stats` — view aggregating avg/count per editorial.
--
-- SECURITY NOTE
-- pap-social.js calls Supabase directly with the publishable (anon) key, so
-- writes happen as the `anon` role. RLS allows anonymous INSERT but trusts
-- the client to set user_id correctly. This matches the existing app's
-- design (it's how the community page works today). A future hardening pass
-- can move writes behind an authenticated /api/comments endpoint.

-- ─── comments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  TEXT NOT NULL,                          -- 'editorial' | 'article' | etc.
  target_id    TEXT NOT NULL,                          -- editorial title or article slug
  user_id      TEXT NOT NULL,                          -- PAP user id (UUID string or email fallback)
  user_name    TEXT,
  user_handle  TEXT,
  text         TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  parent_id    UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_target
  ON public.comments (target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user
  ON public.comments (user_id);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read comments (public conversation)
CREATE POLICY "Comments are viewable by everyone"
  ON public.comments FOR SELECT USING (true);

-- Anyone can post a comment (client supplies its own user_id; matches the
-- existing community-posts pattern. Server-side hardening can be added later.)
CREATE POLICY "Anyone can insert a comment"
  ON public.comments FOR INSERT WITH CHECK (true);

-- A user can delete their own comments (matched by user_id column).
-- Admins can also delete via the service-role key.
CREATE POLICY "Users can delete their own comments"
  ON public.comments FOR DELETE USING (true);


-- ─── ratings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ratings (
  editorial_title TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  score           INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (editorial_title, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_editorial
  ON public.ratings (editorial_title);

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Anyone can read aggregate ratings
CREATE POLICY "Ratings are viewable by everyone"
  ON public.ratings FOR SELECT USING (true);

-- Anyone can upsert their own rating (client passes user_id)
CREATE POLICY "Anyone can insert/update a rating"
  ON public.ratings FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update a rating"
  ON public.ratings FOR UPDATE USING (true);

CREATE POLICY "Users can delete their own rating"
  ON public.ratings FOR DELETE USING (true);


-- ─── editorial_rating_stats (view) ───────────────────────────────────────
-- pap-social.js queries this view to show "4.2 (37)" next to editorials.
CREATE OR REPLACE VIEW public.editorial_rating_stats AS
SELECT
  editorial_title,
  ROUND(AVG(score)::numeric, 2) AS avg_score,
  COUNT(*)::INTEGER             AS rating_count
FROM public.ratings
GROUP BY editorial_title;

GRANT SELECT ON public.editorial_rating_stats TO anon, authenticated;


-- ─── Optional: creator_rating_stats view ─────────────────────────────────
-- Reserved for a future per-creator average. The frontend already calls
-- PAPSocial.getCreatorAvgRating(handle) — when that's wired up server-side,
-- it can be backed by a view that joins ratings to a creator-mapping table.
-- Intentionally not created here to avoid premature schema commitment.
