/** Screen 20 — Account. What the app is acting as, and the one destructive thing about it. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InfoCard, MetaRow, PrimaryButton, SecondaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../state/auth';
import { colors, space, type } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Account'>;

export function AccountScreen({ navigation }: Props) {
  const { status, email, isAnonymous, pendingVerification, signOut } = useAuth();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  if (status === 'unconfigured') {
    return (
      <Screen title="บัญชี">
        <InfoCard>
          <Text style={styles.body}>
            ยังไม่ได้ตั้งค่าการเชื่อมต่อบัญชี ข้อมูลที่บันทึกจะอยู่บนเครื่องนี้เท่านั้น
          </Text>
        </InfoCard>
      </Screen>
    );
  }

  const stateLabel = status === 'signed_in'
    ? (email ?? 'ลงชื่อเข้าใช้แล้ว')
    : isAnonymous
      ? 'ยังไม่ได้ผูกบัญชี'
      : 'ออกจากระบบแล้ว';

  return (
    <Screen title="บัญชี">
      <InfoCard>
        <MetaRow label="สถานะ" value={stateLabel} />
        {pendingVerification ? (
          <Text style={styles.notice}>
            ส่งลิงก์ยืนยันไปที่อีเมลแล้ว — เปิดลิงก์ก่อน จึงจะตั้งรหัสผ่านได้
          </Text>
        ) : null}
      </InfoCard>

      {isAnonymous ? (
        <InfoCard title="ข้อมูลของคุณอยู่บนเครื่องนี้">
          <Text style={styles.body}>
            ตอนนี้ข้อมูลที่บันทึกผูกอยู่กับเครื่องนี้เท่านั้น ถ้าลบแอปหรือเปลี่ยนเครื่อง จะเข้าถึงไม่ได้อีก
            การใส่อีเมลและรหัสผ่านจะผูกข้อมูลชุดเดิมเข้ากับบัญชี — ไม่ได้สร้างข้อมูลใหม่และไม่มีอะไรหาย
          </Text>
          <View style={styles.actions}>
            <PrimaryButton label="ใส่อีเมลและรหัสผ่าน" onPress={() => navigation.navigate('SignIn')} />
          </View>
        </InfoCard>
      ) : null}

      {status === 'signed_out' ? (
        <InfoCard>
          <Text style={styles.body}>ลงชื่อเข้าใช้เพื่อดูข้อมูลของบัญชีคุณ</Text>
          <View style={styles.actions}>
            <PrimaryButton label="ลงชื่อเข้าใช้" onPress={() => navigation.navigate('SignIn')} />
          </View>
        </InfoCard>
      ) : null}

      {status !== 'signed_out' ? (
        <InfoCard title="ออกจากระบบ">
          {isAnonymous ? (
            // The one genuinely irreversible action in the app. An anonymous account has no
            // email, so once its session is gone there is no way to ask for it back — the rows
            // stay in the database and become unreachable by anyone.
            <Text style={styles.warn}>
              บัญชีนี้ยังไม่มีอีเมล ถ้าออกจากระบบตอนนี้จะกลับเข้ามาดูข้อมูลเดิมไม่ได้อีกเลย
              ใส่อีเมลก่อนออกจากระบบ ถ้ายังต้องการข้อมูลชุดนี้
            </Text>
          ) : (
            <Text style={styles.body}>ข้อมูลของคุณยังอยู่กับบัญชี ลงชื่อเข้าใช้ใหม่เมื่อไรก็เห็นเหมือนเดิม</Text>
          )}
          <View style={styles.actions}>
            {confirmingSignOut ? (
              <>
                <PrimaryButton label="ยืนยันออกจากระบบ" onPress={() => { void signOut(); setConfirmingSignOut(false); }} />
                <SecondaryButton label="ยกเลิก" onPress={() => setConfirmingSignOut(false)} />
              </>
            ) : (
              <SecondaryButton label="ออกจากระบบ" onPress={() => setConfirmingSignOut(true)} />
            )}
          </View>
        </InfoCard>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...type.secondary, color: colors.textMuted, lineHeight: 20 },
  warn: { ...type.secondary, color: colors.high, lineHeight: 20 },
  notice: { ...type.caption, color: colors.primary, marginTop: space.sm },
  actions: { gap: space.sm, marginTop: space.md },
});
