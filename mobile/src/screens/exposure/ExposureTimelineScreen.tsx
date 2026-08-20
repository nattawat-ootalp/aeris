/** Screen 05 — Exposure Timeline. What kind of environment did you move through today? */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { getExposureTimeline } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { SignInRequired } from '../../components/SignInRequired';
import { Screen } from '../../components/Screen';
import { clockLabel, durationLabel } from '../../lib/format';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { useRemote } from '../../lib/useRemote';
import { colors, space, statusColor, type } from '../../theme';
import type { ExposureStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ExposureStackParamList, 'ExposureTimeline'>;

export function ExposureTimelineScreen({ navigation }: Props) {
  const activeDeviceId = useActiveDeviceId();
  const { data, loading, error, noDevice, unauthenticated, reload } = useRemote(
    useCallback(() => withDevice(activeDeviceId, (id) => getExposureTimeline(id, 24)), [activeDeviceId]),
  );
  const events = data?.events ?? [];

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

      {loading ? (
        <LoadingState />
      ) : error ? (
        unauthenticated ? <SignInRequired /> : noDevice ? <EmptyState title="ยังไม่มีอุปกรณ์สำหรับแสดงข้อมูล" /> : <ErrorState reason="Could not load your timeline" onRetry={reload} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(i) => i.id}
          ListEmptyComponent={<EmptyState title="ยังไม่มีข้อมูลใน 24 ชั่วโมงที่ผ่านมา" />}
          contentContainerStyle={{ gap: space.sm, paddingTop: space.md, paddingBottom: space.xl }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('ExposureEventDetail', { eventId: item.id })}
            >
              <View style={[styles.rail, { backgroundColor: statusColor(item.level) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.time}>
                  {clockLabel(item.start)} – {clockLabel(item.end)}
                </Text>
                <Text style={styles.level}>
                  {item.level} · {durationLabel(item.duration_sec)}
                </Text>
              </View>
              <Text style={styles.avg}>
                {item.pm25_avg != null ? `avg ${item.pm25_avg.toFixed(0)}` : 'No Data'}
              </Text>
            </Pressable>
          )}
        />
      )}
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
