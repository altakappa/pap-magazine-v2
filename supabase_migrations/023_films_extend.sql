/**
 * PAP Magazine — Films extension: link to source editorial
 * Step 23 in supabase_migrations/README.md execution order.
 *
 * Films are now treated as "video editorials" — same metadata model
 * (categories, credits, tags, slug, published_date) as editorials, plus
 * a YouTube video on top. The admin can optionally link a film to a
 * source editorial (e.g. "the BTS film for the Couture Macabre shoot");
 * this column carries that linkage.
 *
 * NULL is the common case (free-standing film). When set, ON DELETE
 * SET NULL keeps the film alive even if its source editorial is
 * deleted — the film is still a useful artifact on its own.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS so
 * re-running this migration is a no-op.
 */

ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS related_editorial_id UUID REFERENCES public.editorials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_films_related_editorial
  ON public.films(related_editorial_id)
  WHERE related_editorial_id IS NOT NULL;

COMMENT ON COLUMN public.films.related_editorial_id IS
  'Optional FK to the editorial this film derives from (BTS, behind-the-scenes, ' ||
  'campaign film, etc.). NULL = free-standing film. ON DELETE SET NULL.';
