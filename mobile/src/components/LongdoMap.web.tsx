/**
 * Longdo Map in the browser. The native file (src/components/LongdoMap.tsx) hosts the same map
 * inside a WebView because react-native-webview has no web build — but a browser needs no
 * WebView, it already is one, so here the Longdo script is loaded into the page itself and the
 * map is mounted straight into the view's own DOM node. The SDK loader itself lives in
 * src/lib/longdo.ts, shared with the route map (src/components/RouteMap.web.tsx).
 *
 * The result matches the native one deliberately: same zoom, same centring rule, same coloured
 * dot per node, so the map a phone shows and the map a desktop shows are the same map.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LONGDO_KEY, loadLongdoSdk, type LongdoMapInstance } from '../lib/longdo';
import type { NodeMarker } from '../types';
import { colors, space, statusColor, type } from '../theme';

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
    loadLongdoSdk()
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
