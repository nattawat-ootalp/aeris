/**
 * Medical-safety guards (TDD §7, §9, §14).
 *
 * Primary defense is the {@link WatchStatus} union in types.ts — "Safe" cannot be
 * assigned to a status field without a compile error. These runtime helpers back it
 * up at the API boundary so a bad value from the backend degrades to "No Data" rather
 * than surfacing a forbidden assurance. A companion lint (scripts/check-no-safe.mjs)
 * fails the build if "SAFE" is ever used as a status/assurance string in src/.
 */
import { WATCH_STATUSES, type WatchStatus, type Decision } from './types';

const BANNED_ASSURANCE = 'SAFE';

export function isWatchStatus(value: unknown): value is WatchStatus {
  return typeof value === 'string' && (WATCH_STATUSES as readonly string[]).includes(value);
}

/**
 * Map a backend engineering decision to a watch label. Anything unknown, stale, or
 * low-quality collapses to "No Data" — never a reassuring value (TDD §5.6, §14).
 */
export function decisionToWatch(decision: Decision | string | null | undefined): WatchStatus {
  switch (decision) {
    case 'NORMAL':
      return 'Normal';
    case 'CAUTION':
      return 'Caution';
    case 'HIGH':
      return 'High';
    default:
      return 'No Data';
  }
}

/**
 * Validate a human-facing status label. Throws if it asserts medical safety via the
 * banned word; returns "No Data" if it is otherwise not an allowed label.
 */
export function assertWatchLabel(label: string): WatchStatus {
  if (label.toUpperCase().includes(BANNED_ASSURANCE)) {
    throw new Error(`medical-safety violation: banned assurance word in ${JSON.stringify(label)}`);
  }
  return isWatchStatus(label) ? label : 'No Data';
}
