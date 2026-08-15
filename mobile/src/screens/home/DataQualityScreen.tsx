/** Screen 16 — Data Quality. How trustworthy is what you're seeing? No 0-100 score (§21). */
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getDataQuality } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, MetaRow, SectionLabel } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, space, type } from '../../theme';
import type { Confidence } from '../../types';

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  HIGH: colors.normal,
  MEDIUM: colors.caution,
  LOW: colors.textMuted,
};

/** Machine reason codes → the plain sentence for each. Only codes the backend actually
 *  returned are shown, so this never claims a check passed that wasn't run. */
const REASON_TEXT: Record<string, string> = {
  NO_VALID_DATA: 'No valid readings were available',
  SENSOR_INVALID: 'The PM sensor reported an invalid reading',
  SENSOR_WARMUP: 'The sensor was still warming up',
  DATA_STALE: 'The most recent reading is older than the freshness limit',
  SPIKE_SUSPECTED: 'A sudden jump was seen and is not trusted on its own',
  PM25_ABOVE_ENV_CAUTION: 'PM2.5 was above the caution level',
  PM25_ABOVE_ENV_HIGH: 'PM2.5 was above the high level',
  PM25_ABOVE_PERSONAL_BASELINE: 'PM2.5 was above your personal usual range',
  PERSONAL_EXPOSURE_ELEVATED: 'Accumulated exposure was elevated',
  EXPOSURE_DURATION_INCREASING: 'Time spent above the caution level is increasing',
  BASELINE_INSUFFICIENT_SAMPLE: 'Not enough data yet for a personal baseline',
  ENV_NORMAL: 'PM2.5 was within the normal range',
};

function reasonText(code: string): string {
  return REASON_TEXT[code] ?? code.replaceAll('_', ' ').toLowerCase();
}

function continuityLabel(gaps: number | null, coverage: number | null): string {
  if (gaps == null || coverage == null) return 'No Data';
  if (gaps === 0) return 'No gaps in the last hour';
  return `${gaps} gap${gaps === 1 ? '' : 's'} · ${Math.round(coverage * 100)}% covered`;
}

export function DataQualityScreen() {
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, getDataQuality), [activeDeviceId]),
  );

  return (
    <Screen title="Data Quality" subtitle="ข้อมูลที่เห็นมีคุณภาพเพียงใด">
      {loading ? (
        <LoadingState />
      ) : error || !data ? (
        noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="Could not load data quality" onRetry={reload} />
      ) : !data.has_data ? (
        <EmptyState title="No readings available for this device" />
      ) : (
        <>
          <InfoCard>
            <MetaRow label="Freshness" value={freshnessLabel(data.freshness_sec)} />
            <MetaRow label="Continuity" value={continuityLabel(data.gaps_last_hour, data.coverage_ratio_last_hour)} />
            <MetaRow label="Sensor state" value={data.sensor_status ?? 'No Data'} />
            <MetaRow label="Samples" value={String(data.sample_count)} />
            {data.battery_low ? <MetaRow label="Battery" value="Low" /> : null}
          </InfoCard>
          <InfoCard title="Confidence">
            <View style={styles.confidenceRow}>
              <Text style={[styles.confidenceLabel, { color: CONFIDENCE_COLOR[data.confidence] }]}>
                {data.confidence}
              </Text>
            </View>
            <SectionLabel>Why</SectionLabel>
            {data.decision_reasons.length === 0 ? (
              <Text style={styles.reason}>• No quality issues were recorded</Text>
            ) : (
              data.decision_reasons.map((c) => (
                <Text key={c} style={styles.reason}>• {reasonText(c)}</Text>
              ))
            )}
          </InfoCard>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  confidenceRow: { paddingVertical: space.sm },
  confidenceLabel: { ...type.h1 },
  reason: { ...type.body, color: colors.text, marginTop: 4 },
});
