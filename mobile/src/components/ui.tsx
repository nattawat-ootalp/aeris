/** Aeris component library (UX/UI Spec §26). */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

// ── Buttons ──
export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryBtn, disabled ? { opacity: 0.5 } : null]}
      accessibilityRole="button"
    >
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.secondaryBtn} accessibilityRole="button">
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

// ── Cards ──
export function InfoCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

// ── Chip (multi-select) ──
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected ? styles.chipSelected : null]}>
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

// ── Empty / Error / Skeleton states (UX §28) ──
export function EmptyState({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.stateBox}>
      <Text style={styles.stateIcon}>◌</Text>
      <Text style={styles.stateTitle}>{title}</Text>
      {action && onAction ? <SecondaryButton label={action} onPress={onAction} /> : null}
    </View>
  );
}

export function ErrorState({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <View style={styles.stateBox}>
      <Text style={[styles.stateIcon, { color: colors.high }]}>!</Text>
      <Text style={styles.stateTitle}>{reason}</Text>
      {onRetry ? <SecondaryButton label="Retry" onPress={onRetry} /> : null}
    </View>
  );
}

export function LoadingState() {
  return (
    <View style={styles.stateBox}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Skeleton({ height = 80 }: { height?: number }) {
  return <View style={[styles.skeleton, { height }]} />;
}

// ── Section heading ──
export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

// ── Metadata row (label/value) ──
export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  primaryBtn: {
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  secondaryBtnText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  cardTitle: { ...type.h2, color: colors.text, marginBottom: space.sm },
  chip: {
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextSelected: { color: '#fff', fontWeight: '700' },
  stateBox: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  stateIcon: { fontSize: 28, color: colors.textMuted },
  stateTitle: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  skeleton: { backgroundColor: colors.divider, borderRadius: radius.md, width: '100%' },
  sectionLabel: { ...type.secondary, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.xs },
  metaLabel: { ...type.secondary, color: colors.textMuted },
  metaValue: { ...type.secondary, color: colors.text, fontWeight: '700' },
});
