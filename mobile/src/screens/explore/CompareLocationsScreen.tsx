/** Screen 10 — Compare Locations. Quick comparison — never a "medically best" ranking. */
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { colors, space, statusColor, type } from '../../theme';
import type { WatchStatus } from '../../types';

const MOCK = [
  { name: 'Current location', pm25: 18, status: 'Normal' as WatchStatus, updated: '30s ago', distance: '0 km' },
  { name: 'Office', pm25: 34, status: 'Caution' as WatchStatus, updated: '2 min ago', distance: '4.2 km' },
  { name: 'Riverside park', pm25: 12, status: 'Normal' as WatchStatus, updated: '1 min ago', distance: '6.0 km' },
];

export function CompareLocationsScreen() {
  return (
    <Screen title="Compare" subtitle="ข้อมูลพื้นที่ล่าสุด">
      {MOCK.map((loc) => (
        <View key={loc.name} style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{loc.name}</Text>
            <Text style={styles.meta}>{loc.distance} · {loc.updated}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.status, { color: statusColor(loc.status) }]}>{loc.status}</Text>
            <Text style={styles.pm}>PM2.5 {loc.pm25}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.note}>Differences reflect the latest area readings, not a medical ranking.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md },
  name: { ...type.body, color: colors.text, fontWeight: '700' },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  status: { ...type.body, fontWeight: '700' },
  pm: { ...type.caption, color: colors.textMuted },
  note: { ...type.caption, color: colors.textMuted },
});
