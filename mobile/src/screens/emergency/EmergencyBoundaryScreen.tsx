/**
 * Screen 20 — Emergency Boundary. Prevents Aeris from being read as a diagnostic device
 * (TDD §1.2/§9/§14, UX §25). No red-scare color, no risk numbers, no "safe/unsafe", no
 * treatment instructions.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../components/ui';
import { useMeasureStyle } from '../../lib/responsive';
import { colors, space, type } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EmergencyBoundary'>;

export function EmergencyBoundaryScreen({ navigation }: Props) {
  // Capped and centred on a desktop; unchanged on a phone (src/lib/responsive.ts).
  const measure = useMeasureStyle();
  return (
    <View style={[styles.root, measure]}>
      <Text style={styles.title}>Your event has been recorded</Text>
      <Text style={styles.body}>
        NextAir tracks environmental exposure and what you report feeling. It does not diagnose
        conditions, does not know if this is a medical emergency, and cannot tell you what to do
        next.
      </Text>
      <Text style={styles.body}>
        If you have a care plan from a healthcare professional, please follow it now. If you
        believe this is an emergency, contact local emergency services.
      </Text>
      <PrimaryButton label="Continue" onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center', gap: space.md },
  title: { ...type.h1, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.text, textAlign: 'center' },
});
