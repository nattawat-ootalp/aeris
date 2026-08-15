/**
 * Personalized Risk Score (§5.9) and Predictive Alert (§5.10) cards.
 *
 * Both render "no data" as its own state rather than as a low number, and both always show
 * what the figure rests on — confidence, sample size, and for the projection its uncertainty
 * band. A trend or a score shown bare would read as a certainty neither one carries.
 */
import { StyleSheet, Text, View } from 'react-native';
import { InfoCard } from './ui';
import { colors, radius, space, statusColor, type } from '../theme';
import type { Forecast, RiskScore, WatchStatus } from '../types';

const COMPONENT_LABELS: Record<string, string> = {
  environmental: 'Environment',
  duration: 'Time elevated',
  personal_baseline: 'vs your baseline',
  symptom_history: 'Recent entries',
  temporal: 'Time of day',
};

export function RiskCard({ risk }: { risk: RiskScore | null }) {
  if (!risk) return null;
  const label = risk.watch_label as WatchStatus;
  const color = statusColor(label);

  if (risk.score == null) {
    return (
      <InfoCard title="Risk indicator">
        <Text style={styles.noData}>ข้อมูลไม่พอสำหรับคำนวณค่านี้</Text>
        <Text style={styles.reasons}>{formatReasons(risk.reason_codes)}</Text>
        <Text style={styles.note}>{risk.note}</Text>
      </InfoCard>
    );
  }

  const parts = Object.entries(risk.components)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <InfoCard title="Risk indicator">
      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color }]}>{Math.round(risk.score)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.scoreOf}>/ 100</Text>
          <Text style={[styles.band, { color }]}>{label}</Text>
        </View>
      </View>

      {parts.length ? (
        <View style={styles.bars}>
          {parts.map(([key, value]) => (
            <View key={key} style={styles.barRow}>
              <Text style={styles.barLabel}>{COMPONENT_LABELS[key] ?? key}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.min(100, value * 100)}%`, backgroundColor: color }]} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.metaFooter}>
        <Text style={styles.metaChip}>Confidence · {risk.confidence}</Text>
        <Text style={styles.metaChip}>Samples · {risk.sample_size}</Text>
      </View>
      <Text style={styles.note}>{risk.note}</Text>
    </InfoCard>
  );
}

export function ForecastCard({ forecast }: { forecast: Forecast | null }) {
  if (!forecast) return null;
  const minutes = Math.round(forecast.horizon_sec / 60);

  if (!forecast.available || forecast.projected_pm25 == null) {
    return (
      <InfoCard title={`Next ${minutes} min`}>
        <Text style={styles.noData}>ยังพยากรณ์ไม่ได้ — ข้อมูลล่าสุดไม่พอหรือขาดช่วง</Text>
        <Text style={styles.reasons}>{formatReasons(forecast.reason_codes)}</Text>
      </InfoCard>
    );
  }

  const color = statusColor(forecast.watch_label as WatchStatus);
  const trend = forecast.trend_per_hour ?? 0;
  const arrow = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';

  return (
    <InfoCard title={`Next ${minutes} min`}>
      <View style={styles.forecastRow}>
        <Text style={[styles.projected, { color }]}>
          {arrow} {forecast.projected_pm25.toFixed(0)}
        </Text>
        <Text style={styles.unit}>
          µg/m³ {forecast.uncertainty != null ? `± ${forecast.uncertainty.toFixed(0)}` : ''}
        </Text>
      </View>
      <Text style={styles.reasons}>{formatReasons(forecast.reason_codes)}</Text>
      <View style={styles.metaFooter}>
        <Text style={styles.metaChip}>Confidence · {forecast.confidence}</Text>
        <Text style={styles.metaChip}>Samples · {forecast.sample_size}</Text>
      </View>
      <Text style={styles.note}>{forecast.note}</Text>
    </InfoCard>
  );
}

function formatReasons(codes: string[]): string {
  return codes.map((c) => c.replaceAll('_', ' ').toLowerCase()).join(' · ');
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginBottom: space.md },
  score: { ...type.hero },
  scoreOf: { ...type.caption, color: colors.textFaint },
  band: { ...type.h2 },
  bars: { gap: space.sm, marginBottom: space.md },
  barRow: { gap: 4 },
  barLabel: { ...type.caption, color: colors.textMuted },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bgTint, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  forecastRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  projected: { ...type.display },
  unit: { ...type.secondary, color: colors.textMuted, paddingBottom: 6 },
  noData: { ...type.body, color: colors.textMuted },
  reasons: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
  metaFooter: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  metaChip: {
    ...type.caption,
    color: colors.textMuted,
    backgroundColor: colors.bgTint,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  note: { ...type.caption, color: colors.textFaint, marginTop: space.sm, lineHeight: 16 },
});
