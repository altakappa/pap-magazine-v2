/**
 * PAP Magazine — Semantic embedding infrastructure
 * Step 16 in supabase_migrations/README.md execution order.
 *
 * Powers AI-driven theme matching: each editorial and each theme gets a
 * 1536-dim vector from OpenAI text-embedding-3-small. The themes endpoint
 * then ranks editorials by cosine similarity to the chosen theme's vector
 * instead of brittle tag-overlap counting.
 *
 * Why this is better than the current tag-bucketing:
 *   - Cross-language by design — embedding-3-small handles ko/en/it/etc.
 *     in the same vector space, so an editorial described in Korean still
 *     scores against the theme regardless of the user's display language
 *   - Graceful with sparse tags — even editorials with only ['editorial',
 *     'fashion'] get sorted by their title's semantic neighbourhood
 *   - One source of truth — admins don't have to remember to type
 *     thematic tags; the title + description carry the signal
 *
 * Cost: editorials embed once on insert/update (~$0.0001 per row),
 * themes embed once via the backfill endpoint. Read path is pure DB —
 * no OpenAI calls at request time.
 *
 * Idempotent: CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR
 * REPLACE FUNCTION. Safe to rerun.
 */

-- ── pgvector extension ───────────────────────────────────────────────────
-- Supabase ships pgvector pre-installed for free-tier projects; this is just
-- the explicit enable in case it isn't already on.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── editorials.embedding column ──────────────────────────────────────────
ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW for cosine distance. Better recall/latency than IVFFlat at small
-- scales and Supabase recommends it as the default since pgvector 0.5+.
-- m=16, ef_construction=64 are pgvector defaults; tuning is overkill for
-- the few-dozen-row scale we're at today.
CREATE INDEX IF NOT EXISTS editorials_embedding_hnsw
  ON public.editorials
  USING hnsw (embedding vector_cosine_ops);

-- ── theme_embeddings table ──────────────────────────────────────────────
-- Themes are static (defined in api/_lib/themes.js); one row per theme id,
-- populated by the admin-only /api/admin/backfill-embeddings endpoint.
-- Re-running backfill upserts (matches embedding model changes cleanly).
CREATE TABLE IF NOT EXISTS public.theme_embeddings (
  theme_id   TEXT PRIMARY KEY,
  embedding  vector(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.theme_embeddings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Public read (themes endpoint, anonymous + auth) so the matching RPC
  -- can be invoked without service-role.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'theme_embeddings' AND policyname = 'public_read_theme_embeddings'
  ) THEN
    CREATE POLICY public_read_theme_embeddings
      ON public.theme_embeddings
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── Matching RPC ────────────────────────────────────────────────────────
-- Returns the top N published editorials closest to the supplied embedding,
-- under cosine distance. (1 - distance) is the cosine similarity in [-1, 1];
-- for our purposes the ordering is what matters.
DROP FUNCTION IF EXISTS public.match_editorials_by_embedding(vector(1536), INT);
CREATE OR REPLACE FUNCTION public.match_editorials_by_embedding(
  query_embedding vector(1536),
  match_count INT
)
RETURNS TABLE (
  id             UUID,
  title          VARCHAR,
  slug           VARCHAR,
  cover_image    TEXT,
  thumbnail      TEXT,
  published_date DATE,
  tags           TEXT[],
  similarity     FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.id,
    e.title,
    e.slug,
    e.cover_image,
    e.thumbnail,
    e.published_date,
    e.tags,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.editorials e
  WHERE e.status = 'published'
    AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_editorials_by_embedding(vector(1536), INT)
  TO anon, authenticated, service_role;
