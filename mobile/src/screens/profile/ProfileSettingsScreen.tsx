/** Screen 18 — Profile & Settings. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { getMyDevices } from '../../api/client';
import { Screen } from '../../components/Screen';
import { useRemote } from '../../lib/useRemote';
import { usePortable } from '../../state/portable';
import { colors, space, type } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileSettings'>;
type Row = { label: string; hint?: string; onPress: () => void };

export function ProfileSettingsScreen({ navigation }: Props) {
  const { state, deviceName } = usePortable();
  const { data } = useRemote(useCallback(() => getMyDevices(), []));
  const registered = data?.devices ?? [];

  const sections: { title: string; items: Row[] }[] = [
    {
      title: 'Device',
      items: [
        {
          label: 'My Device',
          hint:
            state === 'connected' && deviceName
              ? `Connected · ${deviceName}`
              : registered.length
                ? `${registered.length} paired · not connected`
                : 'Not paired',
          onPress: () => navigation.navigate('PairSensor'),
        },
        { label: 'Sensor Health', onPress: () => navigation.navigate('SensorHealth') },
      ],
    },
    {
      title: 'App',
      items: [
        { label: 'Notifications', onPress: () => navigation.navigate('Notifications') },
        {
          label: 'Location permission',
          hint: 'Opens your system settings',
          // Permission state is owned by the OS — send the user to the one place that can
          // actually change it rather than showing a switch the app cannot honour.
          onPress: () => { Linking.openSettings().catch(() => {}); },
        },
        {
          label: 'Symptom tracking',
          hint: 'Record an event',
          onPress: () => navigation.getParent()?.navigate('ExposureTab' as never),
        },
      ],
    },
    {
      title: 'Data',
      items: [
        { label: 'Privacy', onPress: () => navigation.navigate('Privacy') },
        { label: 'Data export', hint: 'Export or delete your synced data', onPress: () => navigation.navigate('Privacy') },
      ],
    },
    { title: 'About', items: [{ label: 'About Aeris', onPress: () => navigation.navigate('About') }] },
  ];

  return (
    <Screen title="Profile">
      {sections.map((sec) => (
        <View key={sec.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{sec.title}</Text>
          <View style={styles.card}>
            {sec.items.map((item, i) => (
              <Pressable
                key={item.label}
                style={[styles.row, i < sec.items.length - 1 ? styles.rowBorder : null]}
                onPress={item.onPress}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  {item.hint ? <Text style={styles.rowHint}>{item.hint}</Text> : null}
                </View>
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
  rowHint: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: 18 },
});
