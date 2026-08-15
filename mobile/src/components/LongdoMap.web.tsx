/**
 * Web-preview stand-in for src/components/LongdoMap.tsx. `react-native-webview` has no web
 * implementation, so this renders a plain placeholder in the browser preview instead.
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import type { NodeMarker } from '../types';

export function LongdoMap({ markers }: { markers: NodeMarker[]; center?: { lat: number; lon: number } | null }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>Map preview is available on Android/iOS — {markers.length} node(s) nearby</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 16, backgroundColor: colors.divider, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  text: { ...type.body, color: colors.textMuted, textAlign: 'center' },
});
