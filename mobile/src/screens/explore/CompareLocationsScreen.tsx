/** Screen 10 — Compare Locations. Quick comparison — never a "medically best" ranking. */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getRanking } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { colors, space, statusColor, type } from '../../theme';
import type { NodeMarker } from '../../types';

export function CompareLocationsScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; nodes: NodeMarker[] }>({ loading: true, nodes: [] });

  useEffect(() => {
    getRanking(8)
      .then((r) => setState({ loading: false, nodes: r.ranking }))
      .catch((e) => setState({ loading: false, error: String(e), nodes: [] }));
  }, []);

  return (
    <Screen title="Compare" subtitle="ข้อมูลพื้นที่ล่าสุด">
      {state.loading ? (
        <LoadingState />
      ) : state.error ? (
        <ErrorState reason="Could not load nearby locations" />
      ) : state.nodes.length === 0 ? (
        <EmptyState title="No nearby locations yet" />
      ) : (
        <>
          {state.nodes.map((loc) => (
            <View key={loc.node_code} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{loc.name || loc.node_code}</Text>
                <Text style={styles.meta}>{freshnessLabel(loc.freshness_sec)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.status, { color: statusColor(loc.watch_label) }]}>{loc.watch_label}</Text>
                <Text style={styles.pm}>{loc.pm25 != null ? `PM2.5 ${loc.pm25}` : 'No Data'}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.note}>Differences reflect the latest area readings, not a medical ranking.</Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md },
  name: { ...type.body, color: colors.text, fontWeight: '700' },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  status: { ...type.body, fontWeight: '700' },
  pm: { ...type.caption, color: colors.textMuted },
  note: { ...type.caption, color: colors.textMuted },
});
