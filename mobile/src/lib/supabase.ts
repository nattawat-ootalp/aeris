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

export const AUTH_CONFIGURED = CONFIGURED;

/** Cleared by an explicit sign-out. Without it the very next API call would mint a fresh
 *  anonymous user and the app would look exactly as it did before signing out — the account
 *  gone, but nothing on screen saying so. */
const ANON_ALLOWED_KEY = 'aeris.auth.anonymous_allowed';

async function anonymousAllowed(): Promise<boolean> {
  const flag = await AsyncStorage.getItem(ANON_ALLOWED_KEY);
  return flag !== 'no';
}

/**
 * A bearer token for the API, or null when there is none to be had.
 *
 * Anonymous-by-default is load-bearing: the app is usable with no account, and the backend
 * keys ownership on `auth.uid()` either way, so a first-time user's readings already belong to
 * someone before they have signed up. Signing in later keeps that same uid, which is why the
 * upgrade below is a mutation of the existing user and not a migration.
 */
export async function ensureSessionToken(): Promise<string | null> {
  if (!CONFIGURED) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  if (!(await anonymousAllowed())) return null;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) return null;
  return anon.session?.access_token ?? null;
}

/** Whatever the account is right now, including whether it is still the anonymous one. */
export async function currentUser() {
  if (!CONFIGURED) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Give the CURRENT user — anonymous or not — an email and password.
 *
 * `updateUser` mutates the existing `auth.users` row, so `auth.uid()` does not change and
 * every reading, symptom and setting already recorded under it stays exactly where it is. A
 * fresh `signUp` would create a second account and orphan all of it.
 *
 * Supabase will not set a password on an unverified address, so with email confirmation turned
 * on this returns `pending_verification` and the password is set on the second call, after the
 * user has followed the link. The caller must show that state rather than a spinner.
 */
export async function upgradeToEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.updateUser({ email, password });
  if (error) return { ok: false as const, error };
  // `is_anonymous` only flips on the next token, so refresh now — otherwise the backend keeps
  // seeing an anonymous claim for the rest of the token's life.
  await supabase.auth.refreshSession();
  const confirmed = Boolean(data.user?.email_confirmed_at);
  return { ok: true as const, pendingVerification: !confirmed, user: data.user };
}

export async function signUpEmail(email: string, password: string) {
  await AsyncStorage.setItem(ANON_ALLOWED_KEY, 'yes');
  return supabase.auth.signUp({ email, password });
}

/** Sign in to an existing account. Any anonymous session on this device is REPLACED, not
 *  merged — health data has no correct automatic merge, so the caller must warn first. */
export async function signInEmail(email: string, password: string) {
  await AsyncStorage.setItem(ANON_ALLOWED_KEY, 'yes');
  return supabase.auth.signInWithPassword({ email, password });
}

export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email);
}

/** Sign out and stay signed out — see ANON_ALLOWED_KEY. */
export async function signOut() {
  await AsyncStorage.setItem(ANON_ALLOWED_KEY, 'no');
  return supabase.auth.signOut();
}

/** Return to browsing without an account, minting a fresh anonymous session on the next call. */
export async function continueWithoutAccount() {
  await AsyncStorage.setItem(ANON_ALLOWED_KEY, 'yes');
}
