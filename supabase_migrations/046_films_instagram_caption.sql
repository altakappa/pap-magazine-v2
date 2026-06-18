-- ============================================================================
-- PAP Magazine: films.instagram_caption (QA #250)
-- ============================================================================
--
-- Background
--   Films get the same Instagram release treatment as editorials: the team
--   posts the YouTube link + a hand-crafted caption that lists director /
--   DOP / starring / styled-by credits in PAP's house format. Until now the
--   admin had to compose the caption in a separate doc and paste it into
--   Instagram by hand. QA #170 added an `instagram_caption` column on
--   editorials so editors could draft + persist + copy the caption inside
--   the admin modal; this migration mirrors that column onto films so the
--   single-film workflow gets the same affordance.
--
--   The admin film modal renders a textarea with a "📋 복사" button (and a
--   "🔄 템플릿 재조립" button that rebuilds it from the credits[] array if
--   editors want to regenerate after editing the credit rows). No AI
--   generation hook in this revision — the films page already has all the
--   structured data needed for a deterministic template.
--
--   Existing rows: nullable column, no backfill. Old films just show an
--   empty textarea.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS instagram_caption TEXT;

COMMENT ON COLUMN public.films.instagram_caption IS
  'Pre-formatted Instagram caption (PAP house style: Director @handle / '
  'DOP @handle / Starring @model / etc.). Admin drafts it in the film '
  'modal; the public film page does not surface it. Mirrors '
  'editorials.instagram_caption from QA #170.';
