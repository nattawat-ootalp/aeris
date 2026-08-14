/** Screen 11 — Daily Summary. Today's exposure without drowning in graphs. */
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, radius, space, type } from '../../theme';

const CARDS = [
  { label: 'Tracked time', value: '9h 40m' },
  { label: 'Elevated exposure', value: '25 min' },
  { label: 'High exposure', value: '0 min' },
  { label: 'Symptom events', value: '1' },
  { label: 'Highest exposure period', value: '09:40–10:05' },
];

export function DailySummaryScreen() {
  return (
    <Screen title="Today" subtitle="สรุป exposure วันนี้">
      <View style={styles.grid}>
        {CARDS.map((c) => (
          <View key={c.label} style={styles.card}>
            <Text style={styles.value}>{c.value}</Text>
            <Text style={styles.label}>{c.label}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton label="Review day" onPress={() => {}} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { width: '47%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md },
  value: { ...type.h1, color: colors.text },
  label: { ...type.caption, color: colors.textMuted, marginTop: 4 },
});
