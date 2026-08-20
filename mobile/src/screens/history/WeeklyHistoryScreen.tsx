/** Screen 12 — Weekly / History. Look for patterns over the past week. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getWeeklyHistory } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, SectionLabel } from '../../components/ui';
import { SignInRequired } from '../../components/SignInRequired';
import { Screen } from '../../components/Screen';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, space, type } from '../../theme';
import type { HistoryStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<HistoryStackParamList, 'WeeklyHistory'>;

export function WeeklyHistoryScreen({ navigation }: Props) {
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, unauthenticated, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, (id) => getWeeklyHistory(id, 7)), [activeDeviceId]),
  );

  const days = data?.days ?? [];
  // Scale bars to the busiest day; a day with no valid samples has no bar at all rather
  // than a zero-height bar that would read as "measured, and it was clean".
  const max = Math.max(1, ...days.map((d) => d.mean_pm25 ?? 0));
  const hasAny = days.some((d) => d.sample_count > 0);

  return (
    <Screen title="History" subtitle="รูปแบบย้อนหลัง 7 วัน">
      {loading ? (
        <LoadingState />
      ) : error ? (
        unauthenticated ? <SignInRequired /> : noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="Could not load your history" onRetry={reload} />
      ) : !hasAny ? (
        <EmptyState title="ยังไม่มีข้อมูลย้อนหลังเพียงพอ" />
      ) : (
        <>
          <InfoCard>
            <SectionLabel>Average PM2.5 by day</SectionLabel>
            <View style={styles.chart}>
              {days.map((d) => (
                <View key={d.date} style={styles.barCol}>
                  {d.mean_pm25 != null ? (
                    <View style={[styles.bar, { height: 6 + (d.mean_pm25 / max) * 80 }]} />
                  ) : (
                    <View style={styles.noBar} />
                  )}
                  <Text style={styles.dayLabel}>{d.weekday}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.legend}>Days with no recorded data are left blank.</Text>
          </InfoCard>

          <InfoCard title="When exposure was highest">
            <Text style={styles.text}>
              {data?.highest_day
                ? `${data.highest_day} · ${data.highest_day_elevated} above the caution level`
                : 'No elevated exposure recorded this week'}
            </Text>
          </InfoCard>
        </>
      )}

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
  noBar: { width: 18, height: 6, borderRadius: 4, backgroundColor: colors.divider },
  dayLabel: { ...type.caption, color: colors.textMuted },
  legend: { ...type.caption, color: colors.textMuted, marginTop: space.sm },
  text: { ...type.body, color: colors.text },
  links: { gap: space.sm },
  linkBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md },
  linkText: { color: colors.primary, fontWeight: '700' },
});
