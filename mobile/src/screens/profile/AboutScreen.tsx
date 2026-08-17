/** About Aeris — what the app is, what it deliberately is not, and what build you're running. */
import { useCallback } from 'react';
import * as Application from 'expo-application';
import { StyleSheet, Text } from 'react-native';
import { getHealth, BASE_URL } from '../../api/client';
import { InfoCard, MetaRow } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { useRemote } from '../../lib/useRemote';
import { colors, type } from '../../theme';

export function AboutScreen() {
  const { data, error } = useRemote(useCallback(() => getHealth(), []));

  return (
    <Screen title="About NextAir" subtitle="เกี่ยวกับแอป">
      <InfoCard title="App">
        <MetaRow label="Version" value={Application.nativeApplicationVersion ?? 'No Data'} />
        <MetaRow label="Build" value={Application.nativeBuildVersion ?? 'No Data'} />
        <MetaRow label="API" value={BASE_URL} />
        <MetaRow label="Service" value={error ? 'Unreachable' : (data?.status ?? 'Checking…')} />
      </InfoCard>
      <InfoCard title="What NextAir does">
        <Text style={styles.body}>
          NextAir measures the environment around you, records what you choose to report, and shows
          you both together over time.
        </Text>
      </InfoCard>
      <InfoCard title="What NextAir does not do">
        <Text style={styles.body}>
          It does not diagnose any condition, does not tell you whether a place is medically
          suitable for you, and does not replace advice from a healthcare professional.
        </Text>
      </InfoCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...type.body, color: colors.text },
});
