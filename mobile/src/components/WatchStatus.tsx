/**
 * The single status badge used across the app and on the watch surface.
 * Its only input is the closed `WatchStatus` union — "Safe" cannot be passed (TDD §7/§14).
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, statusColor } from '../theme';
import type { WatchStatus as Status } from '../types';

export function WatchStatus({ status, subtitle }: { status: Status; subtitle?: string }) {
  return (
    <View style={[styles.badge, { borderColor: statusColor(status) }]}>
      <View style={[styles.dot, { backgroundColor: statusColor(status) }]} />
      <View>
        <Text style={styles.label}>{status}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  label: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
