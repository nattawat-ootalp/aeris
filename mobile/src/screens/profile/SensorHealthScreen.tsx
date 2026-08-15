/** Screen 15 — Sensor Health. Device readiness, kept SEPARATE from environmental status. */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { usePortable } from '../../state/portable';
import { colors, space, type } from '../../theme';

export function SensorHealthScreen() {
  const { state, telemetry, status, lastSeenAt } = usePortable();
  const connected = state === 'connected';
  const lastSyncSec = lastSeenAt != null ? (Date.now() - lastSeenAt) / 1000 : null;
  // The VOC chip reports its own health; `sensor_status` covers the PM sensor only, so the
  // two are never folded into one row (docs/ble-contract.md).
  const sgp30 = status?.sgp30;

  const rows: { label: string; value: string; ok: boolean }[] = [
    { label: 'Connection', value: connected ? 'Connected' : 'Not connected', ok: connected },
    {
      label: 'Battery',
      value: telemetry?.battery != null ? `${telemetry.battery}%` : 'No Data',
      ok: telemetry?.battery != null && telemetry.battery > 15,
    },
    { label: 'PM sensor', value: telemetry?.sensor_status ?? 'No Data', ok: telemetry?.sensor_status === 'OK' },
    {
      label: 'Temperature/Humidity',
      value: telemetry?.temperature != null ? 'Reporting' : 'No Data',
      ok: telemetry?.temperature != null,
    },
    {
      label: 'VOC sensor (TVOC/eCO2)',
      value: sgp30 ?? (telemetry?.tvoc != null ? 'Reporting' : 'No Data'),
      ok: sgp30 === 'OK' || (sgp30 == null && telemetry?.tvoc != null),
    },
    {
      label: 'Last sync',
      value: lastSyncSec != null ? freshnessLabel(lastSyncSec) : 'Never',
      ok: lastSyncSec != null && lastSyncSec < 120,
    },
    // Firmware comes from the device-status characteristic; unknown until the device answers.
    { label: 'Firmware', value: status?.fw ? `v${status.fw}` : 'No Data', ok: status?.fw != null },
  ];

  return (
    <Screen title="Sensor Health" subtitle="How the device is doing — not the air around you.">
      <View style={styles.card}>
        {rows.map((r) => (
          <View key={r.label} style={styles.row}>
            <Text style={styles.label}>{r.label}</Text>
            <View style={styles.valueWrap}>
              <Ionicons name={r.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={r.ok ? colors.normal : colors.high} />
              <Text style={styles.value}>{r.value}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.note}>
        The VOC sensor reports no data for about 15 seconds after connecting while it warms up.
        PM sensor status above does not reflect VOC sensor health.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  label: { ...type.body, color: colors.text },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  value: { ...type.secondary, color: colors.textMuted },
  note: { ...type.caption, color: colors.textMuted, marginTop: space.md },
});
