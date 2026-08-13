/**
 * Destination Assessment (TDD §6, §7 MVP). Enter a destination, get a caution + data
 * freshness. If the nearest node is offline or its reading is stale, we show
 * "unavailable" / "stale" explicitly instead of a value (TDD §6, §14).
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { api, type ApiResult } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { Card, Muted, Row, Screen } from '../components/ui';
import { colors, radius, space } from '../theme';
import type { DestinationAssessment } from '../types';

type Query = { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: ApiResult<DestinationAssessment> };

export function DestinationAssessmentScreen() {
  const [destination, setDestination] = useState('');
  const [query, setQuery] = useState<Query>({ status: 'idle' });

  async function assess() {
    if (!destination.trim()) return;
    setQuery({ status: 'loading' });
    const result = await api.assessDestination(destination.trim());
    setQuery({ status: 'done', result });
  }

  return (
    <Screen title="Destination Assessment" subtitle="Check the air context of where you are going.">
      <Card>
        <Text style={styles.fieldLabel}>Destination</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Chatuchak Market"
          placeholderTextColor={colors.textMuted}
          value={destination}
          onChangeText={setDestination}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={assess}
        />
        <Pressable style={styles.button} onPress={assess} disabled={query.status === 'loading'}>
          <Text style={styles.buttonText}>{query.status === 'loading' ? 'Assessing…' : 'Assess'}</Text>
        </Pressable>
      </Card>

      {query.status === 'loading' ? <ActivityIndicator color={colors.textMuted} /> : null}

      {query.status === 'done' ? (
        query.result.ok ? (
          <ResultCard result={query.result.data} />
        ) : (
          <Card accent={colors.statusNoData}>
            <StatusBadge status="No Data" size="lg" />
            <Muted>Assessment unavailable ({query.result.error}). No node data to show.</Muted>
          </Card>
        )
      ) : null}
    </Screen>
  );
}

function ResultCard({ result }: { result: DestinationAssessment }) {
  const unavailable = !result.available;
  const stale = result.stale;
  const status = unavailable || stale ? 'No Data' : result.watch_label;
  return (
    <Card accent={colors.statusCaution}>
      <StatusBadge status={status} size="lg" />
      <Row label="Destination" value={result.destination} />
      <Row label="Node" value={result.node_id ?? 'none nearby'} />
      <Row label="Distance" value={result.distance_km == null ? '—' : `${result.distance_km} km`} />
      <Row label="Last seen" value={result.last_seen_sec == null ? 'unknown' : `${result.last_seen_sec}s ago`} />
      <Row label="Reasons" value={result.reason_codes.join(', ') || '—'} />
      {unavailable ? <Muted>Nearest node is offline — destination data unavailable.</Muted> : null}
      {!unavailable && stale ? <Muted>Node reading is stale — not usable as current.</Muted> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: colors.textMuted, fontSize: 13, marginBottom: space.xs },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
  button: {
    marginTop: space.md,
    backgroundColor: colors.statusCaution,
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  buttonText: { color: '#0f1419', fontWeight: '800', fontSize: 15 },
});
