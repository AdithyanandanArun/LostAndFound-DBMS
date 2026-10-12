// Supabase browser client. The anon key is public by design; protect data with RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "../config.js";

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Configure SUPABASE_URL and SUPABASE_ANON_KEY in config.js.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
