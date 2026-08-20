/**
 * Emergency contacts — who the user wants shown when they raise an SOS.
 *
 * Storing a contact is not permission to message them: Aeris never contacts anyone on the
 * user's behalf. The list exists so the user can reach someone quickly themselves, which is
 * why the SOS screen shows these numbers instead of dialling them.
 */
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { addContact, deleteContact, getContacts } from '../../api/client';
import { EmptyState, ErrorState, InfoCard, LoadingState, PrimaryButton } from '../../components/ui';
import { SignInRequired } from '../../components/SignInRequired';
import { Screen } from '../../components/Screen';
import { useRemote } from '../../lib/useRemote';
import { colors, radius, space, type } from '../../theme';
import type { EmergencyContact } from '../../types';

export function EmergencyContactsScreen() {
  const { data, loading, error, unauthenticated, reload } = useRemote<{ contacts: EmergencyContact[] }>(
    useCallback(() => getContacts(), []),
  );
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await addContact({
        name: name.trim(),
        phone: phone.trim() || undefined,
        relationship: relationship.trim() || undefined,
      });
      setName('');
      setPhone('');
      setRelationship('');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteContact(id);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Emergency Contacts" subtitle="ผู้ที่คุณต้องการติดต่อเมื่อกด SOS">
      <InfoCard>
        <Text style={styles.boundary}>
          NextAir แสดงรายชื่อเหล่านี้ให้คุณติดต่อเอง ระบบไม่ได้ส่งข้อความหรือโทรหาใครโดยอัตโนมัติ
          และไม่ได้ประเมินว่าสถานการณ์เป็นเหตุฉุกเฉินทางการแพทย์หรือไม่
        </Text>
      </InfoCard>

      {loading ? (
        <LoadingState />
      ) : error || !data ? (
        unauthenticated ? <SignInRequired /> : <ErrorState reason="Could not load your contacts" onRetry={reload} />
      ) : data.contacts.length === 0 ? (
        <EmptyState title="ยังไม่ได้เพิ่มผู้ติดต่อ" />
      ) : (
        data.contacts.map((c) => (
          <InfoCard key={c.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.name}</Text>
                {c.relationship ? <Text style={styles.meta}>{c.relationship}</Text> : null}
                {c.phone ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)}>
                    <Text style={styles.phone}>{c.phone}</Text>
                  </Pressable>
                ) : null}
              </View>
              <Pressable onPress={() => remove(c.id)} disabled={busy}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          </InfoCard>
        ))
      )}

      <InfoCard title="Add a contact">
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="ชื่อ"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="เบอร์โทร (ไม่บังคับ)"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
        />
        <TextInput
          style={styles.input}
          value={relationship}
          onChangeText={setRelationship}
          placeholder="ความสัมพันธ์ (ไม่บังคับ)"
          placeholderTextColor={colors.textMuted}
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <PrimaryButton label={busy ? 'Saving…' : 'Add contact'} onPress={submit} disabled={busy || !name.trim()} />
      </InfoCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  boundary: { ...type.secondary, color: colors.textMuted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  name: { ...type.bodyStrong, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  phone: { ...type.body, color: colors.primary, marginTop: 4 },
  remove: { ...type.secondary, color: colors.high },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.bgTint,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  error: { ...type.secondary, color: colors.high, marginBottom: space.sm },
});
