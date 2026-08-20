/** Shared portable-device state (BLE connection + latest telemetry) across screens. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Device } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  connectAndSubscribe,
  disconnect,
  findKnownPortable,
  portableDeviceId,
  scanForPortables,
  type PortableSos,
  type PortableStatus,
  type PortableTelemetry,
  type ScanFailureReason,
} from '../lib/ble';
import { createDeviceClock } from '../lib/deviceClock';
import { drainOutbox, enqueueReading, subscribeOutbox, type OutboxState } from '../lib/outbox';
import { registerDevice } from '../api/client';

type ConnState = 'disconnected' | 'scanning' | 'connecting' | 'connected';

interface PortableCtx {
  state: ConnState;
  deviceName: string | null;
  deviceId: string | null;
  telemetry: PortableTelemetry | null;
  /** When the device MEASURED the reading above, in epoch ms — reconstructed from its uptime
   *  counter by the device clock. `telemetry.ts` itself is seconds since the device booted and
   *  is not a date; reading it as one shows a time in 1970. */
  telemetryAt: number | null;
  /** Device health (firmware version, VOC-chip state) from the status characteristic. */
  status: PortableStatus | null;
  lastSeenAt: number | null;
  /** Most recent SOS press forwarded from the portable's button, or null. The provider only
   *  reports it — recording and the user's consent settings are handled by the SOS screen. */
  lastSos: PortableSos | null;
  clearSos: () => void;
  scanFailure: ScanFailureReason | null;
  /** The portable paired last, by name, while nothing is connected — null once it is. Browsers
   *  that cannot list already-granted devices (Chrome hides getDevices() behind a flag) cannot
   *  be reconnected without a click, so the app offers that click by name rather than leaving
   *  the user to walk back through pairing from scratch. */
  lastDeviceName: string | null;
  /** Readings captured but not yet stored by the backend, plus any lost to the queue cap.
   *  Surfaced so the app can say the record is behind instead of quietly pretending it is not. */
  outbox: OutboxState;
  startPairing: () => void;
  stopPairing: () => void;
  disconnectDevice: () => void;
}

const Ctx = createContext<PortableCtx | null>(null);

/** Device readings the firmware replayed before any live frame had anchored the clock. Bounded
 *  at the firmware ring's own capacity — holding more than the device can buffer would mean
 *  holding readings that cannot exist. */
const MAX_HELD_REPLAYS = 720;

/** Which portable was connected last. Reloading the website destroys every JS object, the
 *  connected device among them, so without a note of which device it was a refresh would leave
 *  the user to walk back through the pairing chooser by hand. Cleared only when the user
 *  disconnects deliberately — an unexpected drop is exactly the case worth reconnecting from. */
const LAST_DEVICE_KEY = 'aeris.portable.last-device-id';
/** The name of that device, kept beside the id so the app can offer to reconnect to it by
 *  name even where it cannot do so on its own — see `lastDeviceName` below. */
const LAST_DEVICE_NAME_KEY = 'aeris.portable.last-device-name';

function toIngestPayload(deviceId: string, t: PortableTelemetry, capturedAt: number) {
  return {
    device_id: deviceId,
    timestamp: new Date(capturedAt).toISOString(),
    pm25: t.pm25,
    temperature: t.temperature,
    humidity: t.humidity,
    // undefined stays undefined here (JSON.stringify drops the key) so an absent
    // SGP30 reading is omitted from the request, never coerced to 0/null.
    co2: t.co2,
    tvoc: t.tvoc,
    eco2: t.eco2,
    battery: t.battery,
    sensor_status: t.sensor_status,
    quality_score: t.quality_score,
  };
}

export function PortableProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnState>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<PortableTelemetry | null>(null);
  const [telemetryAt, setTelemetryAt] = useState<number | null>(null);
  const [status, setStatus] = useState<PortableStatus | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [lastSos, setLastSos] = useState<PortableSos | null>(null);
  const [scanFailure, setScanFailure] = useState<ScanFailureReason | null>(null);
  const [lastDeviceName, setLastDeviceName] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxState>({ pending: 0, dropped: 0, syncing: false });
  const deviceRef = useRef<Device | null>(null);
  const stopScanRef = useRef<() => void>(() => {});
  // One anchor per provider, reset on disconnect: it maps the device's uptime counter onto real
  // time, and an anchor from a previous connection would misdate every sample of the next one.
  const clockRef = useRef(createDeviceClock());
  // The firmware starts replaying its buffer shortly after connect, usually BEFORE the next
  // live sample is due — so the first frames of a reconnection are typically replayed ones,
  // arriving while the clock still has no anchor. They are held here rather than dated from
  // their arrival, which would compress the whole backlog into the seconds it took to transfer.
  const heldReplaysRef = useRef<PortableTelemetry[]>([]);

  const queueBuffered = useCallback((deviceId: string, t: PortableTelemetry) => {
    const capturedAt = clockRef.current.observeBuffered(t.ts);
    if (capturedAt !== null) {
      enqueueReading(toIngestPayload(deviceId, t, capturedAt));
      return;
    }
    heldReplaysRef.current.push(t);
    if (heldReplaysRef.current.length > MAX_HELD_REPLAYS) heldReplaysRef.current.shift();
  }, []);

  const flushHeldReplays = useCallback((deviceId: string) => {
    const held = heldReplaysRef.current;
    if (held.length === 0) return;
    heldReplaysRef.current = [];
    for (const t of held) {
      const capturedAt = clockRef.current.observeBuffered(t.ts);
      // Still undatable means the frame carried no usable uptime. Dating it "now" would assert
      // the device measured it in the present, so it is dropped instead of falsified.
      if (capturedAt !== null) enqueueReading(toIngestPayload(deviceId, t, capturedAt));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOutbox(setOutbox);
    // A backlog can outlive the app — readings buffered while the network was down are still
    // on disk from the last run, so try to hand them over before anything new arrives.
    void drainOutbox();
    return unsubscribe;
  }, []);

  const attachDevice = useCallback(async (device: Device) => {
    if (deviceRef.current) return; // already connecting/connected
    // One spelling of the id for the whole session: what is stored with the readings is what
    // every later query asks for (src/lib/ble.ts, src/lib/ble.web.ts).
    const id = portableDeviceId(device);
    deviceRef.current = device;
    stopScanRef.current();
    setState('connecting');
    setDeviceName(device.name ?? id);
    setDeviceId(id);
    try {
      await connectAndSubscribe(
        device,
        (t) => {
          // A replayed sample describes the air at some earlier moment, so it must not
          // become the reading on screen — that would show the user a measurement from
          // half an hour ago as if it were the room they are standing in. It is still
          // real data and still belongs in the record, so it goes to the backend either way.
          if (t.buf) {
            queueBuffered(id, t);
            return;
          }
          setTelemetry(t);
          setLastSeenAt(Date.now());
          // Dated once, here, from the same anchor the stored reading uses — so what the card
          // says and what the record says are the same moment.
          const capturedAt = clockRef.current.observeLive(t.ts);
          setTelemetryAt(capturedAt);
          // Queue for the backend rather than firing and forgetting: an upload that fails
          // used to lose the sample outright. The timestamp is when the DEVICE measured it,
          // reconstructed from its uptime counter — stamping "now" would be a lie for
          // anything that waits in the queue, and the whole backlog would collapse onto one
          // instant when it finally drains.
          enqueueReading(toIngestPayload(id, t, capturedAt));
          // This live frame is what anchors the clock, so anything the device replayed
          // before it can finally be placed in time.
          flushHeldReplays(id);
        },
        () => {
          setState('disconnected');
          setTelemetry(null);
          setTelemetryAt(null);
          setStatus(null);
          setDeviceId(null);
          deviceRef.current = null;
          clockRef.current.reset();
          heldReplaysRef.current = [];
          // Whatever is still queued has nothing to do with the device being gone — push it
          // now that the radio work has stopped competing for the connection.
          void drainOutbox();
        },
        (s) => {
          setStatus(s);
          // Keep the registry row's firmware version current once the device reports it.
          registerDevice({
            external_id: id,
            kind: 'portable',
            label: device.name ?? undefined,
            fw_version: s.fw,
          }).catch(() => {});
        },
        (sos) => setLastSos(sos),
      );
      setState('connected');
      // Remembered only after the connection is up: an id that never connected would send
      // every later start into a reconnection attempt that cannot succeed.
      void AsyncStorage.setItem(LAST_DEVICE_KEY, id);
      void AsyncStorage.setItem(LAST_DEVICE_NAME_KEY, device.name ?? id);
      setLastDeviceName(null); // connected: there is nothing to offer reconnecting to
      // Register on connect even if the status characteristic never answers, so the
      // device still appears in the user's device list.
      registerDevice({
        external_id: id,
        kind: 'portable',
        label: device.name ?? undefined,
      }).catch(() => {}); // best-effort; pairing must work fully offline
    } catch {
      setState('disconnected');
      setDeviceId(null);
      deviceRef.current = null;
    }
  }, [queueBuffered, flushHeldReplays]);

  const startPairing = useCallback(() => {
    setState('scanning');
    setScanFailure(null);
    scanForPortables(attachDevice, (reason) => {
      setScanFailure(reason);
      setState('disconnected');
    }).then((stop) => {
      stopScanRef.current = stop;
    });
  }, [attachDevice]);

  // Reconnect to the last portable when the app starts — which on the website means after
  // every reload. The platform only offers devices the user has already granted (Web
  // Bluetooth's getDevices(), the OS cache on a phone), so this reconnects to a device the
  // user chose earlier and never silently pairs a new one. When the device is out of range,
  // switched off, or the browser cannot list it, the attempt fails and the app stays
  // disconnected exactly as before — pairing by hand is still there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lastId = await AsyncStorage.getItem(LAST_DEVICE_KEY);
      if (!lastId || cancelled || deviceRef.current) return;
      const device = await findKnownPortable(lastId);
      if (!device || cancelled || deviceRef.current) {
        // Nothing to reconnect to silently. Surface the name so the UI can offer the one click
        // the browser insists on, instead of the app looking like it forgot the device.
        if (!cancelled) setLastDeviceName(await AsyncStorage.getItem(LAST_DEVICE_NAME_KEY));
        return;
      }
      await attachDevice(device);
    })().catch(() => {
      // Nothing to report: no reconnection is the state the app already shows.
    });
    return () => {
      cancelled = true;
    };
  }, [attachDevice]);

  const clearSos = useCallback(() => setLastSos(null), []);

  const stopPairing = useCallback(() => {
    stopScanRef.current();
    if (state === 'scanning') setState('disconnected');
  }, [state]);

  const disconnectDevice = useCallback(() => {
    // A deliberate disconnect ends the pairing: forget the device so the next start does not
    // reconnect to the one the user just put down.
    void AsyncStorage.removeItem(LAST_DEVICE_KEY);
    void AsyncStorage.removeItem(LAST_DEVICE_NAME_KEY);
    setLastDeviceName(null);
    if (deviceRef.current) disconnect(deviceRef.current);
    deviceRef.current = null;
    setState('disconnected');
    setTelemetry(null);
    setTelemetryAt(null);
    setStatus(null);
    setDeviceId(null);
    clockRef.current.reset();
    heldReplaysRef.current = [];
    void drainOutbox();
  }, []);

  return (
    <Ctx.Provider
      value={{ state, deviceName, deviceId, telemetry, telemetryAt, status, lastSeenAt, lastSos, clearSos, scanFailure, lastDeviceName, outbox, startPairing, stopPairing, disconnectDevice }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function usePortable(): PortableCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortable must be used within PortableProvider');
  return ctx;
}
