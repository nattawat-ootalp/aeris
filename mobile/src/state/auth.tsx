/**
 * Who the app is acting as, shared across screens.
 *
 * The app has always worked without an account: the first API call mints an anonymous
 * Supabase user, and the backend keys ownership on its `auth.uid()`. That stays true — this
 * provider adds a way to put an email and password on that same user, so the readings already
 * recorded keep belonging to the person who recorded them, and to say plainly which of those
 * two states the app is in.
 *
 * `onAuthStateChange` is the source of truth rather than a fetch-on-mount, so a sign-in on one
 * screen is reflected on every other without a manual refresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  AUTH_CONFIGURED,
  continueWithoutAccount,
  ensureSessionToken,
  sendPasswordReset,
  signInEmail,
  signOut as signOutRaw,
  signUpEmail,
  supabase,
  upgradeToEmail,
} from '../lib/supabase';

/** `unconfigured` is its own state: with no Supabase project wired up, "not signed in" would
 *  invite the user to fix something they cannot fix from inside the app. */
export type AuthStatus = 'loading' | 'unconfigured' | 'anonymous' | 'signed_in' | 'signed_out';

interface AuthCtx {
  status: AuthStatus;
  email: string | null;
  /** True while the account exists but has no email on it yet — data is on this device only. */
  isAnonymous: boolean;
  /** The email has been set but not yet confirmed, so the password could not be set. */
  pendingVerification: boolean;
  createAccount: (email: string, password: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  browseWithoutAccount: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

function statusFor(user: User | null): AuthStatus {
  if (!AUTH_CONFIGURED) return 'unconfigured';
  if (!user) return 'signed_out';
  return user.is_anonymous ? 'anonymous' : 'signed_in';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!AUTH_CONFIGURED);
  const [pendingVerification, setPendingVerification] = useState(false);

  useEffect(() => {
    if (!AUTH_CONFIGURED) return;
    let cancelled = false;

    // Ask for a session the same way every API call does, so the provider and the client agree
    // about which user is current — including the anonymous one it may have just created.
    void ensureSessionToken()
      .then(() => supabase.auth.getUser())
      .then(({ data }) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setReady(true);
      if (session?.user?.email_confirmed_at) setPendingVerification(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  /**
   * Put an email and password on the account being used right now.
   *
   * On an anonymous session this upgrades that user in place, so nothing already recorded
   * moves or is lost. With no session at all it is an ordinary sign-up.
   */
  const createAccount = useCallback(async (email: string, password: string) => {
    if (!AUTH_CONFIGURED) return 'ยังไม่ได้ตั้งค่าการเชื่อมต่อบัญชี';
    if (user?.is_anonymous) {
      const result = await upgradeToEmail(email, password);
      if (!result.ok) return describe(result.error?.message);
      setPendingVerification(result.pendingVerification);
      return null;
    }
    const { error } = await signUpEmail(email, password);
    return error ? describe(error.message) : null;
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!AUTH_CONFIGURED) return 'ยังไม่ได้ตั้งค่าการเชื่อมต่อบัญชี';
    const { error } = await signInEmail(email, password);
    return error ? describe(error.message) : null;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await sendPasswordReset(email);
    return error ? describe(error.message) : null;
  }, []);

  const signOut = useCallback(async () => {
    await signOutRaw();
    setUser(null);
    setPendingVerification(false);
  }, []);

  const browseWithoutAccount = useCallback(async () => {
    await continueWithoutAccount();
    await ensureSessionToken();
    const { data } = await supabase.auth.getUser();
    setUser(data.user ?? null);
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    status: ready ? statusFor(user) : 'loading',
    email: user?.email ?? null,
    isAnonymous: Boolean(user?.is_anonymous),
    pendingVerification,
    createAccount,
    signIn,
    resetPassword,
    signOut,
    browseWithoutAccount,
  }), [ready, user, pendingVerification, createAccount, signIn, resetPassword, signOut, browseWithoutAccount]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Supabase's messages are English and terse; these are the ones a user can act on. */
function describe(message: string | undefined): string {
  const m = (message || '').toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'อีเมลนี้มีบัญชีอยู่แล้ว — ลงชื่อเข้าใช้แทน';
  }
  if (m.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (m.includes('password should be')) return 'รหัสผ่านสั้นเกินไป — อย่างน้อย 6 ตัวอักษร';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (m.includes('email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล — เปิดลิงก์ในเมลก่อน';
  if (m.includes('rate limit') || m.includes('too many')) return 'ลองบ่อยเกินไป — รอสักครู่แล้วลองใหม่';
  return message || 'ทำรายการไม่สำเร็จ';
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
