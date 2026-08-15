/**
 * Longdo Map rendered inside a WebView (works identically on Android + iOS).
 * The WebView's baseUrl is set to the production API domain so the browser's Referer header
 * matches the domain allow-list configured in the Longdo API key console.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { BASE_URL } from '../api/client';
import type { NodeMarker } from '../types';
import { colors, space, statusColor, type } from '../theme';

// Supplied at build time. There is deliberately no fallback value: a placeholder key loads a
// map that fails silently but still looks real, so an unconfigured key renders a notice instead.
const LONGDO_KEY = process.env.EXPO_PUBLIC_LONGDO_KEY || '';

function buildHtml(markers: NodeMarker[], center: { lat: number; lon: number } | null): string {
  const markerJs = markers
    .map((m) => {
      const color = statusColor(m.watch_label);
      const title = `${m.name || m.node_code} — ${m.watch_label}`.replace(/'/g, "\\'");
      return `map.Overlays.add(new longdo.Marker({lon:${m.lon},lat:${m.lat}},{title:'${title}',icon:{html:'<div style="width:14px;height:14px;border-radius:7px;background:${color};border:2px solid white"></div>'}}));`;
    })
    .join('\n');

  // Centre on the requested node, else on the first marker. Without this the map opens on
  // Longdo's own default view, which may not contain any of our nodes at all.
  const focus = center ?? (markers.length ? { lat: markers[0].lat, lon: markers[0].lon } : null);
  const centerJs = focus ? `map.location({lon:${focus.lon},lat:${focus.lat}}, true);` : '';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>html,body,#map{height:100%;margin:0;padding:0}</style>
  <script src="https://api.longdo.com/map/?key=${LONGDO_KEY}"></script>
  </head><body><div id="map"></div>
  <script>
    var map = new longdo.Map({placeholder: document.getElementById('map')});
    map.zoom(11);
    ${centerJs}
    ${markerJs}
  </script></body></html>`;
}

export function LongdoMap({ markers, center = null }: { markers: NodeMarker[]; center?: { lat: number; lon: number } | null }) {
  const html = useMemo(() => buildHtml(markers, center), [markers, center]);
  if (!LONGDO_KEY) {
    return (
      <View style={[styles.wrap, styles.notice]}>
        <Text style={styles.noticeText}>ยังไม่ได้ตั้งค่าคีย์แผนที่ (EXPO_PUBLIC_LONGDO_KEY)</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <WebView originWhitelist={['*']} source={{ html, baseUrl: BASE_URL }} style={styles.web} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  web: { flex: 1 },
  notice: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.unknownSoft, padding: space.lg },
  noticeText: { ...type.secondary, color: colors.textMuted, textAlign: 'center' },
});
