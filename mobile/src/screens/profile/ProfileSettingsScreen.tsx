/** Screen 18 — Profile & Settings. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileSettings'>;

const SECTIONS: { title: string; items: { label: string; nav?: keyof ProfileStackParamList }[] }[] = [
  { title: 'Device', items: [{ label: 'My Device', nav: 'PairSensor' }, { label: 'Sensor Health', nav: 'SensorHealth' }] },
  { title: 'App', items: [{ label: 'Notifications' }, { label: 'Location permission' }, { label: 'Symptom tracking' }] },
  { title: 'Data', items: [{ label: 'Privacy', nav: 'Privacy' }, { label: 'Data export' }] },
  { title: 'About', items: [{ label: 'About Aeris' }] },
];

export function ProfileSettingsScreen({ navigation }: Props) {
  return (
    <Screen title="Profile">
      {SECTIONS.map((sec) => (
        <View key={sec.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{sec.title}</Text>
          <View style={styles.card}>
            {sec.items.map((item, i) => (
              <Pressable
                key={item.label}
                style={[styles.row, i < sec.items.length - 1 ? styles.rowBorder : null]}
                onPress={() => item.nav && navigation.navigate(item.nav)}
              >
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  sectionTitle: { ...type.secondary, color: colors.textMuted, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { ...type.body, color: colors.text },
  chevron: { color: colors.textMuted, fontSize: 18 },
});
