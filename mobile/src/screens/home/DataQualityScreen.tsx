/** Screen 16 — Data Quality. How trustworthy is what you're seeing? No 0-100 score (§21). */
import { StyleSheet, Text, View } from 'react-native';
import { InfoCard, MetaRow, SectionLabel } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';

export function DataQualityScreen() {
  return (
    <Screen title="Data Quality" subtitle="ข้อมูลที่เห็นมีคุณภาพเพียงใด">
      <InfoCard>
        <MetaRow label="Freshness" value="12s ago" />
        <MetaRow label="Continuity" value="No gaps in last hour" />
        <MetaRow label="Sensor state" value="OK" />
      </InfoCard>
      <InfoCard title="Confidence">
        <View style={styles.confidenceRow}>
          <Text style={styles.confidenceLabel}>HIGH</Text>
        </View>
        <SectionLabel>Why</SectionLabel>
        <Text style={styles.reason}>• PM sensor is fresh and within its normal range</Text>
        <Text style={styles.reason}>• No warm-up or bus-recovery events recently</Text>
      </InfoCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  confidenceRow: { paddingVertical: space.sm },
  confidenceLabel: { ...type.h1, color: colors.normal },
  reason: { ...type.body, color: colors.text, marginTop: 4 },
});
