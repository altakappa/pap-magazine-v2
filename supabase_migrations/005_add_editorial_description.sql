-- Add description column to editorials table
ALTER TABLE public.editorials
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Comment for documentation
COMMENT ON COLUMN public.editorials.description IS 'Editorial description text displayed above credits on the detail page';
