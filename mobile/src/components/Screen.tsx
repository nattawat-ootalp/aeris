/** Consistent screen chrome: large title + scrollable padded body (UX §3.3). */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, type } from '../theme';

export function Screen({ title, subtitle, right, children, scroll = true }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
  if (!scroll) {
    return (
      <View style={[styles.root, styles.rootPad, { paddingTop: insets.top + space.sm }]}>
        {header}
        <View style={[styles.body, { flex: 1 }]}>{children}</View>
      </View>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]} showsVerticalScrollIndicator={false}>
      {header}
      <View style={styles.body}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rootPad: { paddingHorizontal: space.lg },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: space.lg },
  subtitle: { ...type.secondary, color: colors.textMuted, marginBottom: 2 },
  title: { ...type.h1, color: colors.text },
  body: { gap: space.md },
});
