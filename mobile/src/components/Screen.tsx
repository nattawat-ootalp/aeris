/** Consistent screen chrome: title + scrollable padded body (UX §3.3). */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme';

export function Screen({ title, subtitle, children, scroll = true }: { title: string; subtitle?: string; children: ReactNode; scroll?: boolean }) {
  const body = (
    <>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.body}>{children}</View>
    </>
  );
  if (!scroll) return <View style={styles.root}>{body}</View>;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.xl, paddingBottom: space.xl * 2 },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.secondary, color: colors.textMuted, marginTop: space.xs },
  body: { marginTop: space.lg, gap: space.md },
});
