/**
 * PAP Magazine — One-shot tag backfill for existing editorials
 * Step 14 in supabase_migrations/README.md execution order.
 *
 * Brings 12 production editorials in line with the rich thematic tags that
 * the static index.html cards already used (curated by the original
 * developer). Without this, /api/editorials/themes can't bucket cards into
 * theme rows because admin uploads only carried category tags like
 * ['editorial','fashion'].
 *
 * Strategy: MERGE — preserve every existing tag, add only new thematic ones.
 * Matched by UUID (no title-string escape headaches). Idempotent: if a row
 * already has the merged tag set, the UPDATE is still safe (just rewrites
 * the same array).
 *
 * Unmatched DB titles (10) keep their existing tags — admin can edit them
 * via /admin > 에디토리얼 once a multi-tag input lands. The themes endpoint
 * just won't surface them in theme rows until those tags are richer.
 */

BEGIN;

-- Couture Macabre: + ['beauty', 'bold']
UPDATE public.editorials SET tags = ARRAY['beauty', 'bold', 'editorial', 'fashion']::TEXT[] WHERE id = 'fd34408a-1884-446f-b2bf-76d43ddbcd5b';

-- Equipoise: + ['minimal', 'modern']
UPDATE public.editorials SET tags = ARRAY['editorial', 'fashion', 'minimal', 'modern']::TEXT[] WHERE id = 'f545ad95-554c-420b-a449-399c9ca167ff';

-- Birds Don't Cry: + ['bold', 'dark']
UPDATE public.editorials SET tags = ARRAY['bold', 'dark', 'editorial', 'fashion']::TEXT[] WHERE id = 'b1345e5c-682d-47b2-a6e0-37cb495abdf4';

-- Folie: + ['dreamy', 'warm']
UPDATE public.editorials SET tags = ARRAY['dreamy', 'editorial', 'fashion', 'warm']::TEXT[] WHERE id = '1daee464-1dab-4855-95ec-a3ade05cb595';

-- Welcome to the Circus: + ['bold', 'surreal']
UPDATE public.editorials SET tags = ARRAY['bold', 'editorial', 'fashion', 'surreal']::TEXT[] WHERE id = 'efd8dabe-24e0-4c4d-8994-db67cc16512a';

-- Sculpted Silence: + ['artistic', 'minimal']
UPDATE public.editorials SET tags = ARRAY['artistic', 'editorial', 'fashion', 'minimal']::TEXT[] WHERE id = '642a6d0e-4b76-45f4-9d72-82822993109f';

-- Severance: + ['bold', 'dark']
UPDATE public.editorials SET tags = ARRAY['bold', 'dark', 'editorial', 'fashion']::TEXT[] WHERE id = '77b128c6-cb9f-4de1-a78f-2da3c22f2eb3';

-- Becoming Form: + ['minimal', 'modern']
UPDATE public.editorials SET tags = ARRAY['editorial', 'fashion', 'minimal', 'modern']::TEXT[] WHERE id = 'fa63b763-7e12-43f2-afc0-af0d6626a005';

-- Her and The Hair: + ['dreamy', 'romantic']
UPDATE public.editorials SET tags = ARRAY['dreamy', 'editorial', 'fashion', 'romantic']::TEXT[] WHERE id = '4163aac4-d81f-45d6-aef7-423dedf36cc1';

-- After America: + ['artistic', 'colorful']
UPDATE public.editorials SET tags = ARRAY['artistic', 'colorful', 'editorial', 'fashion']::TEXT[] WHERE id = '16716726-26fb-4fe0-a5b6-f4776ea0729e';

-- Voyage in the Box: + ['artistic', 'bold', 'dark', 'dreamy', 'minimal', 'royal', 'surreal', 'urban', 'warm']
UPDATE public.editorials SET tags = ARRAY['artistic', 'bold', 'dark', 'dreamy', 'editorial', 'fashion', 'minimal', 'royal', 'surreal', 'urban', 'warm']::TEXT[] WHERE id = '64fe2478-e4b1-4062-bdf5-6b6df4061039';

-- I daydream about you online: + ['artistic', 'dreamy', 'surreal']
UPDATE public.editorials SET tags = ARRAY['artistic', 'dreamy', 'editorial', 'fashion', 'surreal']::TEXT[] WHERE id = '3df96232-32b5-49e4-8e91-a0bfa621677e';

COMMIT;

-- Backfill generated 2026-05-03 07:46 UTC — 12 rows updated.