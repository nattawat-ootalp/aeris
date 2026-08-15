/** Screen 01 — Onboarding. Explain Aeris briefly, then lead to device pairing. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../components/ui';
import { markOnboarded } from '../../lib/onboarding';
import { colors, radius, space, type } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen({ navigation }: Props) {
  async function start() {
    await markOnboarded();
    navigation.replace('Main');
  }

  return (
    <View style={styles.root}>
      <Text style={styles.logo}>Aeris</Text>
      <View style={styles.center}>
        <View style={styles.deviceArt} />
        <Text style={styles.headline}>เข้าใจสภาพแวดล้อมรอบตัวคุณ{'\n'}แบบเฉพาะบุคคล</Text>
      </View>
      <View style={styles.bottom}>
        <PrimaryButton label="เริ่มต้นใช้งาน" onPress={start} />
        <Text style={styles.privacyNote}>ข้อมูลของคุณเป็นส่วนตัวและอยู่ในการควบคุมของคุณเสมอ</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'space-between' },
  logo: { ...type.h1, color: colors.primary, textAlign: 'center', marginTop: space.xl },
  center: { alignItems: 'center', gap: space.lg },
  deviceArt: { width: 140, height: 140, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  headline: { ...type.h1, color: colors.text, textAlign: 'center' },
  bottom: { gap: space.sm, paddingBottom: space.lg },
  privacyNote: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
