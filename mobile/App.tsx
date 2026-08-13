/**
 * Aeris mobile — app shell.
 *
 * A dependency-free bottom-tab switcher hosts the five MVP screens (TDD §7). Kept as a
 * simple switcher for the scaffold to avoid native-nav install churn; swapping in
 * @react-navigation/bottom-tabs later is a drop-in per screen.
 */
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactElement } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { CurrentEnvironmentScreen } from './src/screens/CurrentEnvironmentScreen';
import { DestinationAssessmentScreen } from './src/screens/DestinationAssessmentScreen';
import { DeviceHealthScreen } from './src/screens/DeviceHealthScreen';
import { PrivacyControlScreen } from './src/screens/PrivacyControlScreen';
import { SymptomEventScreen } from './src/screens/SymptomEventScreen';
import { colors, space } from './src/theme';

type TabKey = 'env' | 'destination' | 'symptom' | 'device' | 'privacy';

const TABS: { key: TabKey; label: string; icon: string; render: () => ReactElement }[] = [
  { key: 'env', label: 'Now', icon: '🌤️', render: () => <CurrentEnvironmentScreen /> },
  { key: 'destination', label: 'Destination', icon: '📍', render: () => <DestinationAssessmentScreen /> },
  { key: 'symptom', label: 'Symptom', icon: '📝', render: () => <SymptomEventScreen /> },
  { key: 'device', label: 'Device', icon: '🔋', render: () => <DeviceHealthScreen /> },
  { key: 'privacy', label: 'Privacy', icon: '🔒', render: () => <PrivacyControlScreen /> },
];

export default function App() {
  const [active, setActive] = useState<TabKey>('env');
  const current = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.content}>{current.render()}</View>
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const focused = t.key === active;
          return (
            <Pressable key={t.key} style={styles.tab} onPress={() => setActive(t.key)}>
              <Text style={styles.tabIcon}>{t.icon}</Text>
              <Text style={[styles.tabLabel, focused ? styles.tabLabelActive : null]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingBottom: space.sm,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm, gap: 2 },
  tabIcon: { fontSize: 18 },
  tabLabel: { fontSize: 11, color: colors.textMuted },
  tabLabelActive: { color: colors.text, fontWeight: '700' },
});
