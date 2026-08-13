/**
 * The "Watch" status indicator (TDD §7). By typing `status` as {@link WatchStatus},
 * it is a COMPILE error to ever pass "Safe"/"SAFE" here — the four allowed labels are
 * the only inputs. This is the single component every screen uses to show a status,
 * so the no-SAFE rule is enforced by construction at the one place it matters.
 */
import { StyleSheet, Text, View } from 'react-native';
import { radius, space, statusColor } from '../theme';
import type { WatchStatus } from '../types';

export function StatusBadge({ status, size = 'md' }: { status: WatchStatus; size?: 'sm' | 'md' | 'lg' }) {
  const color = statusColor(status);
  const dim = size === 'lg' ? styles.lg : size === 'sm' ? styles.sm : styles.md;
  return (
    <View style={[styles.badge, dim, { borderColor: color, backgroundColor: `${color}22` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.lg,
    gap: space.sm,
  },
  sm: { paddingVertical: 2, paddingHorizontal: space.sm },
  md: { paddingVertical: space.xs, paddingHorizontal: space.md },
  lg: { paddingVertical: space.sm, paddingHorizontal: space.lg },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontWeight: '700', fontSize: 15 },
});
