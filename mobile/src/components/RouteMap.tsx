/**
 * §3.14 Exposure heat route — the walked path drawn on the Longdo map, coloured by reading.
 *
 * Built as its own component rather than as options on LongdoMap: that one places station
 * markers from a NodeMarker list, and folding a polyline into it would leave one component
 * doing two unrelated jobs with two half-used prop sets.
 *
 * The path is drawn segment by segment. A segment whose ends were not both measured is drawn
 * in the No Data grey, so an uncovered stretch reads as uncovered instead of inheriting the
 * colour of whichever measured point happened to be next to it.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { BASE_URL } from '../api/client';
import { colors, space, type } from '../theme';

const LONGDO_KEY = process.env.EXPO_PUBLIC_LONGDO_KEY || '';

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

function buildHtml(segments: RouteSegment[], stations: MapStation[]): string {
  const lineJs = segments
    .map(
      (s) =>
        `map.Overlays.add(new longdo.Polyline([{lon:${s.from.lon},lat:${s.from.lat}},` +
        `{lon:${s.to.lon},lat:${s.to.lat}}],{lineWidth:6,lineColor:'${s.color}'}));`,
    )
    .join('\n');

  const markerJs = stations
    .map((m) => {
      const title = `${m.name || m.node_code}`.replace(/'/g, "\\'");
      const color = m.color || colors.primary;
      return (
        `map.Overlays.add(new longdo.Marker({lon:${m.lon},lat:${m.lat}},{title:'${title}',` +
        `icon:{html:'<div style="width:12px;height:12px;border-radius:6px;background:${color};` +
        `border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>'}}));`
      );
    })
    .join('\n');

  // Fit the view to the drawn path. Without this the map opens on Longdo's default location,
  // which will not contain the route at all.
  const lats = segments.flatMap((s) => [s.from.lat, s.to.lat]);
  const lons = segments.flatMap((s) => [s.from.lon, s.to.lon]);
  const boundsJs = lats.length
    ? `map.bound({minLon:${Math.min(...lons)},minLat:${Math.min(...lats)},` +
      `maxLon:${Math.max(...lons)},maxLat:${Math.max(...lats)}});`
    : '';

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>html,body,#map{height:100%;margin:0;padding:0}</style>
  <script src="https://api.longdo.com/map/?key=${LONGDO_KEY}"></script>
  </head><body><div id="map"></div>
  <script>
    var map = new longdo.Map({placeholder: document.getElementById('map')});
    ${lineJs}
    ${markerJs}
    ${boundsJs}
  </script></body></html>`;
}

export function RouteMap({
  segments,
  stations = [],
  height = 320,
}: {
  segments: RouteSegment[];
  stations?: MapStation[];
  height?: number;
}) {
  const html = useMemo(() => buildHtml(segments, stations), [segments, stations]);

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
  return (
    <View style={[styles.wrap, { height }]}>
      <WebView originWhitelist={['*']} source={{ html, baseUrl: BASE_URL }} style={styles.web} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, overflow: 'hidden' },
  web: { flex: 1 },
  notice: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.unknownSoft, padding: space.lg },
  noticeText: { ...type.secondary, color: colors.textMuted, textAlign: 'center' },
});
