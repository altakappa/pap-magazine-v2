-- ============================================================================
-- PAP Magazine: films description (KR + EN + IT) (QA #251)
-- ============================================================================
--
-- Background
--   Editorials carry three side-by-side description slots — Korean,
--   English, Italian — so the SPA can render the editor's chosen language
--   without translating on the fly. The film admin so far had no
--   description field at all: editors writing a film's blurb either
--   stashed it inside instagram_caption (QA #250) or dropped the context
--   entirely.
--
--   This migration adds the same three TEXT slots films were missing.
--   Matches editorials' shape exactly (description + description_en +
--   description_it) so the AI translation flow added by the same QA can
--   reuse api/_lib/editorialAi.js without per-content-type branching.
--
--   Existing rows: nullable, no backfill. Older films simply show three
--   empty textareas + a "🤖 AI 자동 번역" button.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS description_en TEXT,
  ADD COLUMN IF NOT EXISTS description_it TEXT;

COMMENT ON COLUMN public.films.description IS
  'Korean (KR) film description / synopsis. Mirrors editorials.description.';
COMMENT ON COLUMN public.films.description_en IS
  'English (EN) film description. Filled either by the editor directly or '
  'by the AI translator endpoint api/admin/films/:id/translate.';
COMMENT ON COLUMN public.films.description_it IS
  'Italian (IT) film description. Same source as description_en.';
