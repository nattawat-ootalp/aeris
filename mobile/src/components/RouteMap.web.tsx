/**
 * Web build of src/components/RouteMap.tsx — same heat route, same colours, no WebView.
 *
 * The native file hosts the Longdo map inside a `react-native-webview`, which has no web
 * build: rendered in a browser it throws "React Native WebView does not support this
 * platform" and the Route Exposure Simulator loses its map entirely. A browser needs no
 * WebView, so here the Longdo SDK is loaded into the page and the overlays are added to a map
 * mounted in the view's own DOM node — the same approach LongdoMap.web.tsx already takes for
 * the station map, and the same SDK loader is shared with it (src/lib/longdo.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LONGDO_KEY, loadLongdoSdk, type LongdoMapInstance } from '../lib/longdo';
import { colors, space, type } from '../theme';

export type RouteSegment = {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  color: string;
};

export type MapStation = {
  node_code: string;
  name: string;
  lat: number;
  lon: number;
  color?: string;
};

export function RouteMap({
  segments,
  stations = [],
  height = 320,
}: {
  segments: RouteSegment[];
  stations?: MapStation[];
  height?: number;
}) {
  // react-native-web renders View as a div, so this ref is the DOM node Longdo mounts into.
  const holder = useRef<View | null>(null);
  const map = useRef<LongdoMapInstance | null>(null);
  const [failed, setFailed] = useState(false);

  // Fit the view to the drawn path. Without this the map opens on Longdo's default location,
  // which will not contain the route at all.
  const bounds = useMemo(() => {
    const lats = segments.flatMap((s) => [s.from.lat, s.to.lat]);
    const lons = segments.flatMap((s) => [s.from.lon, s.to.lon]);
    if (!lats.length) return null;
    return {
      minLon: Math.min(...lons),
      minLat: Math.min(...lats),
      maxLon: Math.max(...lons),
      maxLat: Math.max(...lats),
    };
  }, [segments]);

  useEffect(() => {
    if (!LONGDO_KEY || !segments.length) return;
    let cancelled = false;
    loadLongdoSdk()
      .then((longdo) => {
        const node = holder.current as unknown as HTMLElement | null;
        if (cancelled || !node) return;
        if (!map.current) map.current = new longdo.Map({ placeholder: node });
        // Overlays are rebuilt wholesale: a simulated route is small and always arrives
        // complete, so diffing it would add state without saving work.
        map.current.Overlays.clear();
        for (const s of segments) {
          map.current.Overlays.add(
            new longdo.Polyline(
              [
                { lon: s.from.lon, lat: s.from.lat },
                { lon: s.to.lon, lat: s.to.lat },
              ],
              { lineWidth: 6, lineColor: s.color },
            ),
          );
        }
        for (const m of stations) {
          map.current.Overlays.add(
            new longdo.Marker(
              { lon: m.lon, lat: m.lat },
              {
                title: `${m.name || m.node_code}`,
                icon: {
                  html: `<div style="width:12px;height:12px;border-radius:6px;background:${m.color || colors.primary};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
                },
              },
            ),
          );
        }
        if (bounds) map.current.bound(bounds);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [segments, stations, bounds]);

  if (!LONGDO_KEY) {
    return (
      <View style={[styles.wrap, styles.notice, { height }]}>
        <Text style={styles.noticeText}>ยังไม่ได้ตั้งค่าคีย์แผนที่ (EXPO_PUBLIC_LONGDO_KEY)</Text>
      </View>
    );
  }
  if (!segments.length) {
    return (
      <View style={[styles.wrap, styles.notice, { height }]}>
        <Text style={styles.noticeText}>ยังไม่มีเส้นทางให้แสดง</Text>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.wrap, styles.notice, { height }]}>
        <Text style={styles.noticeText}>โหลดแผนที่ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อและโดเมนที่อนุญาตของคีย์</Text>
      </View>
    );
  }
  return <View ref={holder} style={[styles.wrap, { height }]} />;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden' },
  notice: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.unknownSoft, padding: space.lg },
  noticeText: { ...type.secondary, color: colors.textMuted, textAlign: 'center' },
});
