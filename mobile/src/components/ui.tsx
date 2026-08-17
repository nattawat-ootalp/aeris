/** Aeris component library (UX/UI Spec §26) — modernized: soft elevation, gradients, rhythm. */
import { LinearGradient } from 'expo-linear-gradient';
import { Children, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsWide } from '../lib/responsive';
import { colors, radius, shadow, shadowSm, space, type } from '../theme';

// ── Buttons ──
export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.9 : 1 }]}>
      <LinearGradient
        colors={[colors.primary, colors.primaryDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.primaryBtn, shadowSm]}
      >
        <Text style={styles.primaryBtnText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.secondaryBtn, pressed ? { backgroundColor: colors.bgTint } : null]}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

// ── Cards ──
export function InfoCard({ title, children, style }: { title?: string; children: ReactNode; style?: object }) {
  return (
    <View style={[styles.card, shadow, style]}>
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
      <View style={styles.stateIconWrap}><Text style={styles.stateIcon}>◌</Text></View>
      <Text style={styles.stateTitle}>{title}</Text>
      {action && onAction ? <SecondaryButton label={action} onPress={onAction} /> : null}
    </View>
  );
}

export function ErrorState({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <View style={styles.stateBox}>
      <View style={[styles.stateIconWrap, { backgroundColor: colors.highSoft }]}><Text style={[styles.stateIcon, { color: colors.high }]}>!</Text></View>
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

// ── Responsive columns ──
/**
 * Lays its children side by side once the viewport is wider than a phone, and stacks them
 * otherwise. Every column is equal width, so a card pair reads as a row on a desktop without
 * either screen needing its own breakpoint logic.
 */
export function Columns({ children }: { children: ReactNode }) {
  const wide = useIsWide();
  const items = Children.toArray(children);
  if (!wide || items.length < 2) return <View style={styles.columnStack}>{items}</View>;
  return (
    <View style={styles.columnRow}>
      {items.map((child, i) => (
        <View key={i} style={styles.column}>{child}</View>
      ))}
    </View>
  );
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
  primaryBtn: { height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },
  secondaryBtn: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
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
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  stateBox: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl },
  stateIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bgTint, alignItems: 'center', justifyContent: 'center' },
  stateIcon: { fontSize: 26, color: colors.textFaint },
  stateTitle: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  skeleton: { backgroundColor: colors.divider, borderRadius: radius.md, width: '100%' },
  sectionLabel: { ...type.overline, color: colors.textFaint, textTransform: 'uppercase' },
  columnStack: { gap: space.md },
  columnRow: { flexDirection: 'row', gap: space.md, alignItems: 'stretch' },
  column: { flex: 1, gap: space.md },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, alignItems: 'center' },
  metaLabel: { ...type.secondary, color: colors.textMuted },
  metaValue: { ...type.bodyStrong, color: colors.text },
});
