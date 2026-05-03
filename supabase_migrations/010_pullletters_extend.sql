/**
 * PAP Magazine — Extend existing `pullletters` table for community-flow
 * Step 10 in supabase_migrations/README.md execution order.
 *
 * Background: The `pullletters` table from 000_prerequisites.sql + the
 * /api/pullletters family already power the standalone Pull-Letter request
 * flow at /frontend/pullletter.html (multipart upload of fresh moodboard
 * images). This migration EXTENDS that same table to also support
 * "request a pull-letter based on an existing community moodboard" — no
 * new parallel table, single source of truth for admin review.
 *
 * Adds:
 *   - mood_board_id column → optional FK to community_mood_boards
 *   - shoot_purpose, shoot_location_target, items_needed, shoot_date_planned,
 *     contact_phone — new structured fields for the moodboard-based flow
 *   - pull_letter_url, reviewed_at, issued_at — admin-issued PDF tracking
 *   - 'issued' added to status values (existing: pending/accepted/approved/rejected)
 *   - Private storage bucket 'pull-letters' for issued PDFs
 *
 * Idempotent: every ALTER uses IF NOT EXISTS where supported; bucket insert
 * uses ON CONFLICT.
 */

-- ── Extend the table ─────────────────────────────────────────────────────
ALTER TABLE public.pullletters
  ADD COLUMN IF NOT EXISTS mood_board_id        UUID REFERENCES community_mood_boards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shoot_purpose        TEXT,
  ADD COLUMN IF NOT EXISTS shoot_location_target TEXT,
  ADD COLUMN IF NOT EXISTS items_needed         TEXT,
  ADD COLUMN IF NOT EXISTS shoot_date_planned   DATE,
  ADD COLUMN IF NOT EXISTS contact_phone        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS pull_letter_url      TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS issued_at            TIMESTAMP WITH TIME ZONE;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pullletters_moodboard ON public.pullletters(mood_board_id);
CREATE INDEX IF NOT EXISTS idx_pullletters_status_created
  ON public.pullletters(status, created_at DESC);

-- ── Storage bucket for issued PDFs (private; access via signed URL) ─────
INSERT INTO storage.buckets (id, name, public)
VALUES ('pull-letters', 'pull-letters', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: only admins can upload/read directly. Members get the PDF
-- through an admin-signed URL handed back by the API (api/pullletters/mine).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admins can upload pull-letters'
  ) THEN
    CREATE POLICY "Admins can upload pull-letters"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'pull-letters' AND public.is_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admins can read pull-letters'
  ) THEN
    CREATE POLICY "Admins can read pull-letters"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'pull-letters' AND public.is_admin());
  END IF;
END $$;
