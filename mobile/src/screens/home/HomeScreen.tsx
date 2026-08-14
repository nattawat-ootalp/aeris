/** Screen 03 — Home. "What is the environment like right now?" within a few seconds. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDeviceDecision } from '../../api/client';
import { InfoCard, LoadingState } from '../../components/ui';
import { HeroStatusCard } from '../../components/WatchStatus';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { usePortable } from '../../state/portable';
import { colors, radius, space, statusColor, type } from '../../theme';
import { toWatchStatus, type DecisionEvent, type WatchStatus } from '../../types';
import type { HomeStackParamList } from '../../navigation/types';

const DEMO_DEVICE = 'BKK-TRT-003'; // paired portable id overrides this when connected

type Props = NativeStackScreenProps<HomeStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { telemetry, state: bleState } = usePortable();
  const [remote, setRemote] = useState<{ loading: boolean; error?: string; data?: DecisionEvent }>({ loading: true });

  const load = useCallback(() => {
    setRemote((s) => ({ ...s, loading: true }));
    getDeviceDecision(DEMO_DEVICE)
      .then((data) => setRemote({ loading: false, data }))
      .catch((e) => setRemote({ loading: false, error: String(e) }));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const usingLocal = bleState === 'connected' && telemetry != null;
  const status: WatchStatus = usingLocal
    ? (telemetry!.sensor_status === 'OK' ? 'Normal' : 'No Data')
    : remote.data ? toWatchStatus(remote.data.decision) : 'No Data';
  const pm25 = usingLocal ? telemetry!.pm25 ?? null : null;

  return (
    <Screen
      title="สวัสดี 👋"
      subtitle="Aeris"
      right={
        <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.bellBtn}>
          <Text style={styles.bell}>🔔</Text>
        </Pressable>
      }
    >
      {remote.loading && !usingLocal ? (
        <LoadingState />
      ) : (
        <HeroStatusCard
          status={status}
          pm25={pm25}
          freshnessLabel={usingLocal ? 'Live from your device' : freshnessLabel(remote.data?.freshness_sec ?? null)}
        />
      )}

      {remote.data ? (
        <InfoCard title="Why">
          {remote.data.reason_codes.map((c) => (
            <View key={c} style={styles.reasonRow}>
              <View style={[styles.reasonDot, { backgroundColor: statusColor(status) }]} />
              <Text style={styles.reason}>{c.replaceAll('_', ' ').toLowerCase()}</Text>
            </View>
          ))}
          <View style={styles.metaFooter}>
            <Text style={styles.metaChip}>Confidence · {remote.data.confidence}</Text>
            <Text style={styles.metaChip}>Samples · {remote.data.sample_size}</Text>
          </View>
        </InfoCard>
      ) : null}

      <View style={styles.quickActions}>
        <QuickAction icon="📈" label="View Exposure" onPress={() => navigation.navigate('CurrentExposure')} />
        <QuickAction icon="📍" label="Check Destination" onPress={() => navigation.getParent()?.navigate('ExploreTab' as never)} />
      </View>

      <Pressable onPress={() => navigation.navigate('DataQuality')} style={styles.dataQualityBtn}>
        <Text style={styles.dataQualityLink}>Data quality details</Text>
        <Text style={styles.dataQualityArrow}>→</Text>
      </Pressable>
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.quickBtn, pressed ? { backgroundColor: colors.bgTint } : null]} onPress={onPress}>
      <Text style={styles.quickIcon}>{icon}</Text>
      <Text style={styles.quickBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bellBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  bell: { fontSize: 18 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  reasonDot: { width: 6, height: 6, borderRadius: 3 },
  reason: { ...type.body, color: colors.text, flex: 1 },
  metaFooter: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  metaChip: { ...type.caption, color: colors.textMuted, backgroundColor: colors.bgTint, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: space.md, overflow: 'hidden' },
  quickActions: { flexDirection: 'row', gap: space.md },
  quickBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: space.lg, alignItems: 'center', gap: space.sm },
  quickIcon: { fontSize: 24 },
  quickBtnText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  dataQualityBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: space.sm },
  dataQualityLink: { ...type.secondary, color: colors.primary, fontWeight: '600' },
  dataQualityArrow: { color: colors.primary, fontWeight: '700' },
});
