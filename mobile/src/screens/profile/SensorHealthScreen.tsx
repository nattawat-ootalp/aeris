/** Screen 15 — Sensor Health. Device readiness, kept SEPARATE from environmental status. */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { usePortable } from '../../state/portable';
import { colors, space, type } from '../../theme';

export function SensorHealthScreen() {
  const { state, telemetry, status, lastSeenAt, outbox, deviceId } = usePortable();
  const connected = state === 'connected';
  const lastSyncSec = lastSeenAt != null ? (Date.now() - lastSeenAt) / 1000 : null;
  // The VOC chip reports its own health; `sensor_status` covers the PM sensor only, so the
  // two are never folded into one row (docs/ble-contract.md).
  const sgp30 = status?.sgp30;

  // Two buffers sit between a measurement and the record: the device holds readings taken while
  // no phone was connected, and the phone holds readings the backend has not accepted yet.
  // Both are normal and clear on their own, so they read as reassurance rather than as faults.
  const heldOnDevice = status?.buffered;
  // Readings neither buffer could keep. This is the one number here that means the record has a
  // hole in it, so it is always shown — including when it is zero, which is the useful case.
  const lost = (status?.dropped ?? 0) + outbox.dropped;
  const readings = (n: number) => `${n} reading${n === 1 ? '' : 's'}`;

  const rows: { label: string; value: string; ok: boolean }[] = [
    { label: 'Connection', value: connected ? 'Connected' : 'Not connected', ok: connected },
    // The id every reading is filed under. Shown because it is the one thing needed to tell
    // "the device is not sending" apart from "it is sending, under a name you are not looking
    // at" — and on the web it is issued by the browser, so it is not guessable.
    { label: 'Recorded as', value: deviceId ?? 'No Data', ok: deviceId != null },
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
    {
      label: 'Held on device',
      value: heldOnDevice == null ? 'No Data' : heldOnDevice === 0 ? 'Nothing waiting' : `${readings(heldOnDevice)} to transfer`,
      ok: heldOnDevice != null,
    },
    {
      label: 'Waiting to upload',
      value: outbox.pending === 0
        ? 'Nothing waiting'
        : outbox.syncing
          ? `Uploading ${readings(outbox.pending)}`
          : `${readings(outbox.pending)} queued`,
      ok: true,
    },
    {
      label: 'Readings lost',
      value: lost === 0 ? 'None' : readings(lost),
      ok: lost === 0,
    },
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
      <Text style={styles.note}>
        Readings taken while the device is out of range, or while the phone is offline, are kept
        and sent later — they are not lost. &ldquo;Readings lost&rdquo; counts only the ones that
        waited longer than either buffer could hold, which leaves a gap in your history.
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
