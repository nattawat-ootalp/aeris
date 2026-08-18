/** Shared portable-device state (BLE connection + latest telemetry) across screens. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Device } from 'react-native-ble-plx';
import {
  connectAndSubscribe,
  disconnect,
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
  /** Device health (firmware version, VOC-chip state) from the status characteristic. */
  status: PortableStatus | null;
  lastSeenAt: number | null;
  /** Most recent SOS press forwarded from the portable's button, or null. The provider only
   *  reports it — recording and the user's consent settings are handled by the SOS screen. */
  lastSos: PortableSos | null;
  clearSos: () => void;
  scanFailure: ScanFailureReason | null;
  /** Readings captured but not yet stored by the backend, plus any lost to the queue cap.
   *  Surfaced so the app can say the record is behind instead of quietly pretending it is not. */
  outbox: OutboxState;
  startPairing: () => void;
  stopPairing: () => void;
  disconnectDevice: () => void;
}

const Ctx = createContext<PortableCtx | null>(null);

export function PortableProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnState>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<PortableTelemetry | null>(null);
  const [status, setStatus] = useState<PortableStatus | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [lastSos, setLastSos] = useState<PortableSos | null>(null);
  const [scanFailure, setScanFailure] = useState<ScanFailureReason | null>(null);
  const [outbox, setOutbox] = useState<OutboxState>({ pending: 0, dropped: 0, syncing: false });
  const deviceRef = useRef<Device | null>(null);
  const stopScanRef = useRef<() => void>(() => {});
  // One anchor per provider, reset on disconnect: it maps the device's uptime counter onto real
  // time, and an anchor from a previous connection would misdate every sample of the next one.
  const clockRef = useRef(createDeviceClock());

  useEffect(() => {
    const unsubscribe = subscribeOutbox(setOutbox);
    // A backlog can outlive the app — readings buffered while the network was down are still
    // on disk from the last run, so try to hand them over before anything new arrives.
    void drainOutbox();
    return unsubscribe;
  }, []);

  const startPairing = useCallback(() => {
    setState('scanning');
    setScanFailure(null);
    scanForPortables(
      async (device) => {
        if (deviceRef.current) return; // already connecting/connected
        deviceRef.current = device;
        stopScanRef.current();
        setState('connecting');
        setDeviceName(device.name ?? device.id);
        setDeviceId(device.id);
        try {
          await connectAndSubscribe(
            device,
            (t) => {
              setTelemetry(t);
              setLastSeenAt(Date.now());
              // Queue for the backend rather than firing and forgetting: an upload that fails
              // used to lose the sample outright. The timestamp is when the DEVICE measured it,
              // reconstructed from its uptime counter — stamping "now" would be a lie for
              // anything that waits in the queue, and the whole backlog would collapse onto one
              // instant when it finally drains.
              enqueueReading({
                device_id: device.id,
                timestamp: new Date(clockRef.current.captureTime(t.ts)).toISOString(),
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
              });
            },
            () => {
              setState('disconnected');
              setTelemetry(null);
              setStatus(null);
              setDeviceId(null);
              deviceRef.current = null;
              clockRef.current.reset();
              // Whatever is still queued has nothing to do with the device being gone — push it
              // now that the radio work has stopped competing for the connection.
              void drainOutbox();
            },
            (s) => {
              setStatus(s);
              // Keep the registry row's firmware version current once the device reports it.
              registerDevice({
                external_id: device.id,
                kind: 'portable',
                label: device.name ?? undefined,
                fw_version: s.fw,
              }).catch(() => {});
            },
            (sos) => setLastSos(sos),
          );
          setState('connected');
          // Register on connect even if the status characteristic never answers, so the
          // device still appears in the user's device list.
          registerDevice({
            external_id: device.id,
            kind: 'portable',
            label: device.name ?? undefined,
          }).catch(() => {}); // best-effort; pairing must work fully offline
        } catch {
          setState('disconnected');
          setDeviceId(null);
          deviceRef.current = null;
        }
      },
      (reason) => {
        setScanFailure(reason);
        setState('disconnected');
      },
    ).then((stop) => {
      stopScanRef.current = stop;
    });
  }, []);

  const clearSos = useCallback(() => setLastSos(null), []);

  const stopPairing = useCallback(() => {
    stopScanRef.current();
    if (state === 'scanning') setState('disconnected');
  }, [state]);

  const disconnectDevice = useCallback(() => {
    if (deviceRef.current) disconnect(deviceRef.current);
    deviceRef.current = null;
    setState('disconnected');
    setTelemetry(null);
    setStatus(null);
    setDeviceId(null);
    clockRef.current.reset();
    void drainOutbox();
  }, []);

  return (
    <Ctx.Provider
      value={{ state, deviceName, deviceId, telemetry, status, lastSeenAt, lastSos, clearSos, scanFailure, outbox, startPairing, stopPairing, disconnectDevice }}
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
