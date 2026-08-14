/** Shared portable-device state (BLE connection + latest telemetry) across screens. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { Device } from 'react-native-ble-plx';
import { connectAndSubscribe, disconnect, scanForPortables, type PortableTelemetry } from '../lib/ble';
import { ingestPortable } from '../api/client';

type ConnState = 'disconnected' | 'scanning' | 'connecting' | 'connected';

interface PortableCtx {
  state: ConnState;
  deviceName: string | null;
  telemetry: PortableTelemetry | null;
  lastSeenAt: number | null;
  startPairing: () => void;
  stopPairing: () => void;
  disconnectDevice: () => void;
}

const Ctx = createContext<PortableCtx | null>(null);

export function PortableProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnState>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<PortableTelemetry | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const stopScanRef = useRef<() => void>(() => {});

  const startPairing = useCallback(() => {
    setState('scanning');
    stopScanRef.current = scanForPortables(async (device) => {
      if (deviceRef.current) return; // already connecting/connected
      deviceRef.current = device;
      stopScanRef.current();
      setState('connecting');
      setDeviceName(device.name ?? device.id);
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
              battery: t.battery,
              sensor_status: t.sensor_status,
              quality_score: t.quality_score,
            }).catch(() => {}); // best-effort; local display already updated
          },
          () => {
            setState('disconnected');
            setTelemetry(null);
            deviceRef.current = null;
          },
        );
        setState('connected');
      } catch {
        setState('disconnected');
        deviceRef.current = null;
      }
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
  }, []);

  return (
    <Ctx.Provider value={{ state, deviceName, telemetry, lastSeenAt, startPairing, stopPairing, disconnectDevice }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePortable(): PortableCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortable must be used within PortableProvider');
  return ctx;
}
