/**
 * The single Hero Status card used on Home/Destination and the compact StatusBadge used
 * elsewhere. Input is the closed `WatchStatus` union — "Safe" cannot be passed (TDD §7/§14).
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, statusBg, statusColor, statusCopy, type } from '../theme';
import type { WatchStatus as Status } from '../types';

const ICON: Record<Status, string> = { Normal: '●', Caution: '▲', High: '■', 'No Data': '?' };

export function HeroStatusCard({ status, freshnessLabel }: { status: Status; freshnessLabel?: string }) {
  return (
    <View style={[styles.hero, { backgroundColor: statusBg(status), borderColor: statusColor(status) }]}>
      <Text style={[styles.heroIcon, { color: statusColor(status) }]}>{ICON[status]}</Text>
      <Text style={[styles.heroLabel, { color: statusColor(status) }]}>{status.toUpperCase()}</Text>
      <Text style={styles.heroDesc}>{statusCopy[status]}</Text>
      {freshnessLabel ? <Text style={styles.heroFreshness}>{freshnessLabel}</Text> : null}
    </View>
  );
}

export function StatusBadge({ status, subtitle }: { status: Status; subtitle?: string }) {
  return (
    <View style={[styles.badge, { borderColor: statusColor(status) }]}>
      <Text style={[styles.dot, { color: statusColor(status) }]}>{ICON[status]}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{status}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: space.lg,
    alignItems: 'center',
    gap: space.xs,
  },
  heroIcon: { fontSize: 22 },
  heroLabel: { ...type.display, letterSpacing: 1 },
  heroDesc: { ...type.body, color: colors.text, textAlign: 'center', marginTop: space.xs },
  heroFreshness: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface,
  },
  dot: { fontSize: 18 },
  label: { ...type.h2, color: colors.text },
  subtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
});

// Backward-compat alias used by earlier screens.
export { StatusBadge as WatchStatus };
