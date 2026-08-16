/** Screen 04 — Current Exposure. How the environment has changed over the current period. */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getDeviceDecision, getNodeHistory } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, MetaRow, SectionLabel } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { co2Label, eco2Label, freshnessLabel, tvocLabel } from '../../lib/format';
import { useActiveDeviceId, withDevice } from '../../lib/device';
import { usePortable } from '../../state/portable';
import { colors, space, type } from '../../theme';
import type { DecisionEvent } from '../../types';

export function CurrentExposureScreen() {
  const { telemetry, state: bleState } = usePortable();
  const activeDeviceId = useActiveDeviceId();
  const [remote, setRemote] = useState<{ loading: boolean; error?: string; decision?: DecisionEvent; series: number[] }>({
    loading: true,
    series: [],
  });

  useEffect(() => {
    setRemote((s) => ({ ...s, loading: true }));
    withDevice(activeDeviceId, (id) => Promise.all([getDeviceDecision(id), getNodeHistory(id, 1)]))
      .then(([decision, history]) => {
        const series = history.points
          .map((p) => (typeof p.pm2_5 === 'number' ? p.pm2_5 : null))
          .filter((v): v is number => v != null);
        setRemote({ loading: false, decision, series });
      })
      .catch((e) => setRemote({ loading: false, error: String(e), series: [] }));
  }, [activeDeviceId]);

  const usingLocal = bleState === 'connected' && telemetry != null && telemetry.pm25 != null;
  // The trend always comes from recorded history — a single live sample is a current value,
  // not a trend, and must never be drawn as one.
  const chartValues = remote.series;
  const hasChart = chartValues.length > 1;
  const max = hasChart ? Math.max(...chartValues, 1) : 1;
  const current = usingLocal
    ? (telemetry!.pm25 as number)
    : chartValues.length
      ? chartValues[chartValues.length - 1]
      : null;

  return (
    <Screen title="Current Exposure" subtitle="การเปลี่ยนแปลงของสภาพแวดล้อมช่วงนี้">
      {remote.loading && !usingLocal ? (
        <LoadingState />
      ) : remote.error && !usingLocal ? (
        <ErrorState reason="Could not load exposure data" />
      ) : (
        <InfoCard>
          <SectionLabel>Trend</SectionLabel>
          {hasChart ? (
            <View style={styles.chart}>
              {chartValues.map((v, i) => (
                <View key={i} style={[styles.bar, { height: 8 + (v / max) * 72 }]} />
              ))}
            </View>
          ) : (
            <EmptyState title="Not enough recorded readings to show a trend" />
          )}
          <MetaRow label="Current" value={current != null ? `${current.toFixed(0)} µg/m³` : 'No Data'} />
        </InfoCard>
      )}

      {telemetry ? (
        <InfoCard title="From your device">
          <MetaRow label="CO2" value={co2Label(telemetry.co2)} />
          <MetaRow label="TVOC" value={tvocLabel(telemetry.tvoc)} />
          <MetaRow label="eCO2 (estimated)" value={eco2Label(telemetry.eco2)} />
          <Text style={styles.note}>
            CO2 is measured directly by the SCD40 sensor. eCO2 is a separate figure estimated from
            VOC sensing — the two are not interchangeable. CO2 is unavailable when the SCD40 is
            invalid; TVOC and eCO2 are unavailable while the VOC sensor warms up.
          </Text>
        </InfoCard>
      ) : null}

      {remote.decision ? (
        <InfoCard title="Data quality">
          <MetaRow label="Freshness" value={usingLocal ? 'Live from your device' : freshnessLabel(remote.decision.freshness_sec)} />
          <MetaRow label="Confidence" value={remote.decision.confidence} />
          <MetaRow label="Samples" value={`${remote.decision.sample_size}`} />
        </InfoCard>
      ) : null}

      <Text style={styles.note}>Area vs personal comparison appears once your baseline is ready.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, height: 88, marginVertical: space.sm },
  bar: { flex: 1, backgroundColor: colors.primary, borderRadius: 4, opacity: 0.8 },
  note: { ...type.caption, color: colors.textMuted },
});
