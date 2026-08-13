/**
 * Small shared UI primitives (scaffold-level). Kept dependency-free.
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';

export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <Text style={styles.h1}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children, accent, title }: { children: ReactNode; accent?: string; title?: string }) {
  return (
    <View style={[styles.card, accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export function Banner({ children, accent = colors.privacy }: { children: ReactNode; accent?: string }) {
  return (
    <View style={[styles.banner, { borderColor: accent, backgroundColor: `${accent}18` }]}>
      <Text style={[styles.bannerText, { color: accent }]}>{children}</Text>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  h1: { color: colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 14, marginTop: -space.xs, marginBottom: space.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: space.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space.md },
  bannerText: { fontSize: 13, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 13 },
});
