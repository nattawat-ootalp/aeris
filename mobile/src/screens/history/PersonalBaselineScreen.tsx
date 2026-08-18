/** Screen 13 — Personal Baseline. What the system has learned from YOUR data. Not a medical range. */
import { useCallback } from 'react';
import { StyleSheet, Text } from 'react-native';
import { getPersonalBaseline } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, MetaRow } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { valueLabel } from '../../lib/format';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, type } from '../../theme';

export function PersonalBaselineScreen() {
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, unauthenticated, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, getPersonalBaseline), [activeDeviceId]),
  );

  return (
    <Screen title="Personal Baseline" subtitle="ช่วงที่ระบบเรียนรู้จากข้อมูลของคุณ">
      {loading ? (
        <LoadingState />
      ) : error ? (
        unauthenticated ? <EmptyState title="ยังเชื่อมต่อบัญชีไม่ได้ — ข้อมูลส่วนตัวต้องลงชื่อเข้าใช้ก่อน" /> : noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="Could not load your baseline" onRetry={reload} />
      ) : !data?.ready ? (
        // Below the minimum sample count the engine refuses to personalize (§5.4) — say so
        // instead of showing a range that isn't established yet.
        <>
          <EmptyState title="Not enough data yet — your baseline is still being learned" />
          <Text style={styles.note}>
            {data?.sample_count ?? 0} of {data?.min_samples ?? 0} readings collected.
          </Text>
          {/* Knowing the target turns "not enough yet" into something the user can act on:
              with a device connected the count climbs one reading every few seconds, so this
              says whether to wait a moment or come back tomorrow. */}
          <Text style={styles.note}>
            Keep your device connected — it adds a reading every few seconds.
          </Text>
        </>
      ) : (
        <>
          <InfoCard title="Your usual range">
            <MetaRow label="Typical (median)" value={valueLabel(data.median, 'µg/m³')} />
            <MetaRow label="Upper of your usual range" value={valueLabel(data.upper, 'µg/m³')} />
            <MetaRow label="Latest reading" value={valueLabel(data.current, 'µg/m³')} />
            <MetaRow label="Based on" value={`${data.sample_count} readings`} />
          </InfoCard>
          <Text style={styles.note}>
            This range describes what your own sensor usually records. It is a personal reference
            learned from your data — not a medical range and not a health threshold.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { ...type.caption, color: colors.textMuted },
});
