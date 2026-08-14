/**
 * Supabase Auth (email + anonymous) — gives every user an `auth.uid()` immediately, which
 * the backend RLS policies (infra/supabase/002_rls.sql) key ownership on. The Supabase URL
 * is public by design; only the anon key ships to the client (never the service_role key).
 */
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-url-polyfill/auto';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// createClient() validates the URL immediately and throws if it's empty/malformed — before
// env vars are set (e.g. local preview), fall back to a syntactically valid placeholder so
// module load never crashes the app. `CONFIGURED` gates every real auth call below.
export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Ensure the user has a session (anonymous is fine) and return a bearer token, or null if
 * Supabase isn't configured yet (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY unset). */
export async function ensureSessionToken(): Promise<string | null> {
  if (!CONFIGURED) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) return null;
  return anon.session?.access_token ?? null;
}

export async function upgradeToEmail(email: string, password: string) {
  return supabase.auth.updateUser({ email, password });
}
