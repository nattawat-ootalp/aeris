/** Shared portable-device state (BLE connection + latest telemetry) across screens. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { Device } from 'react-native-ble-plx';
import {
  connectAndSubscribe,
  disconnect,
  scanForPortables,
  type PortableStatus,
  type PortableTelemetry,
  type ScanFailureReason,
} from '../lib/ble';
import { ingestPortable, registerDevice } from '../api/client';

type ConnState = 'disconnected' | 'scanning' | 'connecting' | 'connected';

interface PortableCtx {
  state: ConnState;
  deviceName: string | null;
  deviceId: string | null;
  telemetry: PortableTelemetry | null;
  /** Device health (firmware version, VOC-chip state) from the status characteristic. */
  status: PortableStatus | null;
  lastSeenAt: number | null;
  scanFailure: ScanFailureReason | null;
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
  const [scanFailure, setScanFailure] = useState<ScanFailureReason | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const stopScanRef = useRef<() => void>(() => {});

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
              // forward to backend for history/decision; device_id = the BLE device id
              ingestPortable({
                device_id: device.id,
                timestamp: new Date().toISOString(),
                pm25: t.pm25,
                temperature: t.temperature,
                humidity: t.humidity,
                // undefined stays undefined here (JSON.stringify drops the key) so an absent
                // SGP30 reading is omitted from the request, never coerced to 0/null.
                tvoc: t.tvoc,
                eco2: t.eco2,
                battery: t.battery,
                sensor_status: t.sensor_status,
                quality_score: t.quality_score,
              }).catch(() => {}); // best-effort; local display already updated
            },
            () => {
              setState('disconnected');
              setTelemetry(null);
              setStatus(null);
              setDeviceId(null);
              deviceRef.current = null;
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
  }, []);

  return (
    <Ctx.Provider
      value={{ state, deviceName, deviceId, telemetry, status, lastSeenAt, scanFailure, startPairing, stopPairing, disconnectDevice }}
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
