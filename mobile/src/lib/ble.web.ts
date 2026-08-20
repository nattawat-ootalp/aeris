/**
 * Web implementation of src/lib/ble.ts, on the browser's Web Bluetooth API.
 *
 * `react-native-ble-plx` links native code and has no web build, so Metro picks this file for
 * the web bundle. It keeps the same exported shape and speaks the same GATT contract
 * (docs/ble-contract.md) — the same portable, the same service, the same three
 * characteristics — so state/portable.tsx does not know which one it is talking to.
 *
 * Three differences are forced by the platform and cannot be papered over:
 *   * There is no free-running scan. `navigator.bluetooth.requestDevice()` opens the browser's
 *     own chooser and resolves with the single device the user picked, so `scanForPortables`
 *     reports one device and then stops.
 *   * The chooser needs transient user activation, which is why `requestDevice` is reached
 *     before any `await` below — awaiting first can spend the activation and make it throw.
 *   * MTU is negotiated by the browser; there is no requestMTU(). The firmware keeps each
 *     JSON frame under 180 bytes, which every current implementation carries.
 *
 * Not available in every browser: Chrome and Edge implement Web Bluetooth on desktop and
 * Android, Safari does not implement it at all, so iPhone and iPad report 'unsupported'.
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

export type ScanFailureReason =
  | 'permission-denied'
  | 'bluetooth-off'
  | 'scan-error'
  | 'unsupported'
  | 'cancelled'
  | 'blocked-by-policy';

// ── Minimal Web Bluetooth types ──
// Declared here rather than pulled from @types/web-bluetooth: the API is used in exactly this
// file, and a devDependency that only types four calls is not worth carrying.
interface WebBleCharacteristic extends EventTarget {
  value?: DataView;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<WebBleCharacteristic>;
}
interface WebBleService {
  getCharacteristic(uuid: string): Promise<WebBleCharacteristic>;
}
interface WebBleServer {
  connected: boolean;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<WebBleService>;
}
export interface WebBleDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: WebBleServer & { connect(): Promise<WebBleServer> };
}
interface WebBluetooth {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<WebBleDevice>;
  getAvailability?: () => Promise<boolean>;
  /** Devices this origin has already been granted, kept across reloads. Optional: it is a
   *  later addition to the API than requestDevice, and a browser without it simply cannot
   *  reconnect silently. */
  getDevices?: () => Promise<WebBleDevice[]>;
}

function bluetooth(): WebBluetooth | null {
  const nav = navigator as unknown as { bluetooth?: WebBluetooth };
  return nav.bluetooth ?? null;
}

/** No separate permission step on the web: the chooser IS the permission prompt, and the
 *  browser grants access to the one device the user picks in it. */
export async function requestBlePermissions(): Promise<boolean> {
  return bluetooth() != null;
}

/** `getAvailability()` reports whether the machine has a usable radio at all. It is optional
 *  in the spec, so an implementation without it is assumed available and left to fail later
 *  with a real error rather than a guessed one. */
export async function isBluetoothPoweredOn(): Promise<boolean> {
  const ble = bluetooth();
  if (!ble) return false;
  if (!ble.getAvailability) return true;
  try {
    return await ble.getAvailability();
  } catch {
    return true;
  }
}

export async function scanForPortables(
  onFound: (device: WebBleDevice) => void,
  onFailure: (reason: ScanFailureReason) => void,
): Promise<() => void> {
  const ble = bluetooth();
  if (!ble) {
    onFailure('unsupported');
    return () => {};
  }
  // Called before this function awaits anything — see the user-activation note at the top.
  let pending: Promise<WebBleDevice>;
  try {
    pending = ble.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
  } catch {
    onFailure('scan-error');
    return () => {};
  }

  let abandoned = false;
  pending
    .then((device) => {
      if (!abandoned) onFound(device);
    })
    .catch(async (e: unknown) => {
      if (abandoned) return;
      const name = e instanceof Error ? e.name : '';
      // NotFoundError covers both "user closed the chooser" and "nothing matched the filter".
      // The radio check separates a dismissed dialog from a machine that cannot scan at all.
      if (name === 'NotFoundError') {
        onFailure((await isBluetoothPoweredOn()) ? 'cancelled' : 'bluetooth-off');
        return;
      }
      // A Permissions-Policy block and a real refusal are both SecurityError, and telling
      // a user to change a phone setting when the site's own header is at fault sends them
      // somewhere that cannot help. Separate the two so the message can say which it is.
      const msg = e instanceof Error ? e.message : '';
      if (/permissions policy/i.test(msg)) {
        onFailure('blocked-by-policy');
        return;
      }
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        onFailure('permission-denied');
        return;
      }
      onFailure('scan-error');
    });

  // The chooser cannot be closed from script; abandoning stops its result being delivered.
  return () => {
    abandoned = true;
  };
}

/**
 * The id this app uses for a portable, everywhere: in the ingested reading, in the device
 * registry, and in the path of every later query about it.
 *
 * Web Bluetooth ids are base64, so they can contain `+` and `/`. A `/` cannot survive inside a
 * URL path segment — percent-encoded or not, the request is normalised on the way in and
 * reaches the API as a route that does not exist, which is why every device-scoped screen
 * (today's summary, weekly history, baseline, pattern) came back "could not load" in a browser
 * while the same screens worked on Android, where the id is a MAC address. Mapping to the
 * URL-safe base64 alphabet keeps the id unique and makes it a legal path segment.
 */
export function portableDeviceId(device: WebBleDevice): string {
  return device.id.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * The device this origin already has permission for, by id — or null when the browser cannot
 * say. Reloading a page destroys every JS object, including the connected BLEDevice, so
 * without this a refresh drops the portable and only a new trip through the chooser (which
 * needs a click) could bring it back. `getDevices()` returns the granted devices instead, so
 * a reload can reconnect on its own.
 *
 * Null covers three cases the caller treats alike: no Web Bluetooth, a browser that does not
 * implement getDevices(), and a permission the user has since revoked.
 */
export async function findKnownPortable(deviceId: string): Promise<WebBleDevice | null> {
  const ble = bluetooth();
  if (!ble?.getDevices) return null;
  try {
    const devices = await ble.getDevices();
    return devices.find((d) => portableDeviceId(d) === deviceId) ?? null;
  } catch {
    return null;
  }
}

function decode(value: DataView | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(new TextDecoder().decode(value));
  } catch {
    return null; // malformed frame — treated as no data, never guessed
  }
}

export async function connectAndSubscribe(
  device: WebBleDevice,
  onTelemetry: (t: PortableTelemetry) => void,
  onDisconnected: () => void,
  onStatus?: (s: PortableStatus) => void,
  onSos?: (s: PortableSos) => void,
): Promise<{ remove: () => void }> {
  if (!device.gatt) throw new Error('Device exposes no GATT server');
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);

  const onGattDisconnected = () => onDisconnected();
  device.addEventListener('gattserverdisconnected', onGattDisconnected);

  const listeners: { char: WebBleCharacteristic; fn: EventListener }[] = [];

  async function subscribe(uuid: string, handle: (parsed: Record<string, unknown>) => void) {
    const char = await service.getCharacteristic(uuid);
    const fn: EventListener = (event) => {
      const parsed = decode((event.target as WebBleCharacteristic).value);
      if (parsed) handle(parsed);
    };
    char.addEventListener('characteristicvaluechanged', fn);
    listeners.push({ char, fn });
    await char.startNotifications();
    return char;
  }

  // Telemetry first, and read before subscribing to anything optional. The firmware notifies
  // every 5 s but keeps the latest reading readable between notifications, so reading it here
  // puts a value on screen at once instead of leaving the card empty for up to a full
  // interval — and doing it before the status and SOS handshakes keeps those from adding
  // their own round trips to that wait.
  const telemetryChar = await subscribe(CHAR_TELEMETRY_UUID, (p) => onTelemetry(p as unknown as PortableTelemetry));
  try {
    const current = decode(await telemetryChar.readValue());
    if (current) onTelemetry(current as unknown as PortableTelemetry);
  } catch {
    /* older firmware may not allow reads — the next notification carries the same reading */
  }

  if (onStatus) {
    // Read once so the firmware version is known immediately, then follow notifications.
    // Optional characteristic — its absence is not an error.
    try {
      const char = await subscribe(CHAR_STATUS_UUID, (p) => onStatus(p as unknown as PortableStatus));
      const first = decode(await char.readValue());
      if (first) onStatus(first as unknown as PortableStatus);
    } catch {
      /* not implemented by this firmware build */
    }
  }

  if (onSos) {
    try {
      await subscribe(CHAR_SOS_UUID, (p) => {
        if (p.event === 'sos') onSos(p as unknown as PortableSos);
      });
    } catch {
      /* not implemented by this firmware build */
    }
  }

  return {
    remove: () => {
      device.removeEventListener('gattserverdisconnected', onGattDisconnected);
      for (const { char, fn } of listeners) char.removeEventListener('characteristicvaluechanged', fn);
    },
  };
}

export function disconnect(device: WebBleDevice) {
  if (device.gatt?.connected) device.gatt.disconnect();
}
