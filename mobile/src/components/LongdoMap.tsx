/**
 * Longdo Map rendered inside a WebView (works identically on Android + iOS).
 * The WebView's baseUrl is set to the production API domain so the browser's Referer header
 * matches the domain allow-list configured in the Longdo API key console.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { BASE_URL } from '../api/client';
import type { NodeMarker } from '../types';
import { statusColor } from '../theme';

const LONGDO_KEY = process.env.EXPO_PUBLIC_LONGDO_KEY || 'YOUR_LONGDO_KEY';

function buildHtml(markers: NodeMarker[]): string {
  const markerJs = markers
    .map((m) => {
      const color = statusColor(m.watch_label);
      const title = `${m.name || m.node_code} — ${m.watch_label}`.replace(/'/g, "\\'");
      return `map.Overlays.add(new longdo.Marker({lon:${m.lon},lat:${m.lat}},{title:'${title}',icon:{html:'<div style="width:14px;height:14px;border-radius:7px;background:${color};border:2px solid white"></div>'}}));`;
    })
    .join('\n');

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>html,body,#map{height:100%;margin:0;padding:0}</style>
  <script src="https://api.longdo.com/map/?key=${LONGDO_KEY}"></script>
  </head><body><div id="map"></div>
  <script>
    var map = new longdo.Map({placeholder: document.getElementById('map')});
    map.zoom(11);
    ${markerJs}
  </script></body></html>`;
}

export function LongdoMap({ markers }: { markers: NodeMarker[] }) {
  const html = useMemo(() => buildHtml(markers), [markers]);
  return (
    <View style={styles.wrap}>
      <WebView originWhitelist={['*']} source={{ html, baseUrl: BASE_URL }} style={styles.web} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  web: { flex: 1 },
});
