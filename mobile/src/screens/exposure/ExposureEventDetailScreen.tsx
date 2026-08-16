/** Screen 06 — Exposure Event Detail. One measured period, with the context recorded during it. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { StyleSheet, Text } from 'react-native';
import { getExposureEvent } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, MetaRow } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { clockLabel, co2Label, durationLabel, eco2Label, tvocLabel, valueLabel } from '../../lib/format';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, type } from '../../theme';
import type { ExposureStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ExposureStackParamList, 'ExposureEventDetail'>;

export function ExposureEventDetailScreen({ route }: Props) {
  const { eventId } = route.params;
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, (id) => getExposureEvent(id, eventId, 24)), [activeDeviceId, eventId]),
  );

  if (loading) {
    return (
      <Screen title="Exposure period">
        <LoadingState />
      </Screen>
    );
  }
  if (error || !data) {
    return (
      <Screen title="Exposure period">
        {noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="This period is no longer in the current window" onRetry={reload} />}
      </Screen>
    );
  }

  return (
    <Screen title={`${clockLabel(data.start)} – ${clockLabel(data.end)}`} subtitle={data.level}>
      <InfoCard title="Environment">
        <MetaRow label="PM2.5 average" value={valueLabel(data.pm25_avg, 'µg/m³')} />
        <MetaRow label="PM2.5 peak" value={valueLabel(data.pm25_max, 'µg/m³')} />
        <MetaRow label="Temperature" value={valueLabel(data.temperature_avg, '°C', 1)} />
        <MetaRow label="Humidity" value={valueLabel(data.humidity_avg, '%')} />
        <MetaRow label="TVOC" value={tvocLabel(data.tvoc_avg ?? undefined)} />
        <MetaRow label="CO2" value={co2Label(data.co2_avg)} />
        <MetaRow label="eCO2 (estimated)" value={eco2Label(data.eco2_avg)} />
      </InfoCard>
      <InfoCard title="Context">
        <MetaRow label="Duration" value={durationLabel(data.duration_sec)} />
        <MetaRow label="Trend" value={data.trend ?? 'Not enough samples'} />
        <MetaRow label="Samples" value={String(data.sample_count)} />
      </InfoCard>
      <Text style={styles.note}>
        This period is derived from the readings your device actually recorded — gaps in coverage
        are excluded rather than filled in.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { ...type.caption, color: colors.textMuted },
});
