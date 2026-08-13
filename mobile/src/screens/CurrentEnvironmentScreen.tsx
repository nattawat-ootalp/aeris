/** Current Environment (MVP) — local/area status as an explainable, non-diagnostic decision. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getDeviceDecision } from '../api/client';
import { Screen } from '../components/Screen';
import { WatchStatus } from '../components/WatchStatus';
import { colors, space } from '../theme';
import { toWatchStatus, type DecisionEvent } from '../types';

const DEMO_DEVICE = 'BKK-TRT-003'; // a live AirSentinel node; swap for the paired portable id

export function CurrentEnvironmentScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: DecisionEvent }>({
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    getDeviceDecision(DEMO_DEVICE)
      .then((data) => alive && setState({ loading: false, data }))
      .catch((e) => alive && setState({ loading: false, error: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen title="Current Environment" subtitle={`Device ${DEMO_DEVICE}`}>
      {state.loading ? (
        <ActivityIndicator color={colors.normal} />
      ) : state.error ? (
        // an error is NOT "safe" — surface No Data, never a reassuring default
        <WatchStatus status="No Data" subtitle="Could not reach service" />
      ) : state.data ? (
        <View style={{ gap: space.md }}>
          <WatchStatus
            status={toWatchStatus(state.data.decision)}
            subtitle={freshnessLabel(state.data.freshness_sec)}
          />
          <Text style={styles.meta}>Confidence: {state.data.confidence}</Text>
          <Text style={styles.meta}>Sample size: {state.data.sample_size}</Text>
          <View>
            <Text style={styles.metaHead}>Why</Text>
            {state.data.reason_codes.map((c) => (
              <Text key={c} style={styles.reason}>
                • {c}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function freshnessLabel(sec: number | null): string {
  if (sec == null) return 'freshness unknown';
  if (sec < 60) return `updated ${Math.round(sec)}s ago`;
  return `updated ${Math.round(sec / 60)} min ago`;
}

const styles = StyleSheet.create({
  meta: { color: colors.textMuted, fontSize: 13 },
  metaHead: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: space.xs },
  reason: { color: colors.textMuted, fontSize: 13 },
});
