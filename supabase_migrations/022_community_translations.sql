/**
 * PAP Magazine — Community user-generated-content translation cache
 * Step 22 in supabase_migrations/README.md execution order.
 *
 * Adds a write-through cache for translations of community UGC fields
 * (post titles/content, mood board titles/descriptions, comments, bios)
 * so each translation API call (OpenAI GPT-4o-mini) is paid for once and
 * served from the DB on every subsequent view.
 *
 * Cache key: (target_type, target_id, field, target_lang, source_hash).
 * Including `source_hash` (SHA-256 of source_text) makes the cache
 * automatically self-invalidate when the source content is edited — old
 * cached rows just stop matching, the new content gets a fresh translation.
 *
 * RLS: SELECT public (cached translations are not sensitive — they're the
 * translated form of already-public UGC). Writes happen only via the API
 * (supabaseAdmin) so no public INSERT policy.
 */

CREATE TABLE IF NOT EXISTS community_translations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type     VARCHAR(40)  NOT NULL,  -- 'post' | 'post_comment' | 'mood_board' | 'mood_board_comment' | 'profile_bio'
  target_id       UUID         NOT NULL,
  field           VARCHAR(40)  NOT NULL,  -- 'title' | 'content' | 'description' | 'tags' | 'bio' | etc.
  source_lang     VARCHAR(10),            -- ISO code or null if undetected
  target_lang     VARCHAR(10)  NOT NULL,
  source_hash     VARCHAR(64)  NOT NULL,  -- SHA-256 of source_text — drives cache invalidation
  source_text     TEXT,                   -- snapshot at translation time (for debugging only)
  translated_text TEXT         NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(target_type, target_id, field, target_lang, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_translations_lookup
  ON community_translations(target_type, target_id, field, target_lang, source_hash);

ALTER TABLE community_translations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'community_translations' AND policyname = 'Anyone can read translations'
  ) THEN
    CREATE POLICY "Anyone can read translations"
      ON community_translations FOR SELECT
      USING (true);
  END IF;
END $$;
