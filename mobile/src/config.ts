/**
 * App configuration. The core-api base URL is configurable via the Expo public env
 * var EXPO_PUBLIC_API_BASE_URL (inlined at build time by Metro). Defaults to the local
 * FastAPI dev server on :8000 (see repo .env BACKEND_PORT).
 */

// Reference the literal so Expo/Metro can statically inline EXPO_PUBLIC_* at build time.
// Guarded so typecheck and non-Expo runtimes don't blow up if `process` is absent.
const envBaseUrl =
  typeof process !== 'undefined' && process.env
    ? process.env.EXPO_PUBLIC_API_BASE_URL
    : undefined;

export const API_BASE_URL: string = envBaseUrl ?? 'http://localhost:8000';

/**
 * Max age (seconds) before a reading is treated as stale and must NOT be shown as
 * current (TDD §5.6, §14). Mirrors backend FRESHNESS_MAX_AGE_SEC default (120).
 */
export const FRESHNESS_MAX_AGE_SEC = 120;

/** Network request timeout (ms) for the typed API client. */
export const REQUEST_TIMEOUT_MS = 8000;
