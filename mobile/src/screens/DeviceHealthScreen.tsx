/** Device Health (MVP) — battery/sensor/firmware. Kept SEPARATE from environmental status (§3.2/§14). */
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { colors, space } from '../theme';

type Row = { label: string; value: string; ok: boolean };

// scaffold values; a real app fills these from the device/BLE + /nodes/{id}/telemetry health fields
const ROWS: Row[] = [
  { label: 'Battery', value: '82%', ok: true },
  { label: 'PM sensor', value: 'OK', ok: true },
  { label: 'T/RH sensor', value: 'OK', ok: true },
  { label: 'Firmware', value: 'v1.0.0', ok: true },
  { label: 'Last sync', value: '30s ago', ok: true },
];

export function DeviceHealthScreen() {
  return (
    <Screen title="Device Health" subtitle="How the device is doing — not the air around you.">
      <View style={styles.card}>
        {ROWS.map((r) => (
          <View key={r.label} style={styles.row}>
            <Text style={styles.label}>{r.label}</Text>
            <View style={styles.valueWrap}>
              <View style={[styles.dot, { backgroundColor: r.ok ? colors.normal : colors.high }]} />
              <Text style={styles.value}>{r.value}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.note}>Device warnings (e.g. low battery) are shown here, separate from air-quality status.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: 15 },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  value: { color: colors.textMuted, fontSize: 14 },
  note: { color: colors.textMuted, fontSize: 12, marginTop: space.md },
});
