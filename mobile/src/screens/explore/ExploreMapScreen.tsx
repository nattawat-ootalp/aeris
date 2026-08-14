/** Screen 08 — Explore / Map. Places around you, from AirSentinel nodes. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getRanking } from '../../api/client';
import { LongdoMap } from '../../components/LongdoMap';
import { LoadingState } from '../../components/ui';
import { freshnessLabel, isStale } from '../../lib/format';
import { colors, space, statusColor, type } from '../../theme';
import type { ExploreStackParamList } from '../../navigation/types';
import type { NodeMarker } from '../../types';

type Props = NativeStackScreenProps<ExploreStackParamList, 'ExploreMap'>;

export function ExploreMapScreen({ navigation }: Props) {
  const [nodes, setNodes] = useState<NodeMarker[] | null>(null);
  const [selected, setSelected] = useState<NodeMarker | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    getRanking(20)
      .then((r) => setNodes(r.ranking))
      .catch(() => setNodes([]));
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search a place"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <View style={styles.mapWrap}>
        {nodes == null ? <LoadingState /> : <LongdoMap markers={nodes} />}
      </View>
      {nodes && nodes.length > 0 ? (
        <Pressable style={styles.sheet} onPress={() => setSelected(nodes[0])}>
          <View style={styles.sheetHandle} />
          {selected ?? nodes[0] ? (
            <NodeSheetContent
              node={selected ?? nodes[0]}
              onAssess={() => {
                const n = selected ?? nodes[0];
                navigation.navigate('DestinationAssessment', { name: n.name || n.node_code, lat: n.lat, lon: n.lon });
              }}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

function NodeSheetContent({ node, onAssess }: { node: NodeMarker; onAssess: () => void }) {
  const stale = isStale(node.freshness_sec);
  return (
    <View style={styles.sheetContent}>
      <Text style={styles.sheetTitle}>{node.name || node.node_code}</Text>
      <Text style={[styles.sheetStatus, { color: statusColor(stale ? 'No Data' : node.watch_label) }]}>
        {stale ? 'STALE' : node.watch_label} {node.pm25 != null ? `· PM2.5 ${node.pm25}` : ''}
      </Text>
      <Text style={styles.sheetMeta}>{freshnessLabel(node.freshness_sec)}</Text>
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.md, borderTopWidth: 1, borderColor: colors.border },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.sm },
  sheetContent: { gap: 4 },
  sheetTitle: { ...type.h2, color: colors.text },
  sheetStatus: { ...type.body, fontWeight: '700' },
  sheetMeta: { ...type.caption, color: colors.textMuted },
  assessBtn: { marginTop: space.sm, backgroundColor: colors.primary, borderRadius: 10, padding: space.sm, alignItems: 'center' },
  assessBtnText: { color: '#fff', fontWeight: '700' },
});
