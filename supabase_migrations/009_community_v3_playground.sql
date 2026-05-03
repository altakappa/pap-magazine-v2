/**
 * PAP Magazine — Community Playground primitives
 * Step 9 in supabase_migrations/README.md execution order.
 *
 * Run AFTER supabase-schema-community-v2.sql (community v2 extension).
 * For pull-letter feature, additionally run 010_community_v4_pull_letter.sql.
 *
 * Adds:
 *   - community_scraps          (스크랩북 — personal visual collection)
 *   - inspired_by_id column on community_mood_boards (inspiration chain)
 */

-- ============================================================================
-- 15. 스크랩북 (Scrapbook — personal visual collection)
-- ============================================================================

CREATE TABLE IF NOT EXISTS community_scraps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  source_url TEXT,                 -- where the image came from (editorial URL, external URL)
  source_type VARCHAR(40),         -- 'editorial' | 'film' | 'article' | 'moodboard' | 'external' | 'upload'
  source_id UUID,                  -- optional FK-by-convention to the source content row
  note TEXT,                       -- short user note ("좋은 라이팅" 등)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scraps_user ON community_scraps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraps_source ON community_scraps(source_type, source_id);

ALTER TABLE community_scraps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view scraps"
  ON community_scraps FOR SELECT
  USING (true);

CREATE POLICY "Users can manage own scraps"
  ON community_scraps FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 16. Moodboard inspiration chain
-- ============================================================================

ALTER TABLE community_mood_boards
  ADD COLUMN IF NOT EXISTS inspired_by_id UUID REFERENCES community_mood_boards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mood_boards_inspired_by ON community_mood_boards(inspired_by_id);
