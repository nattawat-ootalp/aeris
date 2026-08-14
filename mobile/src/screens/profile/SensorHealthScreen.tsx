/** Screen 15 — Sensor Health. Device readiness, kept SEPARATE from environmental status. */
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { usePortable } from '../../state/portable';
import { colors, space, type } from '../../theme';

export function SensorHealthScreen() {
  const { state, telemetry } = usePortable();
  const rows = [
    { label: 'Connection', value: state === 'connected' ? 'Connected' : 'Not connected', ok: state === 'connected' },
    { label: 'Battery', value: telemetry?.battery != null ? `${telemetry.battery}%` : '—', ok: (telemetry?.battery ?? 100) > 15 },
    { label: 'PM sensor', value: telemetry?.sensor_status ?? '—', ok: telemetry?.sensor_status === 'OK' },
    { label: 'Temperature/Humidity', value: telemetry?.temperature != null ? 'OK' : '—', ok: telemetry?.temperature != null },
    { label: 'Last sync', value: telemetry ? 'Just now' : 'Never', ok: !!telemetry },
    { label: 'Firmware', value: 'v1.0.0', ok: true },
  ];

  return (
    <Screen title="Sensor Health" subtitle="How the device is doing — not the air around you.">
      <View style={styles.card}>
        {rows.map((r) => (
          <View key={r.label} style={styles.row}>
            <Text style={styles.label}>{r.label}</Text>
            <View style={styles.valueWrap}>
              <Text style={{ color: r.ok ? colors.normal : colors.high }}>{r.ok ? '✓' : '!'}</Text>
              <Text style={styles.value}>{r.value}</Text>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  label: { ...type.body, color: colors.text },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  value: { ...type.secondary, color: colors.textMuted },
});
