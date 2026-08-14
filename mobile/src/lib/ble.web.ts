/**
 * Web-preview stand-in for src/lib/ble.ts. `react-native-ble-plx` links native code and has
 * no web implementation, so this file (picked automatically by Metro for the web bundle)
 * keeps the same exported shape but never claims a device is connected.
 */
export const SERVICE_UUID = 'c1b0ae00-9e57-4a3d-9f2a-0e1a2b3c4d00';
export const CHAR_TELEMETRY_UUID = 'c1b0ae01-9e57-4a3d-9f2a-0e1a2b3c4d01';
export const CHAR_STATUS_UUID = 'c1b0ae02-9e57-4a3d-9f2a-0e1a2b3c4d02';

export interface PortableTelemetry {
  pm25?: number;
  temperature?: number;
  humidity?: number;
  battery: number;
  sensor_status: 'OK' | 'WARMUP' | 'ERROR';
  quality_score: number;
  ts: number;
}

export function scanForPortables(_onFound: (device: unknown) => void): () => void {
  console.warn('[ble.web] Bluetooth is not available in the web preview.');
  return () => {};
}

export async function connectAndSubscribe(
  _device: unknown,
  _onTelemetry: (t: PortableTelemetry) => void,
  _onDisconnected: () => void,
): Promise<{ remove: () => void }> {
  throw new Error('Bluetooth is not available in the web preview — use a dev-client build.');
}

export function disconnect(_device: unknown) {
  // no-op on web
}
