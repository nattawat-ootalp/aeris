/** Screen 12 — Weekly / History. Look for patterns over the past week. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { InfoCard, SectionLabel } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';
import type { HistoryStackParamList } from '../../navigation/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VALUES = [10, 22, 15, 40, 18, 12, 28];

type Props = NativeStackScreenProps<HistoryStackParamList, 'WeeklyHistory'>;

export function WeeklyHistoryScreen({ navigation }: Props) {
  const max = Math.max(...VALUES);
  return (
    <Screen title="History" subtitle="รูปแบบย้อนหลัง 7 วัน">
      <InfoCard>
        <SectionLabel>Exposure by day</SectionLabel>
        <View style={styles.chart}>
          {VALUES.map((v, i) => (
            <View key={i} style={styles.barCol}>
              <View style={[styles.bar, { height: 6 + (v / max) * 80 }]} />
              <Text style={styles.dayLabel}>{DAYS[i]}</Text>
            </View>
          ))}
        </View>
      </InfoCard>

      <InfoCard title="Where exposure was highest">
        <Text style={styles.text}>Commute route · 3 times this week</Text>
      </InfoCard>

      <View style={styles.links}>
        <Pressable style={styles.linkBtn} onPress={() => navigation.navigate('PersonalBaseline')}>
          <Text style={styles.linkText}>Personal Baseline →</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={() => navigation.navigate('PersonalPattern')}>
          <Text style={styles.linkText}>Personal Pattern →</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 110, marginTop: space.sm },
  barCol: { alignItems: 'center', gap: 4 },
  bar: { width: 18, backgroundColor: colors.primary, borderRadius: 4 },
  dayLabel: { ...type.caption, color: colors.textMuted },
  text: { ...type.body, color: colors.text },
  links: { gap: space.sm },
  linkBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md },
  linkText: { color: colors.primary, fontWeight: '700' },
});
