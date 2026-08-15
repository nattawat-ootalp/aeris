/** Screen 03 — Home. "What is the environment like right now?" within a few seconds. */
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDeviceDecision, getForecast, getRisk } from '../../api/client';
import { InfoCard, LoadingState } from '../../components/ui';
import { HeroStatusCard } from '../../components/WatchStatus';
import { Screen } from '../../components/Screen';
import { freshnessLabel } from '../../lib/format';
import { useActiveDeviceId, useThresholds, watchStatusFor, withDevice } from '../../lib/device';
import { ForecastCard, RiskCard } from '../../components/RiskCards';
import { usePortable } from '../../state/portable';
import { colors, radius, space, statusColor, type } from '../../theme';
import { toWatchStatus, type DecisionEvent, type Forecast as ForecastType, type RiskScore, type WatchStatus } from '../../types';
import type { HomeStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { telemetry, state: bleState } = usePortable();
  const [remote, setRemote] = useState<{ loading: boolean; error?: string; data?: DecisionEvent }>({ loading: true });
  const activeDeviceId = useActiveDeviceId();
  const thresholds = useThresholds();
  const [risk, setRisk] = useState<RiskScore | null>(null);
  const [forecast, setForecast] = useState<ForecastType | null>(null);

  const load = useCallback(() => {
    setRemote((s) => ({ ...s, loading: true }));
    withDevice(activeDeviceId, getDeviceDecision)
      .then((data) => setRemote({ loading: false, data }))
      .catch((e) => setRemote({ loading: false, error: String(e) }));
  }, [activeDeviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  // Risk and projection are independent of the current-decision call: either can be absent
  // (unauthenticated, or too little data) without blocking the rest of the screen.
  useEffect(() => {
    let cancelled = false;
    withDevice(activeDeviceId, getRisk)
      .then((r) => { if (!cancelled) setRisk(r); })
      .catch(() => { if (!cancelled) setRisk(null); });
    withDevice(activeDeviceId, (id) => getForecast(id))
      .then((f) => { if (!cancelled) setForecast(f); })
      .catch(() => { if (!cancelled) setForecast(null); });
    return () => { cancelled = true; };
  }, [activeDeviceId]);

  const usingLocal = bleState === 'connected' && telemetry != null;
  // A live local reading is labelled with the backend's own thresholds; an unusable PM
  // sensor stays "No Data" rather than being reported as Normal.
  const status: WatchStatus = usingLocal
    ? telemetry!.sensor_status === 'OK'
      ? watchStatusFor(telemetry!.pm25, thresholds)
      : 'No Data'
    : remote.data ? toWatchStatus(remote.data.decision) : 'No Data';
  const pm25 = usingLocal ? telemetry!.pm25 ?? null : (remote.data?.pm25 ?? null);
  const temperature = usingLocal ? telemetry?.temperature : remote.data?.temperature;
  const humidity = usingLocal ? telemetry?.humidity : remote.data?.humidity;
  const tvoc = usingLocal ? telemetry?.tvoc : remote.data?.tvoc;
  const eco2 = usingLocal ? telemetry?.eco2 : remote.data?.eco2;

  return (
    <Screen
      title="สวัสดี"
      subtitle="Aeris"
      right={
        <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.bellBtn}>
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
        </Pressable>
      }
    >
      {remote.loading && !usingLocal ? (
        <LoadingState />
      ) : (
        <>
          <HeroStatusCard
            status={status}
            pm25={pm25}
            freshnessLabel={usingLocal ? 'Live from your device' : freshnessLabel(remote.data?.freshness_sec ?? null)}
          />

          <InfoCard title="Sensor Readings">
            <View style={styles.sensorGrid}>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>Temperature</Text>
                <Text style={styles.sensorValue}>
                  {temperature != null ? `${temperature.toFixed(1)}°C` : '--'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>Humidity</Text>
                <Text style={styles.sensorValue}>
                  {humidity != null ? `${humidity.toFixed(0)}%` : '--'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>TVOC</Text>
                <Text style={styles.sensorValue}>
                  {tvoc != null ? `${tvoc.toFixed(0)} ppb` : '--'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>eCO2</Text>
                <Text style={styles.sensorValue}>
                  {eco2 != null ? `${eco2.toFixed(0)} ppm` : '--'}
                </Text>
              </View>
            </View>
          </InfoCard>
        </>
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

      <RiskCard risk={risk} />
      <ForecastCard forecast={forecast} />

      <Pressable
        onPress={() => navigation.getParent()?.navigate('Sos' as never)}
        style={({ pressed }) => [styles.sosBtn, pressed ? { opacity: 0.85 } : null]}
      >
        <Ionicons name="alert-circle-outline" size={20} color={colors.high} />
        <Text style={styles.sosText}>SOS — บันทึกเหตุการณ์และดูแผนของคุณ</Text>
      </Pressable>

      <View style={styles.quickActions}>
        <QuickAction icon="trending-up-outline" label="View Exposure" onPress={() => navigation.navigate('CurrentExposure')} />
        <QuickAction icon="location-outline" label="Check Destination" onPress={() => navigation.getParent()?.navigate('ExploreTab' as never)} />
      </View>

      <Pressable onPress={() => navigation.navigate('DataQuality')} style={styles.dataQualityBtn}>
        <Text style={styles.dataQualityLink}>Data quality details</Text>
        <Text style={styles.dataQualityArrow}>→</Text>
      </Pressable>
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.quickBtn, pressed ? { backgroundColor: colors.bgTint } : null]} onPress={onPress}>
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={styles.quickBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sosBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.highSoft,
    borderRadius: radius.lg,
    paddingVertical: space.md,
  },
  sosText: { ...type.bodyStrong, color: colors.high },
  bellBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  reasonDot: { width: 6, height: 6, borderRadius: 3 },
  reason: { ...type.body, color: colors.text, flex: 1 },
  metaFooter: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  metaChip: { ...type.caption, color: colors.textMuted, backgroundColor: colors.bgTint, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: space.md, overflow: 'hidden' },
  quickActions: { flexDirection: 'row', gap: space.md },
  quickBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: space.lg, alignItems: 'center', gap: space.sm },
  quickBtnText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  dataQualityBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: space.sm },
  dataQualityLink: { ...type.secondary, color: colors.primary, fontWeight: '600' },
  dataQualityArrow: { color: colors.primary, fontWeight: '700' },
  sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.md, marginTop: space.xs },
  sensorItem: { width: '47%', backgroundColor: colors.bgTint, borderRadius: radius.md, padding: space.md, alignItems: 'center' },
  sensorLabel: { ...type.caption, color: colors.textMuted, marginBottom: 4 },
  sensorValue: { fontSize: 20, fontWeight: '700', color: colors.text },
});
