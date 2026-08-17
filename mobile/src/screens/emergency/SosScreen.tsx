/**
 * SOS Flow — records an emergency event the *user* raised, then shows them their own plan
 * and their own contacts.
 *
 * What this screen deliberately does not do (TDD §1.2/§9/§14):
 *   - it does not decide whether the situation is a medical emergency;
 *   - it does not message, dial, or alert anyone automatically — the user places the call;
 *   - it does not attach a location unless the user's privacy setting allows one. The backend
 *     re-applies that setting when storing, so a stale client can not leak coordinates.
 * Entered either from the SOS button in the app or from a press on the portable's own button
 * forwarded over BLE (docs/ble-contract.md).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { getPrivacy, raiseSos } from '../../api/client';
import { InfoCard, LoadingState, SecondaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, radius, space, type } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import type { SosResult } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Sos'>;

/** Ask for a fix only when the user's own privacy setting allows one to be stored. */
async function locationIfConsented(): Promise<{ lat: number; lon: number; accuracy?: number } | null> {
  try {
    const privacy = await getPrivacy();
    if (privacy.location_sharing === 'none') return null;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
    };
  } catch {
    return null; // no fix, no permission, or offline — the event is still recorded without one
  }
}

export function SosScreen({ route, navigation }: Props) {
  const source = route.params?.source ?? 'app';
  const deviceId = route.params?.deviceId;
  const [result, setResult] = useState<SosResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fix = await locationIfConsented();
      try {
        const r = await raiseSos({
          source,
          device_id: deviceId,
          occurred_at: new Date().toISOString(),
          lat: fix?.lat,
          lon: fix?.lon,
          location_accuracy_m: fix?.accuracy,
        });
        if (!cancelled) setResult(r);
      } catch (e) {
        // The record failed, but the user is still in front of us — show their plan path
        // anyway rather than a dead end.
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [source, deviceId]);

  const plan = result?.action_plan;
  const emergencySteps = plan?.emergency_steps ?? [];
  const contacts = result?.contacts ?? [];

  return (
    <Screen
      title="SOS"
      subtitle={source === 'portable' ? 'จากปุ่มบนอุปกรณ์พกพา' : 'บันทึกเหตุการณ์ฉุกเฉิน'}
      right={<Pressable onPress={() => navigation.goBack()}><Text style={styles.link}>Close</Text></Pressable>}
    >
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>
          {error ? 'ยังบันทึกเหตุการณ์ไม่สำเร็จ' : result ? 'บันทึกเหตุการณ์แล้ว' : 'กำลังบันทึก…'}
        </Text>
        <Text style={styles.bannerBody}>
          หากคุณคิดว่านี่เป็นเหตุฉุกเฉิน โปรดติดต่อบริการฉุกเฉินในพื้นที่ของคุณทันที
          NextAir ไม่สามารถประเมินเหตุฉุกเฉินทางการแพทย์ และไม่ได้ติดต่อใครแทนคุณ
        </Text>
      </View>

      {!result && !error ? <LoadingState /> : null}

      <InfoCard title="Your action plan">
        {emergencySteps.length ? (
          emergencySteps.map((step, i) => (
            <View key={i} style={styles.step}>
              <Text style={styles.stepIndex}>{i + 1}</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>
            ยังไม่ได้บันทึกขั้นตอนฉุกเฉินไว้ในแผน — ให้ทำตามแผนที่แพทย์ของคุณกำหนด
          </Text>
        )}
      </InfoCard>

      <InfoCard title="Contacts">
        {contacts.length ? (
          contacts.map((c) => (
            <Pressable
              key={c.id ?? c.name}
              style={styles.contact}
              onPress={() => (c.phone ? Linking.openURL(`tel:${c.phone}`) : undefined)}
            >
              <Text style={styles.contactName}>{c.name}</Text>
              <Text style={styles.contactPhone}>{c.phone ?? 'ไม่มีเบอร์'}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.empty}>ยังไม่ได้เพิ่มผู้ติดต่อฉุกเฉิน</Text>
        )}
        <Text style={styles.note}>แตะเพื่อโทรด้วยตัวคุณเอง — ระบบไม่ได้โทรหรือส่งข้อความให้</Text>
      </InfoCard>

      {result ? (
        <Text style={styles.meta}>
          {result.location_stored
            ? `บันทึกตำแหน่งตามการตั้งค่าความเป็นส่วนตัว (${result.location_sharing})`
            : 'ไม่ได้บันทึกตำแหน่ง ตามการตั้งค่าความเป็นส่วนตัวของคุณ'}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SecondaryButton label="Close" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { ...type.bodyStrong, color: colors.primary },
  banner: { backgroundColor: colors.highSoft, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  bannerTitle: { ...type.h2, color: colors.text },
  bannerBody: { ...type.secondary, color: colors.text, lineHeight: 20 },
  step: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  stepIndex: { ...type.caption, color: colors.textFaint, width: 16 },
  stepText: { ...type.body, color: colors.text, flex: 1 },
  empty: { ...type.secondary, color: colors.textMuted, fontStyle: 'italic' },
  contact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  contactName: { ...type.bodyStrong, color: colors.text },
  contactPhone: { ...type.body, color: colors.primary },
  note: { ...type.caption, color: colors.textMuted, marginTop: space.sm },
  meta: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
  error: { ...type.secondary, color: colors.high, textAlign: 'center' },
});
