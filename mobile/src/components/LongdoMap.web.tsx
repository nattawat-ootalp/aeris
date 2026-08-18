/**
 * Longdo Map in the browser. The native file (src/components/LongdoMap.tsx) hosts the same map
 * inside a WebView because react-native-webview has no web build — but a browser needs no
 * WebView, it already is one, so here the Longdo script is loaded into the page itself and the
 * map is mounted straight into the view's own DOM node.
 *
 * The result matches the native one deliberately: same zoom, same centring rule, same coloured
 * dot per node, so the map a phone shows and the map a desktop shows are the same map.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NodeMarker } from '../types';
import { colors, space, statusColor, type } from '../theme';

// Supplied at build time. There is deliberately no fallback value: a placeholder key loads a
// map that fails silently but still looks real, so an unconfigured key renders a notice instead.
const LONGDO_KEY = process.env.EXPO_PUBLIC_LONGDO_KEY || '';

interface LongdoMapInstance {
  zoom(level: number): void;
  location(point: { lon: number; lat: number }, animate?: boolean): void;
  Overlays: { add(overlay: unknown): void; clear(): void };
}
interface LongdoGlobal {
  Map: new (options: { placeholder: HTMLElement }) => LongdoMapInstance;
  Marker: new (
    point: { lon: number; lat: number },
    options: { title: string; icon: { html: string } },
  ) => unknown;
}

function longdoGlobal(): LongdoGlobal | null {
  return (window as unknown as { longdo?: LongdoGlobal }).longdo ?? null;
}

/**
 * Load the Longdo SDK once per document. Every mount awaits the same promise, so navigating
 * between screens neither appends the script again nor races a half-initialised global.
 */
let sdk: Promise<LongdoGlobal> | null = null;
function loadSdk(): Promise<LongdoGlobal> {
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
      else reject(new Error('Longdo SDK loaded but exposed no global'));
    };
    script.onerror = () => reject(new Error('Longdo SDK failed to load'));
    document.head.appendChild(script);
  }).catch((e) => {
    sdk = null; // let a later mount retry instead of caching the failure forever
    throw e;
  });
  return sdk;
}

export function LongdoMap({ markers, center = null }: { markers: NodeMarker[]; center?: { lat: number; lon: number } | null }) {
  // react-native-web renders View as a div, so this ref is the DOM node Longdo mounts into.
  const holder = useRef<View | null>(null);
  const map = useRef<LongdoMapInstance | null>(null);
  const [failed, setFailed] = useState(false);

  // Centre on the requested node, else on the first marker. Without this the map opens on
  // Longdo's own default view, which may not contain any of our nodes at all.
  const focus = useMemo(
    () => center ?? (markers.length ? { lat: markers[0].lat, lon: markers[0].lon } : null),
    [center, markers],
  );

  useEffect(() => {
    if (!LONGDO_KEY) return;
    let cancelled = false;
    loadSdk()
      .then((longdo) => {
        const node = holder.current as unknown as HTMLElement | null;
        if (cancelled || !node) return;
        if (!map.current) {
          map.current = new longdo.Map({ placeholder: node });
          map.current.zoom(11);
        }
        // Overlays are rebuilt wholesale: the marker list is small and always arrives complete,
        // so diffing it would add state without saving work.
        map.current.Overlays.clear();
        for (const m of markers) {
          const color = statusColor(m.watch_label);
          map.current.Overlays.add(
            new longdo.Marker(
              { lon: m.lon, lat: m.lat },
              {
                title: `${m.name || m.node_code} — ${m.watch_label}`,
                icon: { html: `<div style="width:14px;height:14px;border-radius:7px;background:${color};border:2px solid white"></div>` },
              },
            ),
          );
        }
        if (focus) map.current.location({ lon: focus.lon, lat: focus.lat }, true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [markers, focus]);

  if (!LONGDO_KEY) {
    return (
      <View style={[styles.wrap, styles.notice]}>
        <Text style={styles.noticeText}>ยังไม่ได้ตั้งค่าคีย์แผนที่ (EXPO_PUBLIC_LONGDO_KEY)</Text>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.wrap, styles.notice]}>
        <Text style={styles.noticeText}>โหลดแผนที่ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อและโดเมนที่อนุญาตของคีย์</Text>
      </View>
    );
  }
  return <View ref={holder} style={styles.wrap} />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  notice: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.unknownSoft, padding: space.lg },
  noticeText: { ...type.secondary, color: colors.textMuted, textAlign: 'center' },
});
