/** Screen 08 — Explore / Map. Places around you, from AirSentinel nodes. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { getRanking } from '../../api/client';
import { LongdoMap } from '../../components/LongdoMap';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { freshnessLabel, isStale } from '../../lib/format';
import { ageSeconds, useNow } from '../../lib/useNow';
import { useMeasureStyle } from '../../lib/responsive';
import { useRemote } from '../../lib/useRemote';
import { colors, space, statusColor, type } from '../../theme';
import type { ExploreStackParamList } from '../../navigation/types';
import type { NodeMarker } from '../../types';

type Props = NativeStackScreenProps<ExploreStackParamList, 'ExploreMap'>;

export function ExploreMapScreen({ navigation }: Props) {
  const { data, loading, error, reload } = useRemote(useCallback(() => getRanking(20), []));
  // The ranking reports each node's freshness as of the moment it was fetched; the sheet stays
  // open long after that, so the age shown counts on from when the answer arrived.
  const now = useNow();
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (data) setFetchedAt(Date.now());
  }, [data]);
  // The map wants the whole canvas on a desktop; the search field and the station sheet are
  // controls, and a control stretched across a monitor is unusable — so only those are capped.
  const measure = useMeasureStyle();
  // The sheet is capped so a long node list cannot eat the map, and scrolls inside that cap.
  const { height } = useWindowDimensions();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const nodes = data?.ranking ?? [];
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((n) => `${n.name} ${n.node_code}`.toLowerCase().includes(q));
  }, [nodes, query]);

  // The sheet follows the search: an explicit pick wins, otherwise the top match.
  const selected = matches.find((n) => n.node_code === selectedCode) ?? matches[0] ?? null;

  return (
    <View style={styles.root}>
      <View style={[styles.searchBar, measure]}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={(t) => { setQuery(t); setSelectedCode(null); }}
          placeholder="Search a place"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <View style={styles.mapWrap}>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState reason="Could not load nearby stations" onRetry={reload} />
        ) : matches.length === 0 ? (
          <EmptyState title={query ? `No station matches “${query}”` : 'No stations reporting right now'} />
        ) : (
          <LongdoMap
            markers={matches}
            center={selected ? { lat: selected.lat, lon: selected.lon } : null}
          />
        )}
      </View>

      {matches.length > 0 ? (
        <View style={[styles.sheet, { maxHeight: height * 0.45 }]}>
          <ScrollView contentContainerStyle={[styles.sheetInner, measure]} showsVerticalScrollIndicator={false}>
          <View style={styles.sheetHandle} />
          {matches.length > 1 ? (
            <View style={styles.pickRow}>
              {matches.slice(0, 4).map((n) => (
                <Pressable
                  key={n.node_code}
                  onPress={() => setSelectedCode(n.node_code)}
                  style={[styles.pick, selected?.node_code === n.node_code ? styles.pickOn : null]}
                >
                  <Text style={styles.pickText} numberOfLines={1}>{n.name || n.node_code}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {selected ? (
            <NodeSheetContent
              node={selected}
              sinceFetchSec={ageSeconds(fetchedAt, now) ?? 0}
              onAssess={() =>
                navigation.navigate('DestinationAssessment', {
                  name: selected.name || selected.node_code,
                  lat: selected.lat,
                  lon: selected.lon,
                })
              }
            />
          ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function NodeSheetContent({ node, sinceFetchSec, onAssess }: { node: NodeMarker; sinceFetchSec: number; onAssess: () => void }) {
  // Age at fetch plus time on screen since — a node that went quiet while the sheet was open
  // must not keep reporting the freshness it had when the list was loaded.
  const ageSec = node.freshness_sec == null ? null : node.freshness_sec + sinceFetchSec;
  const stale = isStale(ageSec);
  return (
    <View style={styles.sheetContent}>
      <Text style={styles.sheetTitle}>{node.name || node.node_code}</Text>
      <Text style={[styles.sheetStatus, { color: statusColor(stale ? 'No Data' : node.watch_label) }]}>
        {stale ? 'STALE' : node.watch_label} {node.pm25 != null ? `· PM2.5 ${node.pm25.toFixed(0)}` : ''}
      </Text>
      <Text style={styles.sheetMeta}>{freshnessLabel(ageSec)}</Text>
      <Pressable style={styles.assessBtn} onPress={onAssess}>
        <Text style={styles.assessBtnText}>Assess this destination</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchBar: { padding: space.md, paddingTop: space.xl },
  search: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.sm, color: colors.text },
  mapWrap: { flex: 1, marginHorizontal: space.md, marginBottom: space.md, borderRadius: 16, overflow: 'hidden' },
  sheetInner: { gap: 0 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.md, borderTopWidth: 1, borderColor: colors.border },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.sm },
  pickRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  pick: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: space.sm, backgroundColor: colors.bgTint },
  pickOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  pickText: { ...type.caption, color: colors.text, textAlign: 'center' },
  sheetContent: { gap: 4 },
  sheetTitle: { ...type.h2, color: colors.text },
  sheetStatus: { ...type.body, fontWeight: '700' },
  sheetMeta: { ...type.caption, color: colors.textMuted },
  assessBtn: { marginTop: space.sm, backgroundColor: colors.primary, borderRadius: 10, padding: space.sm, alignItems: 'center' },
  assessBtnText: { color: '#fff', fontWeight: '700' },
});
