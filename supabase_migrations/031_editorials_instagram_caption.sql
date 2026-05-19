-- ============================================================================
-- PAP Magazine: editorials.instagram_caption (QA #170)
-- ============================================================================
--
-- Background
--   When the editorial team approves a submission, they also need a ready-
--   to-paste Instagram caption — same credits/brands but reformatted into
--   PAP's IG style (Photographer @handle / Style @handle / Starring @model
--   / Wearing @brand1 @brand2 …).
--
--   We generate the caption at approval time in api/submissions/[id]/review
--   from the structured submission data (desc.team / desc.models /
--   desc.looks), persist it on the editorial row, and surface a copy-to-
--   clipboard textarea in the admin editor. Editors can tweak the text
--   before publishing; their edits stick because the column is a plain TEXT
--   field that round-trips through the editorial PUT endpoint.
--
--   Existing rows: nullable column, no backfill. Old editorials simply
--   show an empty textarea + a "🔄 generate" button in the admin modal.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS instagram_caption TEXT;

COMMENT ON COLUMN public.editorials.instagram_caption IS
  'Pre-formatted Instagram caption (PAP house style: Photographer @handle / '
  'Style @handle / Starring @model / Wearing @brand…). Auto-generated at '
  'submission approval time; editors can hand-edit in the admin modal.';
