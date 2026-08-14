/** Screen 17 — Notifications. Environmental change alerts, not diagnoses. No alert fatigue. */
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, statusColor, type } from '../../theme';
import type { WatchStatus } from '../../types';

interface Item { id: string; type: WatchStatus | 'Device'; text: string; time: string; reason: string }

const MOCK: Item[] = [
  { id: '1', type: 'Caution', text: 'PM2.5 rose above your usual range', time: '10 min ago', reason: 'Sustained for 12 min' },
  { id: '2', type: 'Device', text: 'Battery low on your Aeris device', time: '2 hr ago', reason: '15% remaining' },
];

export function NotificationsScreen() {
  return (
    <Screen title="Notifications" scroll={false}>
      <FlatList
        data={MOCK}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<EmptyState title="No notifications yet" />}
        contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={[styles.dot, { color: item.type === 'Device' ? colors.textMuted : statusColor(item.type) }]}>●</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.text}>{item.text}</Text>
              <Text style={styles.meta}>{item.reason} · {item.time}</Text>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space.md },
  dot: { fontSize: 14, marginTop: 3 },
  text: { ...type.body, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
});
