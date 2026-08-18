/**
 * Turn the portable's `ts` field into a real capture time.
 *
 * The firmware sends `millis() / 1000` — seconds since IT booted, not an epoch. The device has
 * no clock and no network, so it cannot know the date. A sample is only placeable in time by
 * pairing its uptime with the phone's clock at the moment the phone hears it, which is what
 * this anchor does.
 *
 * Why it matters: the app used to stamp every reading with `Date.now()` at upload. That is
 * indistinguishable from the truth while a sample is uploaded the instant it arrives, and
 * completely wrong the moment anything is buffered — a replayed backlog would all land on the
 * same instant, preserving the bytes and destroying the information. See ingestion's
 * `/ingest/portable/batch`, which stores each reading at the timestamp it carries.
 *
 * Only LIVE frames may set the anchor, which is why the two kinds have separate methods. A
 * replayed frame arrived long after it was measured, so anchoring from one would encode that
 * whole delay into the offset — and since the frames after it are replayed too, each would
 * look "late" and re-anchor again, spacing an hour of history at the milliseconds the radio
 * happened to deliver it in. That is exactly the collapse the buffering exists to prevent, and
 * it is the common case rather than an edge one: the firmware starts replaying shortly after
 * connect, usually before the next live sample is due.
 */

/** A device reboot restarts `millis()` at 0, which is the one thing that unambiguously
 *  invalidates the anchor. Allow a little slack for out-of-order notifications rather than
 *  re-anchoring on jitter. */
const REBOOT_BACKSTEP_SEC = 5;

function usableTs(deviceTsSec: number | undefined): deviceTsSec is number {
  return typeof deviceTsSec === 'number' && Number.isFinite(deviceTsSec) && deviceTsSec >= 0;
}

export interface DeviceClock {
  /**
   * Date a LIVE reading and (re)anchor the clock from it. Always returns a time — a live
   * reading arrived as it was measured, so its arrival is a sound fallback.
   * `receivedAt` defaults to now and exists so tests can be deterministic.
   */
  observeLive(deviceTsSec: number | undefined, receivedAt?: number): number;

  /**
   * Date a REPLAYED reading (one the device buffered while nothing was listening).
   *
   * Null means the clock cannot place it yet — no live frame has anchored since this
   * connection began. The caller must HOLD such readings and re-offer them once a live frame
   * arrives. Falling back to the arrival time instead would claim the device measured an hour
   * of air in the twenty seconds it took to hand it over.
   */
  observeBuffered(deviceTsSec: number | undefined, receivedAt?: number): number | null;

  /** True once a live frame has anchored the clock, so held readings can be flushed. */
  get anchored(): boolean;

  /** Forget the anchor. Call on disconnect: the next connection may be a different run of the
   *  device, and an anchor from the previous one would misdate every sample after it. */
  reset(): void;
}

export function createDeviceClock(): DeviceClock {
  let offsetMs: number | null = null;
  let lastTsSec: number | null = null;

  return {
    get anchored() {
      return offsetMs !== null;
    },

    observeLive(deviceTsSec, receivedAt = Date.now()) {
      // No usable uptime (an old firmware, or a malformed frame that still parsed). For a live
      // reading the arrival time IS the capture time to within the radio's latency, so use it
      // and leave the anchor alone rather than deriving an offset from nothing.
      if (!usableTs(deviceTsSec)) return receivedAt;

      const rebooted = lastTsSec !== null && deviceTsSec < lastTsSec - REBOOT_BACKSTEP_SEC;
      // A reading cannot have been captured after it arrived. If the anchor says otherwise it
      // was set from a frame that was itself delayed, and every reading since has been dated
      // into the future — which the backend reads as a NEGATIVE age and rejects as stale,
      // silently breaking live readings. Re-anchoring on the promptest frame seen so far fixes
      // that and keeps converging on the true offset.
      //
      // Deliberately one-sided. A symmetric "too far from now" guard would fire on exactly the
      // case this module exists for: when the device drains an hour of buffered samples, the
      // oldest is an hour older than its arrival. Reboots are caught above, by the only signal
      // that actually proves the anchor is void.
      const anchorIsLate = offsetMs !== null && offsetMs + deviceTsSec * 1000 > receivedAt;

      if (offsetMs === null || rebooted || anchorIsLate) {
        offsetMs = receivedAt - deviceTsSec * 1000;
      }
      lastTsSec = deviceTsSec;
      return offsetMs + deviceTsSec * 1000;
    },

    observeBuffered(deviceTsSec) {
      // Never touches the anchor, and never falls back to arrival time: a replayed reading with
      // no uptime cannot be placed in history at all, and dating it "now" would assert the
      // device measured it in the present. Better to hand back nothing than something false.
      if (offsetMs === null || !usableTs(deviceTsSec)) return null;
      return offsetMs + deviceTsSec * 1000;
    },

    reset() {
      offsetMs = null;
      lastTsSec = null;
    },
  };
}
