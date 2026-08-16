/**
 * Web-preview stand-in for src/lib/ble.ts. `react-native-ble-plx` links native code and has
 * no web implementation, so this file (picked automatically by Metro for the web bundle)
 * keeps the same exported shape but never claims a device is connected.
 */
export const SERVICE_UUID = 'c1b0ae00-9e57-4a3d-9f2a-0e1a2b3c4d00';
export const CHAR_TELEMETRY_UUID = 'c1b0ae01-9e57-4a3d-9f2a-0e1a2b3c4d01';
export const CHAR_STATUS_UUID = 'c1b0ae02-9e57-4a3d-9f2a-0e1a2b3c4d02';
export const CHAR_SOS_UUID = 'c1b0ae04-9e57-4a3d-9f2a-0e1a2b3c4d04';

export interface PortableTelemetry {
  pm25?: number;
  temperature?: number;
  humidity?: number;
  /** TRUE CO2 from the SCD40 (NDIR), ppm. Omitted with the rest of the SCD40 block when that
   *  sensor is invalid. Distinct from `eco2` below — never treat the two as interchangeable. */
  co2?: number;
  /** Total VOC, ppb. OMITTED by the firmware while the SGP30 is warming up (15s) or invalid —
   *  `undefined` means no data; never render it as 0 or a stale prior value. */
  tvoc?: number;
  /** CO2-equivalent ESTIMATED from VOC sensing, ppm — NOT a direct CO2 measurement. OMITTED
   *  while the SGP30 is warming up or invalid; same no-data rule as `tvoc`. */
  eco2?: number;
  battery: number;
  /** Reflects PM sensor validity only — does NOT indicate SGP30/VOC health. */
  sensor_status: 'OK' | 'WARMUP' | 'ERROR';
  quality_score: number;
  ts: number;
}

export interface PortableStatus {
  battery?: number;
  sensor_status?: 'OK' | 'WARMUP' | 'ERROR';
  fw?: string;
  sgp30?: 'OK' | 'WARMUP' | 'ERROR';
}

export interface PortableSos {
  event: 'sos';
  ts: number;
}

export type ScanFailureReason = 'permission-denied' | 'bluetooth-off' | 'scan-error';

export async function requestBlePermissions(): Promise<boolean> {
  return false;
}

export async function isBluetoothPoweredOn(): Promise<boolean> {
  return false;
}

export async function scanForPortables(
  _onFound: (device: unknown) => void,
  onFailure: (reason: ScanFailureReason) => void,
): Promise<() => void> {
  console.warn('[ble.web] Bluetooth is not available in the web preview.');
  onFailure('scan-error');
  return () => {};
}

export async function connectAndSubscribe(
  _device: unknown,
  _onTelemetry: (t: PortableTelemetry) => void,
  _onDisconnected: () => void,
  _onStatus?: (s: PortableStatus) => void,
): Promise<{ remove: () => void }> {
  throw new Error('Bluetooth is not available in the web preview — use a dev-client build.');
}

export function disconnect(_device: unknown) {
  // no-op on web
}
