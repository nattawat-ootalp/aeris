/**
 * The Hero Status card (Home/Destination) and the compact StatusBadge (lists).
 * Input is the closed `WatchStatus` union — "Safe" cannot be passed (TDD §7/§14).
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, space, statusBg, statusColor, statusCopy, type } from '../theme';
import type { WatchStatus as Status } from '../types';

const ICON: Record<Status, keyof typeof Ionicons.glyphMap> = {
  Normal: 'checkmark-circle',
  Caution: 'warning',
  High: 'alert-circle',
  'No Data': 'help-circle',
};

export function HeroStatusCard({ status, freshnessLabel, pm25 }: { status: Status; freshnessLabel?: string; pm25?: number | null }) {
  const color = statusColor(status);
  return (
    <LinearGradient
      colors={[statusBg(status), colors.surface]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.hero, shadow, { borderColor: color + '22' }]}
    >
      <View style={[styles.decorRing, { borderColor: color + '18' }]} />
      <View style={[styles.iconBadge, { backgroundColor: color }]}>
        <Ionicons name={ICON[status]} size={26} color="#fff" />
      </View>
      <Text style={[styles.heroLabel, { color }]}>{status.toUpperCase()}</Text>
      <Text style={styles.heroDesc}>{statusCopy[status]}</Text>
      {pm25 != null ? (
        <View style={styles.pmRow}>
          <Text style={[styles.pmValue, { color: colors.text }]}>{pm25.toFixed(0)}</Text>
          <Text style={styles.pmUnit}>µg/m³ PM2.5</Text>
        </View>
      ) : null}
      {freshnessLabel ? (
        <View style={styles.freshnessChip}>
          <View style={[styles.freshnessDot, { backgroundColor: color }]} />
          <Text style={styles.freshnessText}>{freshnessLabel}</Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

export function StatusBadge({ status, subtitle }: { status: Status; subtitle?: string }) {
  const color = statusColor(status);
  return (
    <View style={[styles.badge, shadow]}>
      <View style={[styles.badgeAccent, { backgroundColor: color }]} />
      <View style={[styles.badgeIcon, { backgroundColor: statusBg(status) }]}>
        <Ionicons name={ICON[status]} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{status}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    overflow: 'hidden',
  },
  decorRing: { position: 'absolute', top: -60, right: -40, width: 160, height: 160, borderRadius: 80, borderWidth: 30 },
  iconBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  iconText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  heroLabel: { ...type.hero, fontSize: 38 },
  heroDesc: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: space.xs, paddingHorizontal: space.sm },
  pmRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: space.md },
  pmValue: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  pmUnit: { ...type.secondary, color: colors.textMuted },
  freshnessChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md, backgroundColor: colors.surface, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border },
  freshnessDot: { width: 7, height: 7, borderRadius: 4 },
  freshnessText: { ...type.caption, color: colors.textMuted },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.md,
    paddingLeft: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  badgeAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  badgeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badgeIconText: { fontSize: 18, fontWeight: '800' },
  label: { ...type.h2, color: colors.text },
  subtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
});

// Backward-compat alias used by earlier screens.
export { StatusBadge as WatchStatus };
