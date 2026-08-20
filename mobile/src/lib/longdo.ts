/**
 * Longdo Map SDK loader for the browser build.
 *
 * Only the web components import this (src/components/LongdoMap.web.tsx,
 * src/components/RouteMap.web.tsx), so it never enters the native bundle — on a phone the
 * same maps are hosted inside a WebView and load the SDK from the WebView document instead.
 *
 * The script is loaded once per document: every mount awaits the same promise, so navigating
 * between the station map and the route map neither appends the script again nor races a
 * half-initialised global.
 */

// Supplied at build time. There is deliberately no fallback value: a placeholder key loads a
// map that fails silently but still looks real, so an unconfigured key renders a notice instead.
export const LONGDO_KEY = process.env.EXPO_PUBLIC_LONGDO_KEY || '';

export interface LongdoPoint {
  lon: number;
  lat: number;
}

export interface LongdoBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface LongdoMapInstance {
  zoom(level: number): void;
  location(point: LongdoPoint, animate?: boolean): void;
  bound(bounds: LongdoBounds): void;
  Overlays: { add(overlay: unknown): void; clear(): void };
}

export interface LongdoGlobal {
  Map: new (options: { placeholder: HTMLElement }) => LongdoMapInstance;
  Marker: new (
    point: LongdoPoint,
    options: { title: string; icon: { html: string } },
  ) => unknown;
  Polyline: new (
    points: LongdoPoint[],
    options: { lineWidth: number; lineColor: string },
  ) => unknown;
}

function longdoGlobal(): LongdoGlobal | null {
  return (window as unknown as { longdo?: LongdoGlobal }).longdo ?? null;
}

let sdk: Promise<LongdoGlobal> | null = null;

export function loadLongdoSdk(): Promise<LongdoGlobal> {
  if (sdk) return sdk;
  sdk = new Promise<LongdoGlobal>((resolve, reject) => {
    const existing = longdoGlobal();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    // api.longdo.com is the map SDK itself rather than a configurable backend, which is why the
    // no-hardcode build guard allows this one host. Only the key comes from the environment.
    script.src = `https://api.longdo.com/map/?key=${encodeURIComponent(LONGDO_KEY)}`;
    script.async = true;
    script.onload = () => {
      const g = longdoGlobal();
      if (g) resolve(g);
      // A key the site's domain is not allow-listed for still returns 200 and still fires
      // onload — the script body throws instead of defining the global, so an unusable key
      // surfaces here rather than as a blank map.
      else reject(new Error('Longdo SDK loaded but exposed no global — check the key’s allowed domains'));
    };
    script.onerror = () => reject(new Error('Longdo SDK failed to load'));
    document.head.appendChild(script);
  }).catch((e) => {
    sdk = null; // let a later mount retry instead of caching the failure forever
    throw e;
  });
  return sdk;
}
