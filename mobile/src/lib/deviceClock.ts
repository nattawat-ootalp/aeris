/**
 * Turn the portable's `ts` field into a real capture time.
 *
 * The firmware sends `millis() / 1000` — seconds since IT booted, not an epoch. The device has
 * no clock and no network, so it cannot know the date. A buffered sample is therefore only
 * placeable in time by pairing its uptime with the phone's clock at the moment the phone hears
 * it, which is what this anchor does.
 *
 * Why it matters: the app used to stamp every reading with `Date.now()` at upload. That is
 * indistinguishable from the truth while a sample is uploaded the instant it arrives, and
 * completely wrong the moment anything is buffered — a replayed backlog would all land on the
 * same instant, preserving the bytes and destroying the information. See ingestion's
 * `/ingest/portable/batch`, which stores each reading at the timestamp it carries.
 */

/** A device reboot restarts `millis()` at 0, which is the one thing that unambiguously
 *  invalidates the anchor. Allow a little slack for out-of-order notifications rather than
 *  re-anchoring on jitter. */
const REBOOT_BACKSTEP_SEC = 5;

export interface DeviceClock {
  /**
   * Epoch milliseconds for a sample carrying device uptime `deviceTsSec`.
   * `receivedAt` defaults to now and exists so tests can be deterministic.
   */
  captureTime(deviceTsSec: number | undefined, receivedAt?: number): number;
  /** Forget the anchor. Call on disconnect: the next connection may be a different run of the
   *  device, and an anchor from the previous one would misdate every sample after it. */
  reset(): void;
}

export function createDeviceClock(): DeviceClock {
  let offsetMs: number | null = null;
  let lastTsSec: number | null = null;

  return {
    captureTime(deviceTsSec, receivedAt = Date.now()) {
      // No usable uptime (an old firmware, or a malformed frame that still parsed): the honest
      // best estimate is the moment the phone received it. Never guess an offset from nothing.
      if (typeof deviceTsSec !== 'number' || !Number.isFinite(deviceTsSec) || deviceTsSec < 0) {
        return receivedAt;
      }

      const rebooted = lastTsSec !== null && deviceTsSec < lastTsSec - REBOOT_BACKSTEP_SEC;
      // A reading cannot have been captured after it arrived. If the anchor says otherwise it
      // was set from a sample that was itself delayed, and every reading since has been dated
      // into the future — which the backend reads as a NEGATIVE age and rejects as stale,
      // silently breaking live readings. Re-anchoring on the promptest sample seen so far fixes
      // that and keeps converging on the true offset.
      //
      // Deliberately one-sided. A symmetric "too far from now" guard would fire on exactly the
      // case this module exists for: when the device drains an hour of buffered samples, the
      // oldest is an hour older than its arrival, and re-anchoring there would stamp the whole
      // backlog with the present moment. Reboots are already caught above, by the only signal
      // that actually proves the anchor is void.
      const anchorIsLate = offsetMs !== null && offsetMs + deviceTsSec * 1000 > receivedAt;

      if (offsetMs === null || rebooted || anchorIsLate) {
        offsetMs = receivedAt - deviceTsSec * 1000;
      }
      lastTsSec = deviceTsSec;
      return offsetMs + deviceTsSec * 1000;
    },

    reset() {
      offsetMs = null;
      lastTsSec = null;
    },
  };
}
