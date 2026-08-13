/**
 * Device Health (TDD §7 MVP, §3.2, §14). Battery / sensor / firmware status ONLY.
 * Deliberately kept visually and structurally separate from environmental status:
 * a low battery is a device warning, NOT an air-quality caution. No WatchStatus badge
 * is used here on purpose.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Card, Muted, Row, Screen } from '../components/ui';
import { DEMO_DEVICE_ID } from '../constants';
import { useAsync } from '../hooks/useAsync';
import { colors, space } from '../theme';

export function DeviceHealthScreen() {
  const { state } = useAsync(() => api.deviceHealth(DEMO_DEVICE_ID), [DEMO_DEVICE_ID]);

  return (
    <Screen title="Device Health" subtitle="Hardware status only — not an environmental reading.">
      <Card accent={colors.device} title="Portable device">
        {state.status === 'loading' ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : state.status === 'error' ? (
          <Muted>Device status unavailable ({state.error}).</Muted>
        ) : (
          <>
            <Row label="Device ID" value={state.data.device_id} />
            <Row
              label="Battery"
              value={
                <BatteryPill pct={state.data.battery_pct} />
              }
            />
            <Row label="Sensor" value={state.data.sensor_status} />
            <Row label="Firmware" value={state.data.fw_version} />
            <Row label="Signal (RSSI)" value={state.data.rssi == null ? '—' : `${state.data.rssi} dBm`} />
            <Row
              label="Last seen"
              value={state.data.last_seen_sec == null ? 'unknown' : `${state.data.last_seen_sec}s ago`}
            />
          </>
        )}
      </Card>
      <Muted>Device warnings (e.g. low battery) are separate from air-quality status.</Muted>
    </Screen>
  );
}

function BatteryPill({ pct }: { pct: number | null }) {
  if (pct == null) return <Text style={styles.pillText}>—</Text>;
  const low = pct < 20;
  const color = low ? colors.statusHigh : colors.device;
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: `${color}22` }]}>
      <Text style={[styles.pillText, { color }]}>{pct}%{low ? ' · low' : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderWidth: 1, borderRadius: 10, paddingVertical: 2, paddingHorizontal: space.sm },
  pillText: { fontWeight: '700', fontSize: 13, color: colors.text },
});
