/** Screen 14 — Personal Pattern. An association to notice — never "Trigger" or "Cause". */
import { useCallback } from 'react';
import { StyleSheet, Text } from 'react-native';
import { getPersonalPattern } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, MetaRow } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, type } from '../../theme';

function percent(value: number | null): string {
  return value == null ? 'No Data' : `${Math.round(value * 100)}%`;
}

export function PersonalPatternScreen() {
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, unauthenticated, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, (id) => getPersonalPattern(id, 30)), [activeDeviceId]),
  );

  return (
    <Screen title="Personal Pattern" subtitle="รูปแบบที่พบจากข้อมูลย้อนหลัง">
      {loading ? (
        <LoadingState />
      ) : error ? (
        unauthenticated ? <EmptyState title="ยังเชื่อมต่อบัญชีไม่ได้ — ข้อมูลส่วนตัวต้องลงชื่อเข้าใช้ก่อน" /> : noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="Could not load your pattern" onRetry={reload} />
      ) : !data || data.sample_size === 0 ? (
        <EmptyState title="ยังไม่มีเหตุการณ์อาการที่บันทึกไว้ในช่วง 30 วัน" />
      ) : (
        <>
          <InfoCard title={data.title}>
            <Text style={styles.condition}>{data.condition}</Text>
            <MetaRow label="Observed" value={`${data.co_occurrence_count} of ${data.sample_size} events`} />
            <MetaRow label="Proportion" value={percent(data.association)} />
            <MetaRow
              label="Uncertainty (95%)"
              value={data.uncertainty == null ? 'No Data' : `±${Math.round(data.uncertainty * 100)}%`}
            />
            <MetaRow label="Exposure periods seen" value={String(data.exposure_episode_count)} />
          </InfoCard>
          {!data.sufficient ? (
            // §5.5 hard rule: below the minimum sample size the association is shown but must
            // be marked as too small to read anything into.
            <Text style={styles.warn}>
              Sample is still small — this proportion can change a lot with a few more events.
            </Text>
          ) : null}
          <Text style={styles.note}>
            This is an observational association, not a proven cause. NextAir does not diagnose or
            explain why symptoms happen.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  condition: { ...type.secondary, color: colors.textMuted, marginBottom: 4 },
  warn: { ...type.caption, color: colors.caution },
  note: { ...type.caption, color: colors.textMuted, fontStyle: 'italic' },
});
