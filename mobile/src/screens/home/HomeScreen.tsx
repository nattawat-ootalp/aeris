/** Screen 03 — Home. "What is the environment like right now?" within a few seconds. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDeviceDecision } from '../../api/client';
import { InfoCard, LoadingState, SectionLabel } from '../../components/ui';
import { HeroStatusCard } from '../../components/WatchStatus';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { usePortable } from '../../state/portable';
import { colors, space, type } from '../../theme';
import { toWatchStatus, type DecisionEvent } from '../../types';
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

  // Prefer live BLE telemetry (local, works with no internet) when a portable is connected.
  const usingLocal = bleState === 'connected' && telemetry != null;
  const localStatus = usingLocal
    ? (telemetry!.sensor_status === 'OK' ? 'Normal' : 'No Data')
    : null;

  return (
    <Screen title="Aeris" subtitle="สภาพแวดล้อมตอนนี้">
      <View style={styles.header}>
        <Text style={styles.greeting}>สวัสดี 👋</Text>
        <Pressable onPress={() => navigation.navigate('Notifications')}>
          <Text style={styles.bell}>🔔</Text>
        </Pressable>
      </View>

      {remote.loading && !usingLocal ? (
        <LoadingState />
      ) : (
        <HeroStatusCard
          status={usingLocal ? (localStatus as 'Normal' | 'No Data') : remote.data ? toWatchStatus(remote.data.decision) : 'No Data'}
          freshnessLabel={usingLocal ? 'Live from your device' : freshnessLabel(remote.data?.freshness_sec ?? null)}
        />
      )}

      {telemetry?.pm25 != null ? (
        <InfoCard>
          <SectionLabel>PM2.5</SectionLabel>
          <Text style={styles.pmValue}>{telemetry.pm25.toFixed(1)} µg/m³</Text>
        </InfoCard>
      ) : null}

      {remote.data ? (
        <InfoCard title="Why">
          {remote.data.reason_codes.map((c) => (
            <Text key={c} style={styles.reason}>• {c.replaceAll('_', ' ').toLowerCase()}</Text>
          ))}
          <Text style={styles.sampleSize}>Confidence: {remote.data.confidence} · Sample size: {remote.data.sample_size}</Text>
        </InfoCard>
      ) : null}

      <View style={styles.quickActions}>
        <Pressable style={styles.quickBtn} onPress={() => navigation.navigate('CurrentExposure')}>
          <Text style={styles.quickBtnText}>View Exposure</Text>
        </Pressable>
        <Pressable style={styles.quickBtn} onPress={() => navigation.getParent()?.navigate('Explore' as never)}>
          <Text style={styles.quickBtnText}>Check Destination</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => navigation.navigate('DataQuality')}>
        <Text style={styles.dataQualityLink}>Data quality details →</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { ...type.body, color: colors.textMuted },
  bell: { fontSize: 20 },
  pmValue: { ...type.display, color: colors.text },
  reason: { ...type.body, color: colors.text, marginBottom: 2 },
  sampleSize: { ...type.caption, color: colors.textMuted, marginTop: space.sm },
  quickActions: { flexDirection: 'row', gap: space.sm },
  quickBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: space.md, alignItems: 'center' },
  quickBtnText: { color: colors.primary, fontWeight: '700' },
  dataQualityLink: { ...type.secondary, color: colors.primary, textAlign: 'center' },
});
