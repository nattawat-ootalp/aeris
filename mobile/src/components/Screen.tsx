/** Consistent screen chrome: large title + scrollable padded body (UX §3.3).
 *
 *  On a viewport wider than a phone the body is capped and centred (src/lib/responsive.ts):
 *  the same markup reads as an app column on a desktop instead of a line of text stretched
 *  across the whole monitor. A phone gets no cap, so its layout is byte-for-byte unchanged. */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMeasureStyle } from '../lib/responsive';
import { colors, space, type } from '../theme';

export function Screen({ title, subtitle, right, children, scroll = true, full = false }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; scroll?: boolean; /** Opt out of the centred cap — for screens that own the whole canvas, e.g. a map. */ full?: boolean }) {
  const insets = useSafeAreaInsets();
  // `alignSelf` rather than a centring parent: the child keeps `width: '100%'` below the cap,
  // so nothing re-flows when the window is narrower than the maximum.
  const capped = useMeasureStyle();
  const measure = full ? null : capped;
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
        <View style={[measure, { flex: 1 }]}>
          {header}
          <View style={[styles.body, { flex: 1 }]}>{children}</View>
        </View>
      </View>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]} showsVerticalScrollIndicator={false}>
      <View style={measure}>
        {header}
        <View style={styles.body}>{children}</View>
      </View>
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
