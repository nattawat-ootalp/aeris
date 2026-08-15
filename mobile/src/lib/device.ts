/**
 * Which device a screen should read backend history/decisions for, and how to label a live
 * local reading.
 *
 * Order of preference: the portable currently connected over BLE, then the most recently seen
 * device registered to this account, then whichever public station the backend currently ranks
 * first. No device id is hardcoded here — the last fallback is a live node fetched at runtime,
 * so a build never ships a station id that may since have gone offline or been renamed. When
 * none of the three resolve, the id is null and screens must render "No Data" rather than
 * request an invented device.
 */
import { useEffect, useState } from 'react';
import { getMyDevices, getRanking, getThresholds } from '../api/client';
import { usePortable } from '../state/portable';
import type { Thresholds, WatchStatus } from '../types';

/** Optional build-time override (EXPO_PUBLIC_DEFAULT_DEVICE_ID); empty unless configured. */
export const CONFIGURED_DEVICE_ID = process.env.EXPO_PUBLIC_DEFAULT_DEVICE_ID || null;

export function useActiveDeviceId(): string | null {
  const { deviceId } = usePortable();
  const [registered, setRegistered] = useState<string | null>(null);
  const [publicNode, setPublicNode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyDevices()
      .then((r) => {
        if (!cancelled) setRegistered(r.devices[0]?.external_id ?? null);
      })
      .catch(() => {}); // unauthenticated / offline — the fallbacks below still apply
    getRanking(1)
      .then((r) => {
        if (!cancelled) setPublicNode(r.ranking[0]?.node_code ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return deviceId ?? registered ?? CONFIGURED_DEVICE_ID ?? publicNode;
}

/** Thrown when a screen asks for device data before any device has resolved. */
export class NoDeviceError extends Error {
  constructor() {
    super('NO_DEVICE');
    this.name = 'NoDeviceError';
  }
}

/**
 * Run a device-scoped request, or reject with NoDeviceError when no device has resolved yet.
 * Screens surface that as an explicit "no device" state — never as a request against a
 * guessed or built-in device id.
 */
export function withDevice<T>(deviceId: string | null, run: (id: string) => Promise<T>): Promise<T> {
  if (!deviceId) return Promise.reject(new NoDeviceError());
  return run(deviceId);
}

export function useThresholds(): Thresholds | null {
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  useEffect(() => {
    let cancelled = false;
    getThresholds()
      .then((t) => {
        if (!cancelled) setThresholds(t);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return thresholds;
}

/**
 * Label a live local PM2.5 reading with the backend's own thresholds. Returns 'No Data' when
 * the value is missing or the thresholds have not been fetched yet — the app never invents a
 * status from a guessed boundary.
 */
export function watchStatusFor(pm25: number | null | undefined, thresholds: Thresholds | null): WatchStatus {
  if (pm25 == null || thresholds == null) return 'No Data';
  if (pm25 >= thresholds.pm25_high) return 'High';
  if (pm25 >= thresholds.pm25_caution) return 'Caution';
  return 'Normal';
}
