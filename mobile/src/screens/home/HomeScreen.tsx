/** Screen 03 — Home. "What is the environment like right now?" within a few seconds. */
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDeviceDecision, getForecast, getRisk } from '../../api/client';
import { Columns, InfoCard, LoadingState, MetaRow } from '../../components/ui';
import { HeroStatusCard } from '../../components/WatchStatus';
import { Screen } from '../../components/Screen';
import { clockLabel, freshnessLabel, measuredAtLabel } from '../../lib/format';
import { useActiveDeviceId, useThresholds, watchStatusFor, withDevice } from '../../lib/device';
import { reasonText } from '../../lib/reasons';
import { ageSeconds, useNow } from '../../lib/useNow';
import { ForecastCard, RiskCard } from '../../components/RiskCards';
import { usePortable } from '../../state/portable';
import { colors, radius, space, statusColor, type } from '../../theme';
import { toWatchStatus, type DecisionEvent, type Forecast as ForecastType, type RiskScore, type WatchStatus } from '../../types';
import type { HomeStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { telemetry, telemetryAt, state: bleState, lastDeviceName, startPairing } = usePortable();
  // `receivedAt` is kept with the data so its age can go on counting after it arrives: the
  // backend reports how old the reading was when it answered, which stops being true the
  // moment the answer is on screen.
  const [remote, setRemote] = useState<{ loading: boolean; error?: string; data?: DecisionEvent; receivedAt?: number }>({ loading: true });
  const now = useNow();
  const activeDeviceId = useActiveDeviceId();
  const thresholds = useThresholds();
  const [risk, setRisk] = useState<RiskScore | null>(null);
  const [forecast, setForecast] = useState<ForecastType | null>(null);

  const load = useCallback(() => {
    setRemote((s) => ({ ...s, loading: true }));
    withDevice(activeDeviceId, getDeviceDecision)
      .then((data) => setRemote({ loading: false, data, receivedAt: Date.now() }))
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
  // The device is reporting, but the boundaries that turn a number into a status have not
  // arrived yet. Without saying so, the card reads NO DATA beside a live measurement and
  // looks broken — the reading is fine, the yardstick is what is missing.
  const awaitingThresholds = usingLocal && thresholds == null && telemetry?.pm25 != null;
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
  // The SCD40's true CO2 and the SGP30's eco2 estimate are both shown, each labelled for what
  // it is — the estimate is never presented as the measurement.
  const co2 = usingLocal ? telemetry?.co2 : remote.data?.co2;
  const eco2 = usingLocal ? telemetry?.eco2 : remote.data?.eco2;
  // A live BLE frame carries the device's UPTIME, not a date — the portable has no clock. The
  // provider pairs it with the phone's clock (src/lib/deviceClock.ts) and hands back the real
  // capture time; reading `telemetry.ts` as an epoch printed a time in 1970 (an eight-hour
  // uptime showed as "07:24 AM"). A backend reading already carries the time it was recorded.
  const measuredAt = usingLocal
    ? telemetryAt != null
      ? new Date(telemetryAt).toISOString()
      : null
    : (remote.data?.measured_at ?? null);

  // How old the reading on screen is, right now — from the device's own capture time when the
  // portable is connected, and from the backend's freshness plus the time since it answered
  // otherwise.
  const ageSec = usingLocal
    ? ageSeconds(telemetryAt, now)
    : remote.data
      ? (remote.data.freshness_sec ?? 0) + (ageSeconds(remote.receivedAt, now) ?? 0)
      : null;

  return (
    <Screen
      title="สวัสดี"
      subtitle="NextAir"
      right={
        <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.bellBtn}>
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
        </Pressable>
      }
    >
      {remote.loading && !usingLocal ? (
        <LoadingState />
      ) : (
        <Columns>
          <HeroStatusCard
            status={status}
            pm25={pm25}
            freshnessLabel={
              usingLocal
                ? `Live from your device · ${clockLabel(measuredAt)} · ${freshnessLabel(ageSec)}${awaitingThresholds ? ' · กำลังโหลดเกณฑ์จากเซิร์ฟเวอร์' : ''}`
                : measuredAtLabel(measuredAt, ageSec)
            }
          />

          <InfoCard title="Sensor Readings">
            <Text style={styles.readingAge}>{freshnessLabel(ageSec)}</Text>
            <View style={styles.sensorGrid}>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>Temperature</Text>
                <Text style={styles.sensorValue}>
                  {temperature != null ? `${temperature.toFixed(1)}°C` : 'No Data'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>Humidity</Text>
                <Text style={styles.sensorValue}>
                  {humidity != null ? `${humidity.toFixed(0)}%` : 'No Data'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>CO2</Text>
                <Text style={styles.sensorValue}>
                  {co2 != null ? `${co2.toFixed(0)} ppm` : 'No Data'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>TVOC</Text>
                <Text style={styles.sensorValue}>
                  {tvoc != null ? `${tvoc.toFixed(0)} ppb` : 'No Data'}
                </Text>
              </View>
              <View style={styles.sensorItem}>
                <Text style={styles.sensorLabel}>eCO2 (estimated)</Text>
                <Text style={styles.sensorValue}>
                  {eco2 != null ? `${eco2.toFixed(0)} ppm` : 'No Data'}
                </Text>
              </View>
            </View>
          </InfoCard>
        </Columns>
      )}

      {remote.data ? (
        <InfoCard title="Why">
          {remote.data.reason_codes.map((c) => (
            <View key={c} style={styles.reasonRow}>
              <View style={[styles.reasonDot, { backgroundColor: statusColor(status) }]} />
              <Text style={styles.reason}>
                {reasonText(c, { thresholds, sampleSize: remote.data?.sample_size, pm25 })}
              </Text>
            </View>
          ))}

          {/* The figures the sentences above refer to. Without them the card asserts a
              conclusion and hides its inputs; with them a reader can check the reasoning
              against what the device is reporting right now. */}
          <View style={styles.whyFacts}>
            <MetaRow
              label="PM2.5 ที่อ่านได้"
              value={pm25 != null ? `${pm25.toFixed(0)} µg/m³` : 'No Data'}
            />
            {thresholds ? (
              <MetaRow
                label="เกณฑ์เฝ้าระวัง / สูง"
                value={`${thresholds.pm25_caution} / ${thresholds.pm25_high} µg/m³`}
              />
            ) : null}
            <MetaRow label="อายุข้อมูล" value={freshnessLabel(ageSec)} />
            <MetaRow
              // Named for what it counts. "Samples · 3" beside "Confidence · HIGH" read as a
              // contradiction, because the two describe different things: how much personal
              // history exists, and how good the reading in front of you is.
              label="ตัวอย่างสำหรับค่าฐานส่วนตัว"
              value={
                thresholds
                  ? `${remote.data.sample_size} จาก ${thresholds.baseline_min_samples}`
                  : `${remote.data.sample_size}`
              }
            />
            <MetaRow label="ความมั่นใจในค่าที่อ่านได้" value={remote.data.confidence} />
          </View>
        </InfoCard>
      ) : null}

      <Columns>
        <RiskCard risk={risk} />
        <ForecastCard forecast={forecast} />
      </Columns>

      {bleState === 'disconnected' && lastDeviceName ? (
        // Reloading a page drops the Bluetooth connection, and a browser will not hand it back
        // without a click. One tap here reopens the chooser on the device already paired,
        // rather than sending the user back through Profile → Pair sensor.
        <Pressable onPress={startPairing} style={({ pressed }) => [styles.reconnectBtn, pressed ? { opacity: 0.85 } : null]}>
          <Ionicons name="bluetooth-outline" size={20} color={colors.primary} />
          <Text style={styles.reconnectText}>เชื่อมต่อ {lastDeviceName} อีกครั้ง</Text>
        </Pressable>
      ) : null}

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
  readingAge: { ...type.caption, color: colors.textMuted, marginBottom: space.sm },
  reconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    paddingVertical: space.md,
  },
  reconnectText: { ...type.bodyStrong, color: colors.primary },
  bellBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  reasonDot: { width: 6, height: 6, borderRadius: 3 },
  reason: { ...type.body, color: colors.text, flex: 1 },
  metaFooter: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  whyFacts: { marginTop: space.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.xs },
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
