/**
 * Portable device BLE client (react-native-ble-plx). Implements docs/ble-contract.md.
 * Requires a dev client (not Expo Go) since it links native BLE code.
 */
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

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

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

export function scanForPortables(onFound: (device: Device) => void): () => void {
  const mgr = getManager();
  mgr.startDeviceScan([SERVICE_UUID], null, (error, device) => {
    if (error || !device) return;
    onFound(device);
  });
  return () => mgr.stopDeviceScan();
}

function decode(base64Value: string | null): Record<string, unknown> | null {
  if (!base64Value) return null;
  try {
    const json = Buffer.from(base64Value, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null; // malformed frame — treated as no data, never guessed
  }
}

export async function connectAndSubscribe(
  device: Device,
  onTelemetry: (t: PortableTelemetry) => void,
  onDisconnected: () => void,
): Promise<Subscription> {
  const connected = await device.connect();
  await connected.discoverAllServicesAndCharacteristics();

  connected.onDisconnected(() => onDisconnected());

  return connected.monitorCharacteristicForService(SERVICE_UUID, CHAR_TELEMETRY_UUID, (error, char) => {
    if (error || !char) return;
    const parsed = decode(char.value);
    if (!parsed) return;
    onTelemetry(parsed as unknown as PortableTelemetry);
  });
}

export function disconnect(device: Device) {
  device.cancelConnection().catch(() => {});
}
