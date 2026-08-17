/**
 * Portable device BLE client (react-native-ble-plx). Implements docs/ble-contract.md.
 * Requires a dev client (not Expo Go) since it links native BLE code.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State as BleState, type Device, type Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

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

/** Device-status characteristic payload (docs/ble-contract.md). Reports the device's own
 *  health — deliberately separate from the environmental telemetry above. `sgp30` is the VOC
 *  chip's health, which `sensor_status` (PM-only) never reflects. */
export interface PortableStatus {
  battery?: number;
  sensor_status?: 'OK' | 'WARMUP' | 'ERROR';
  fw?: string;
  sgp30?: 'OK' | 'WARMUP' | 'ERROR';
}

/** SOS characteristic payload. The device reports only that the button was pressed and when —
 *  it carries no severity, classification or location (docs/ble-contract.md). */
export interface PortableSos {
  event: 'sos';
  ts: number;
}

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/**
 * Android 12+ (API 31+) requires BLUETOOTH_SCAN/BLUETOOTH_CONNECT as *runtime*
 * permissions — declaring them in the manifest alone lets scans fail silently.
 * Below API 31, BLE scanning instead requires (fine) location permission.
 */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function isBluetoothPoweredOn(): Promise<boolean> {
  const mgr = getManager();
  const s = await mgr.state();
  return s === BleState.PoweredOn;
}

/** 'unsupported' and 'cancelled' are only ever produced by the web implementation
 *  (src/lib/ble.web.ts) — a browser without Web Bluetooth, and a dismissed device chooser.
 *  The union is shared so both builds hand the UI the same vocabulary. */
export type ScanFailureReason =
  | 'permission-denied'
  | 'bluetooth-off'
  | 'scan-error'
  | 'unsupported'
  | 'cancelled';

export async function scanForPortables(
  onFound: (device: Device) => void,
  onFailure: (reason: ScanFailureReason) => void,
): Promise<() => void> {
  const granted = await requestBlePermissions();
  if (!granted) {
    onFailure('permission-denied');
    return () => {};
  }
  const mgr = getManager();
  const poweredOn = await isBluetoothPoweredOn();
  if (!poweredOn) {
    onFailure('bluetooth-off');
    return () => {};
  }
  mgr.startDeviceScan([SERVICE_UUID], null, (error, device) => {
    if (error) {
      onFailure('scan-error');
      return;
    }
    if (!device) return;
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
  onStatus?: (s: PortableStatus) => void,
  onSos?: (s: PortableSos) => void,
): Promise<Subscription> {
  const connected = await device.connect();
  // MTU defaults to 23 bytes (20-byte payload) which truncates the telemetry JSON —
  // request the larger MTU the firmware sizes its payload for (docs/ble-contract.md).
  try {
    await connected.requestMTU(185);
  } catch {
    // some platforms/peripherals reject renegotiation; firmware still keeps JSON <180 bytes
    // so this is a best-effort bump, not a hard requirement.
  }
  await connected.discoverAllServicesAndCharacteristics();

  connected.onDisconnected(() => onDisconnected());

  if (onStatus) {
    // Device status is a separate characteristic; read once so firmware version is known
    // immediately, then follow its notifications.
    connected
      .readCharacteristicForService(SERVICE_UUID, CHAR_STATUS_UUID)
      .then((char) => {
        const parsed = decode(char.value);
        if (parsed) onStatus(parsed as PortableStatus);
      })
      .catch(() => {}); // optional characteristic — absence is not an error
    connected.monitorCharacteristicForService(SERVICE_UUID, CHAR_STATUS_UUID, (error, char) => {
      if (error || !char) return;
      const parsed = decode(char.value);
      if (parsed) onStatus(parsed as PortableStatus);
    });
  }

  if (onSos) {
    // Subscribed alongside telemetry so a button press reaches the app the moment it happens.
    // Firmware emits one notification per press; the app decides what to record with it.
    connected.monitorCharacteristicForService(SERVICE_UUID, CHAR_SOS_UUID, (error, char) => {
      if (error || !char) return;
      const parsed = decode(char.value);
      if (parsed && parsed.event === 'sos') onSos(parsed as unknown as PortableSos);
    });
  }

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
