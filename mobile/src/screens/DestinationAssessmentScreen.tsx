/** Destination Assessment (MVP) — area caution for a place, with freshness + unavailable/stale. */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { assessDestination } from '../api/client';
import { Screen } from '../components/Screen';
import { WatchStatus } from '../components/WatchStatus';
import { colors, space } from '../theme';
import type { DestinationAssessment } from '../types';

export function DestinationAssessmentScreen() {
  const [lat, setLat] = useState('13.7563');
  const [lon, setLon] = useState('100.5018');
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: DestinationAssessment }>({
    loading: false,
  });

  function assess() {
    setState({ loading: true });
    assessDestination(Number(lat), Number(lon))
      .then((data) => setState({ loading: false, data }))
      .catch((e) => setState({ loading: false, error: String(e) }));
  }

  return (
    <Screen title="Destination" subtitle="Check a place before you go">
      <View style={styles.row}>
        <TextInput style={styles.input} value={lat} onChangeText={setLat} placeholder="lat" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
        <TextInput style={styles.input} value={lon} onChangeText={setLon} placeholder="lon" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" />
      </View>
      <Pressable style={styles.button} onPress={assess}>
        <Text style={styles.buttonText}>Assess</Text>
      </Pressable>

      {state.loading ? (
        <ActivityIndicator color={colors.normal} />
      ) : state.error ? (
        <WatchStatus status="No Data" subtitle="Could not reach service" />
      ) : state.data ? (
        <View style={{ gap: space.sm }}>
          <WatchStatus status={state.data.watch_label} subtitle={statusLine(state.data)} />
          {state.data.reason_codes.map((c) => (
            <Text key={c} style={styles.reason}>• {c}</Text>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function statusLine(a: DestinationAssessment): string {
  if (a.status === 'unavailable') return 'No nearby station — unavailable';
  if (a.status === 'stale') return 'Nearest station data is stale';
  const dist = a.distance_km == null ? '?' : a.distance_km.toFixed(2);
  return `${a.node_code} · ${dist} km away`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    color: colors.text, padding: space.sm, backgroundColor: colors.surface,
  },
  button: { backgroundColor: colors.normal, borderRadius: 8, padding: space.md, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  reason: { color: colors.textMuted, fontSize: 13 },
});
