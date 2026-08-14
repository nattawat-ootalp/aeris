/** Screen 13 — Personal Baseline. What the system has learned from YOUR data. Not a medical range. */
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState, InfoCard, MetaRow } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';
import type { PersonalBaseline } from '../../types';

// mock — will be wired to a personal-baseline endpoint when available
const MOCK: PersonalBaseline = { ready: true, sample_count: 62, median: 14, upper: 28, current: 18, updated_at: '2026-08-13' };

export function PersonalBaselineScreen() {
  if (!MOCK.ready) {
    return (
      <Screen title="Personal Baseline">
        <EmptyState title="Not enough data yet" />
      </Screen>
    );
  }
  return (
    <Screen title="Personal Baseline" subtitle="ช่วงที่ระบบเรียนรู้จากข้อมูลของคุณ">
      <InfoCard>
        <View style={styles.band}>
          <View style={styles.bandTrack} />
          <View style={[styles.bandMarker, { left: `${Math.min(100, (MOCK.current! / MOCK.upper!) * 60)}%` }]} />
        </View>
        <MetaRow label="Current" value={`${MOCK.current} µg/m³`} />
        <MetaRow label="Your typical range" value={`up to ${MOCK.upper} µg/m³`} />
        <MetaRow label="Sample count" value={`${MOCK.sample_count}`} />
        <MetaRow label="Last updated" value={MOCK.updated_at ?? '-'} />
      </InfoCard>
      <Text style={styles.note}>This baseline is a personal reference range — it is not a medical threshold.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  band: { height: 10, marginVertical: space.sm },
  bandTrack: { height: 8, borderRadius: 4, backgroundColor: colors.divider },
  bandMarker: { position: 'absolute', top: -3, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff' },
  note: { ...type.caption, color: colors.textMuted },
});
