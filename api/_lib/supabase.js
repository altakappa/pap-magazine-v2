/**
 * PAP Magazine - Supabase Client (Server-side)
 * Service role key bypasses RLS for admin operations
 */

const { createClient } = require('@supabase/supabase-js');

// Public client (respects RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin client (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = { supabase, supabaseAdmin };
