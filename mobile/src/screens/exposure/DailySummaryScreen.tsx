/** Screen 11 — Daily Summary. Today's exposure, aggregated from the readings actually recorded. */
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getDailySummary } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { clockLabel, valueLabel } from '../../lib/format';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, radius, space, type } from '../../theme';

export function DailySummaryScreen() {
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, getDailySummary), [activeDeviceId]),
  );

  if (loading) {
    return (
      <Screen title="Today" subtitle="สรุป exposure วันนี้">
        <LoadingState />
      </Screen>
    );
  }
  if (error || !data) {
    return (
      <Screen title="Today" subtitle="สรุป exposure วันนี้">
        {noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="Could not load today's summary" onRetry={reload} />}
      </Screen>
    );
  }
  if (data.sample_count === 0) {
    return (
      <Screen title="Today" subtitle="สรุป exposure วันนี้">
        <EmptyState title="ยังไม่มีข้อมูลใน 24 ชั่วโมงที่ผ่านมา" />
      </Screen>
    );
  }

  const cards = [
    { label: 'Tracked time', value: data.tracked_time },
    { label: 'Elevated exposure', value: data.elevated_exposure },
    { label: 'High exposure', value: data.high_exposure },
    { label: 'Symptom events', value: String(data.symptom_events) },
    { label: 'Average PM2.5', value: valueLabel(data.mean_pm25, 'µg/m³') },
    {
      label: 'Highest exposure period',
      // Absent only when nothing rose above the caution level — say that, don't show a range.
      value: data.highest_exposure_start
        ? `${clockLabel(data.highest_exposure_start)}–${clockLabel(data.highest_exposure_end)}`
        : 'None',
    },
  ];

  return (
    <Screen title="Today" subtitle="สรุป exposure วันนี้">
      <InfoCard title="24-hour summary">
        <View style={styles.grid}>
          {cards.map((c) => (
            <View key={c.label} style={styles.card}>
              <Text style={styles.value}>{c.value}</Text>
              <Text style={styles.label}>{c.label}</Text>
            </View>
          ))}
        </View>
      </InfoCard>
      <Text style={styles.disclaimer}>
        Based on {data.sample_count} readings from the last 24 hours. Gaps in coverage are excluded,
        never interpolated.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { width: '47%', backgroundColor: colors.bgTint, borderRadius: radius.lg, padding: space.md },
  value: { ...type.h2, color: colors.text },
  label: { ...type.caption, color: colors.textMuted, marginTop: 4 },
  disclaimer: { ...type.caption, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: space.sm },
});
