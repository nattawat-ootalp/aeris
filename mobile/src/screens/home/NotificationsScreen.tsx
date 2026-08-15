/** Screen 17 — Notifications. Environmental change alerts, not diagnoses. No alert fatigue. */
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { getAlerts, type AlertEvent } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';

function severityColor(sev: string): string {
  if (sev === 'critical' || sev === 'high') return colors.high;
  if (sev === 'warning') return colors.caution;
  return colors.textMuted;
}

export function NotificationsScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; alerts: AlertEvent[] }>({ loading: true, alerts: [] });

  useEffect(() => {
    getAlerts(50)
      .then((r) => setState({ loading: false, alerts: r.alerts }))
      .catch((e) => setState({ loading: false, error: String(e), alerts: [] }));
  }, []);

  return (
    <Screen title="Notifications" scroll={false}>
      {state.loading ? (
        <LoadingState />
      ) : state.error ? (
        <ErrorState reason="Could not load notifications" />
      ) : (
        <FlatList
          data={state.alerts}
          keyExtractor={(item, idx) => `${item.node_id}-${item.sensor}-${item.timestamp ?? item.triggered_at ?? idx}`}
          ListEmptyComponent={<EmptyState title="No notifications yet" />}
          contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={[styles.dot, { color: severityColor(item.severity) }]}>●</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>
                  {item.sensor} reached {item.value} (threshold {item.threshold}
                  {item.standard ? ` · ${item.standard}` : ''})
                </Text>
                <Text style={styles.meta}>{item.node_id} · {item.timestamp ?? item.triggered_at ?? 'unknown time'}</Text>
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space.md },
  dot: { fontSize: 14, marginTop: 3 },
  text: { ...type.body, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
});
