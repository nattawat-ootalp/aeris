/**
 * Durable outbox for portable telemetry — so a reading survives losing the network.
 *
 * Before this, `ingestPortable(...).catch(() => {})` meant every sample the backend did not
 * accept on the first try was gone. That is not a rare edge: the API sleeps when idle on its
 * hosting tier, so the first upload after each app open waits ~50 s, and every 5 s sample
 * arriving in the meantime used to be discarded. A tunnel, a lift, or airplane mode did the
 * same. The device kept measuring; the record simply had a hole in it.
 *
 * Readings are appended here instead, persisted to AsyncStorage, and replayed through
 * `/ingest/portable/batch` when the backend answers again. Each entry carries the time it was
 * captured, so a replayed backlog is stored as the history it was rather than as a burst at
 * upload time (see deviceClock.ts). Replay is idempotent, so re-sending after an unseen
 * response duplicates nothing.
 *
 * The queue is bounded. When it is full the OLDEST entry is dropped, and the count of drops is
 * kept and surfaced — a silent hole in the record is exactly what this module exists to
 * prevent, so an unavoidable one is reported rather than hidden.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, ingestPortableBatch, type PortableIngestPayload } from '../api/client';

const STORAGE_KEY = 'aeris.outbox.portable.v2';
/** The v1 store held a bare array and no drop count, so a restart reset "readings lost" to zero
 *  after a real loss. Read once on upgrade and then removed. */
const LEGACY_STORAGE_KEY = 'aeris.outbox.portable.v1';

/** ~2.8 hours of samples at the firmware's 5 s cadence, roughly 400 KB of JSON. Past this the
 *  oldest entries are dropped: an unbounded queue would grow until the write itself failed,
 *  which loses the whole backlog instead of its oldest part. */
export const MAX_ENTRIES = 2000;
/** Must not exceed PORTABLE_BATCH_MAX in ingestion/app/schemas.py, or the server 422s the lot. */
const BATCH_SIZE = 500;
const PERSIST_DEBOUNCE_MS = 3000;
const RETRY_BASE_MS = 2000;
/** Long enough not to hammer a backend that is asleep or unreachable, short enough that a
 *  reconnect is noticed within a minute without the user doing anything. */
const RETRY_MAX_MS = 60000;

export interface OutboxState {
  /** Readings captured but not yet stored by the backend. */
  pending: number;
  /** Readings lost to the cap since the app started. Non-zero means the record has a hole. */
  dropped: number;
  /** True while an upload is in flight. */
  syncing: boolean;
}

let queue: PortableIngestPayload[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let dropped = 0;
let draining = false;
let retryDelayMs = RETRY_BASE_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<(s: OutboxState) => void>();

function snapshot(): OutboxState {
  return { pending: queue.length, dropped, syncing: draining };
}

function notify(): void {
  const s = snapshot();
  listeners.forEach((fn) => fn(s));
}

/** Subscribe to queue depth. Returns an unsubscribe function. */
export function subscribeOutbox(fn: (s: OutboxState) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}

export function outboxState(): OutboxState {
  return snapshot();
}

async function persistNow(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  // The drop count is stored WITH the queue. Keeping it in memory only meant "readings lost"
  // silently returned to zero on the next launch — reporting a hole in the record and then
  // forgetting it is barely better than never reporting it.
  // A failed write costs us the on-disk copy, not the in-memory queue — this run keeps
  // working and only a kill-before-next-write loses the backlog.
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ queue, dropped })).catch(() => {});
}

function persistSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** Read the backlog left by a previous run. Safe to call repeatedly; only the first reads. */
export async function loadOutbox(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      let stored: PortableIngestPayload[] = [];
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { queue?: unknown }).queue)) {
          const state = parsed as { queue: PortableIngestPayload[]; dropped?: number };
          stored = state.queue;
          dropped += typeof state.dropped === 'number' ? state.dropped : 0;
        }
      } else {
        // One-time upgrade from the bare-array format.
        const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          const parsed: unknown = JSON.parse(legacy);
          if (Array.isArray(parsed)) stored = parsed as PortableIngestPayload[];
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
        }
      }
      // Anything already in memory was captured during this run and is newer than what was
      // on disk, so the stored backlog goes in front of it.
      const merged = [...stored, ...queue];
      if (merged.length > MAX_ENTRIES) {
        // Counted, not silent: this trims the same way the cap does during a run, and a
        // reading lost here is just as absent from the record.
        dropped += merged.length - MAX_ENTRIES;
      }
      queue = merged.slice(-MAX_ENTRIES);
    } catch {
      // A corrupt or unreadable store is treated as an empty one. Refusing to start because
      // of it would mean discarding every future reading too.
    }
    loaded = true;
    loading = null;
    notify();
  })();
  return loading;
}

/** 4xx means this request will not succeed as sent, so repeating it is pointless — except for
 *  408 (timeout) and 429 (rate limited), which explicitly invite a retry. Anything else, a 5xx
 *  or a network error included, may well work in a moment. */
function isRetryableTransportError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // offline, DNS, timeout — all worth retrying
  if (e.status === 408 || e.status === 429) return true;
  return e.status < 400 || e.status >= 500;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drainOutbox();
  }, delay);
}

/**
 * Append a reading and try to send. Never throws and never rejects: a caller on the BLE
 * notification path must not have its own work interrupted by the network.
 */
export function enqueueReading(payload: PortableIngestPayload): void {
  queue.push(payload);
  if (queue.length > MAX_ENTRIES) {
    dropped += queue.length - MAX_ENTRIES;
    queue = queue.slice(queue.length - MAX_ENTRIES);
  }
  persistSoon();
  notify();
  void drainOutbox();
}

/**
 * Send as much of the backlog as the backend will take. Concurrency-safe: a second call while
 * one is in flight returns immediately rather than sending the same entries twice.
 */
export async function drainOutbox(): Promise<void> {
  if (draining) return;
  await loadOutbox();
  if (queue.length === 0) return;

  draining = true;
  notify();
  try {
    while (queue.length > 0) {
      const batch = queue.slice(0, BATCH_SIZE);
      const result = await ingestPortableBatch(batch);

      const keep = new Set(
        result.failed.filter((f) => f.retryable).map((f) => f.index),
      );
      const requeued = batch.filter((_, i) => keep.has(i));
      // Only entries the server declined stay queued; anything it stored — or permanently
      // refused — leaves. Appends during the request land after this prefix, so slicing by
      // the batch length is still correct.
      queue = [...requeued, ...queue.slice(batch.length)];
      await persistNow();
      notify();

      if (requeued.length > 0) {
        // The backend is up but could not store these. Backing off is right; retrying in a
        // tight loop would just repeat the same failure.
        scheduleRetry();
        return;
      }
      retryDelayMs = RETRY_BASE_MS;
    }
  } catch (e) {
    // The entries are untouched and stay queued either way. But retrying is only right when the
    // failure could go away: a 422 from sending a batch the server considers too large will
    // fail identically forever, and retrying it every minute means nothing behind it ever
    // drains. Same distinction the server draws per entry, applied to the request itself.
    if (isRetryableTransportError(e)) scheduleRetry();
  } finally {
    draining = false;
    notify();
  }
}

/** Test seam — the exact ApiError class this module compares against, so a check can raise one
 *  the retry logic will actually recognise. */
export { ApiError as __ApiErrorForTests };

/** Test seam — drop all state so each case starts clean. */
export async function __resetOutboxForTests(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  if (persistTimer) clearTimeout(persistTimer);
  retryTimer = null;
  persistTimer = null;
  queue = [];
  dropped = 0;
  draining = false;
  loaded = false;
  loading = null;
  retryDelayMs = RETRY_BASE_MS;
  listeners.clear();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
}
