'use client';

import { createClient } from '@supabase/supabase-js';

/**
 * Supabase is used for authentication only. All data access goes through the
 * Azure Functions API, which resolves the caller's organisation from their
 * membership rows — the browser never picks its own tenant.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
);
