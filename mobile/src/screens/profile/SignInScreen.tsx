/** Screen 19 — Sign in / create an account.
 *
 *  Reachable from anywhere that needs an account, never a gate at startup: the map, the
 *  station data and the live device all work with no account at all, and putting a login wall
 *  in front of them would take away something that already works.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { InfoCard, PrimaryButton, SecondaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../state/auth';
import { colors, radius, space, type } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'SignIn'>;
type Mode = 'sign_in' | 'create';

export function SignInScreen({ navigation }: Props) {
  const { status, isAnonymous, pendingVerification, createAccount, signIn, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const failure = mode === 'create'
      ? await createAccount(email.trim(), password)
      : await signIn(email.trim(), password);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    if (mode === 'create' && pendingVerification) {
      setNotice('ส่งลิงก์ยืนยันไปที่อีเมลแล้ว — เปิดลิงก์ก่อน แล้วกลับมาตั้งรหัสผ่าน');
      return;
    }
    navigation.goBack();
  }

  async function forgotPassword() {
    if (!email.trim()) {
      setError('กรอกอีเมลก่อน แล้วกดลืมรหัสผ่านอีกครั้ง');
      return;
    }
    setBusy(true);
    const failure = await resetPassword(email.trim());
    setBusy(false);
    setError(failure);
    if (!failure) setNotice('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว');
  }

  if (status === 'unconfigured') {
    return (
      <Screen title="บัญชี">
        <InfoCard>
          <Text style={styles.body}>
            แอปนี้ยังไม่ได้ตั้งค่าการเชื่อมต่อบัญชี ข้อมูลที่บันทึกจะอยู่บนเครื่องนี้เท่านั้น
          </Text>
        </InfoCard>
      </Screen>
    );
  }

  return (
    <Screen
      title={mode === 'create' ? 'สร้างบัญชี' : 'ลงชื่อเข้าใช้'}
      subtitle="เพื่อให้ข้อมูลของคุณตามไปกับบัญชี ไม่ใช่กับเครื่อง"
    >
      {/* The one thing a user must understand before doing either: what happens to what they
          have already recorded. The two answers are opposite, so both are stated. */}
      <InfoCard>
        {isAnonymous && mode === 'create' ? (
          <Text style={styles.body}>
            ข้อมูลที่คุณบันทึกไว้แล้วบนเครื่องนี้จะยังอยู่ครบ — การสร้างบัญชีคือการใส่อีเมลให้บัญชีเดิมที่ใช้อยู่
            ไม่ได้ย้ายไปบัญชีใหม่
          </Text>
        ) : (
          <Text style={styles.body}>
            เมื่อลงชื่อเข้าใช้บัญชีอื่น แอปจะแสดงข้อมูลของบัญชีนั้น
            ส่วนข้อมูลที่บันทึกไว้บนเครื่องนี้โดยยังไม่ผูกบัญชี จะไม่ถูกรวมเข้าไปด้วย
          </Text>
        )}
      </InfoCard>

      <InfoCard>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="อีเมล"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          textContentType={mode === 'create' ? 'newPassword' : 'password'}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <PrimaryButton
          label={busy ? 'กำลังดำเนินการ…' : mode === 'create' ? 'สร้างบัญชี' : 'ลงชื่อเข้าใช้'}
          onPress={submit}
          disabled={!canSubmit}
        />
      </InfoCard>

      <View style={styles.alt}>
        <SecondaryButton
          label={mode === 'create' ? 'มีบัญชีอยู่แล้ว — ลงชื่อเข้าใช้' : 'ยังไม่มีบัญชี — สร้างบัญชี'}
          onPress={() => { setMode(mode === 'create' ? 'sign_in' : 'create'); setError(null); setNotice(null); }}
        />
        {mode === 'sign_in' ? <SecondaryButton label="ลืมรหัสผ่าน" onPress={forgotPassword} /> : null}
      </View>

      <Text style={styles.footnote}>
        บัญชีใช้เพื่อให้ข้อมูลสุขภาพของคุณเป็นของคุณคนเดียว — ข้อมูลเหล่านี้เข้าถึงได้เฉพาะบัญชีเจ้าของเท่านั้น
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...type.secondary, color: colors.textMuted, lineHeight: 20 },
  input: {
    ...type.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.sm,
    backgroundColor: colors.bg,
  },
  error: { ...type.caption, color: colors.high, marginBottom: space.sm },
  notice: { ...type.caption, color: colors.primary, marginBottom: space.sm },
  alt: { gap: space.sm },
  footnote: { ...type.caption, color: colors.textMuted, lineHeight: 18 },
});
