/** Screen 05 — Exposure Timeline. What kind of environment did you move through today? */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, statusColor, type } from '../../theme';
import type { ExposureStackParamList } from '../../navigation/types';
import type { ExposureTimelineEvent } from '../../types';

const MOCK: ExposureTimelineEvent[] = [
  { id: '1', time: '08:10', location: 'Home', level: 'Normal', duration_min: 90, pm25_avg: 10, pm25_max: 14 },
  { id: '2', time: '09:40', location: 'Commute', level: 'Caution', duration_min: 25, pm25_avg: 42, pm25_max: 55 },
  { id: '3', time: '10:05', location: 'Office', level: 'Normal', duration_min: 240, pm25_avg: 12, pm25_max: 18 },
];

type Props = NativeStackScreenProps<ExposureStackParamList, 'ExposureTimeline'>;

export function ExposureTimelineScreen({ navigation }: Props) {
  return (
    <Screen title="Exposure" subtitle="ไทม์ไลน์การรับสัมผัสวันนี้" scroll={false}>
      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={() => navigation.navigate('DailySummary')}>
          <Text style={styles.actionText}>Daily Summary</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => navigation.navigate('SymptomEvent')}>
          <Text style={styles.actionText}>Record Symptom</Text>
        </Pressable>
      </View>
      <FlatList
        data={MOCK}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<EmptyState title="ยังไม่มีข้อมูล" />}
        contentContainerStyle={{ gap: space.sm, paddingTop: space.md, paddingBottom: space.xl }}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate('ExposureEventDetail', { eventId: item.id })}>
            <View style={[styles.rail, { backgroundColor: statusColor(item.level) }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.time}>{item.time} · {item.location}</Text>
              <Text style={styles.level}>{item.level} · {item.duration_min} min</Text>
            </View>
            <Text style={styles.avg}>avg {item.pm25_avg}</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.sm },
  actionBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, alignItems: 'center' },
  actionText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: space.md },
  rail: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  time: { ...type.body, color: colors.text, fontWeight: '600' },
  level: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  avg: { ...type.secondary, color: colors.textMuted },
});
