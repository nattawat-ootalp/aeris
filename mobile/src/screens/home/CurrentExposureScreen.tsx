/** Screen 04 — Current Exposure. How the environment has changed over the current period. */
import { StyleSheet, Text, View } from 'react-native';
import { InfoCard, MetaRow, SectionLabel } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';

// mock series — replaced by /nodes/{id}/history once wired to a specific paired device
const MOCK_SERIES = [12, 14, 18, 22, 30, 34, 28, 24, 20];

export function CurrentExposureScreen() {
  const max = Math.max(...MOCK_SERIES);
  return (
    <Screen title="Current Exposure" subtitle="การเปลี่ยนแปลงของสภาพแวดล้อมช่วงนี้">
      <InfoCard>
        <SectionLabel>Trend</SectionLabel>
        <View style={styles.chart}>
          {MOCK_SERIES.map((v, i) => (
            <View key={i} style={[styles.bar, { height: 8 + (v / max) * 72 }]} />
          ))}
        </View>
        <MetaRow label="Current" value={`${MOCK_SERIES[MOCK_SERIES.length - 1]} µg/m³`} />
        <MetaRow label="Trend" value="Rising over the last 30 min" />
      </InfoCard>

      <InfoCard title="Exposure duration">
        <MetaRow label="Elevated (≥ caution)" value="18 min" />
        <MetaRow label="High" value="0 min" />
      </InfoCard>

      <InfoCard title="Data quality">
        <MetaRow label="Freshness" value="12s ago" />
        <MetaRow label="Confidence" value="HIGH" />
      </InfoCard>

      <Text style={styles.note}>Area vs personal comparison appears once your baseline is ready.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, height: 88, marginVertical: space.sm },
  bar: { flex: 1, backgroundColor: colors.primary, borderRadius: 4, opacity: 0.8 },
  note: { ...type.caption, color: colors.textMuted },
});
