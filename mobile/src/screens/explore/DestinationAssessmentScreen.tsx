/** Screen 09 — Destination Assessment. Evaluate a place before you travel there. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { assessDestination } from '../../api/client';
import { LoadingState, SecondaryButton } from '../../components/ui';
import { HeroStatusCard } from '../../components/WatchStatus';
import { colors, space, type } from '../../theme';
import type { ExploreStackParamList } from '../../navigation/types';
import type { DestinationAssessment } from '../../types';

type Props = NativeStackScreenProps<ExploreStackParamList, 'DestinationAssessment'>;

export function DestinationAssessmentScreen({ route, navigation }: Props) {
  const { name, lat, lon } = route.params;
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: DestinationAssessment }>({ loading: true });

  useEffect(() => {
    assessDestination(lat, lon)
      .then((data) => setState({ loading: false, data }))
      .catch((e) => setState({ loading: false, error: String(e) }));
  }, [lat, lon]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{name}</Text>
      {state.loading ? (
        <LoadingState />
      ) : state.error || !state.data ? (
        <HeroStatusCard status="No Data" freshnessLabel="Could not reach service" />
      ) : (
        <>
          <HeroStatusCard status={state.data.watch_label} pm25={state.data.pm25} freshnessLabel={statusLine(state.data)} />
          <View style={styles.reasons}>
            {state.data.reason_codes.map((c) => (
              <Text key={c} style={styles.reason}>• {c.replaceAll('_', ' ').toLowerCase()}</Text>
            ))}
          </View>
        </>
      )}
      <SecondaryButton label="Compare locations" onPress={() => navigation.navigate('CompareLocations')} />
    </View>
  );
}

function statusLine(a: DestinationAssessment): string {
  if (a.status === 'unavailable') return 'No nearby station — UNAVAILABLE';
  if (a.status === 'stale') return 'Nearest station data is STALE';
  const dist = a.distance_km == null ? '?' : a.distance_km.toFixed(2);
  return `${a.node_code} · ${dist} km away`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.lg, paddingTop: space.xl, gap: space.md },
  title: { ...type.h1, color: colors.text },
  reasons: { gap: 4 },
  reason: { ...type.body, color: colors.text },
});
