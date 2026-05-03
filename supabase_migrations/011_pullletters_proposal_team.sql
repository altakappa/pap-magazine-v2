/**
 * PAP Magazine — Pull-letter proposal PDF + structured team info
 * Step 11 in supabase_migrations/README.md execution order.
 *
 * Background: PR #2 originally tried to bridge community moodboards into the
 * pull-letter request flow with a few free-text fields. After product
 * feedback we decoupled the two: community moodboards are pure self-
 * expression; pull-letter requests now require a member-prepared
 * 촬영시안 PDF + structured team info (photographer/stylist required,
 * videographer optional) submitted via /frontend/pullletter.html.
 *
 * Adds:
 *   - team_info JSONB        — structured creator credits (photographer,
 *                              stylist, videographer, contact, extras[])
 *   - proposal_pdf_url TEXT  — Storage path in private 'pull-letters'
 *                              bucket (`proposals/<userId>/<ts>.pdf`).
 *                              Read by members via signed URL minted in
 *                              api/pullletters/mine.js.
 *
 * Idempotent: uses ADD COLUMN IF NOT EXISTS.
 *
 * The mood_board_id / shoot_purpose / shoot_location_target / items_needed /
 * shoot_date_planned / contact_phone columns from migration 010 are kept in
 * the schema (they don't hurt) but are no longer written to by the active
 * code path. They're effectively reserved space.
 */

ALTER TABLE public.pullletters
  ADD COLUMN IF NOT EXISTS team_info        JSONB,
  ADD COLUMN IF NOT EXISTS proposal_pdf_url TEXT;

-- Optional: index for admin filtering by submission completeness later
CREATE INDEX IF NOT EXISTS idx_pullletters_has_proposal
  ON public.pullletters((proposal_pdf_url IS NOT NULL));
