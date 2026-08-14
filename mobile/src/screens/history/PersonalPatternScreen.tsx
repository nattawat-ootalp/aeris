/** Screen 14 — Personal Pattern. An association to notice — never "Trigger" or "Cause". */
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState, InfoCard, MetaRow } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';
import type { PersonalPattern } from '../../types';

const MOCK: PersonalPattern = {
  title: 'Elevated exposure often precedes a symptom event',
  condition: 'PM2.5 > your baseline for 20+ min',
  event_count: 9,
  co_occurrence_count: 6,
  sample_size: 9,
  uncertainty: 0.18,
  sufficient: true,
};

export function PersonalPatternScreen() {
  if (!MOCK.sufficient) {
    return (
      <Screen title="Personal Pattern">
        <EmptyState title="Insufficient sample — check back after more data is collected" />
      </Screen>
    );
  }
  return (
    <Screen title="Personal Pattern" subtitle="รูปแบบที่พบจากข้อมูลย้อนหลัง">
      <InfoCard title={MOCK.title}>
        <Text style={styles.condition}>{MOCK.condition}</Text>
        <MetaRow label="Events" value={`${MOCK.event_count}`} />
        <MetaRow label="Co-occurred with symptom" value={`${MOCK.co_occurrence_count} times`} />
        <MetaRow label="Sample size" value={`${MOCK.sample_size}`} />
        <MetaRow label="Uncertainty" value={`± ${((MOCK.uncertainty ?? 0) * 100).toFixed(0)}%`} />
      </InfoCard>
      <View style={styles.warnBox}>
        <Text style={styles.warnText}>
          This is an observed association, not a proven cause. It does not mean this exposure caused your symptom.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  condition: { ...type.body, color: colors.textMuted, marginBottom: space.sm },
  warnBox: { backgroundColor: colors.unknownSoft, borderRadius: 12, padding: space.md },
  warnText: { ...type.caption, color: colors.text },
});
