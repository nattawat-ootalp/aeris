/** Screen 07 — Symptom Event. Record what you feel, minimal fields, non-diagnostic. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { logSymptom } from '../../api/client';
import { Chip, InfoCard, PrimaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';
import type { ExposureStackParamList, RootStackParamList } from '../../navigation/types';
import type { Severity, SymptomType } from '../../types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const SYMPTOMS: { key: SymptomType; label: string }[] = [
  { key: 'cough', label: 'ไอ' },
  { key: 'chest_tightness', label: 'แน่นหน้าอก' },
  { key: 'wheeze', label: 'หายใจมีเสียงหวีด' },
  { key: 'breathless', label: 'หายใจลำบาก' },
  { key: 'other', label: 'อื่น ๆ' },
];
const SEVERITIES: Severity[] = ['mild', 'moderate', 'severe'];

type Props = NativeStackScreenProps<ExposureStackParamList, 'SymptomEvent'>;

export function SymptomEventScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<Set<SymptomType>>(new Set());
  const [severity, setSeverity] = useState<Severity>('mild');
  const [note, setNote] = useState('');
  const [inhalerUsed, setInhalerUsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(s: SymptomType) {
    const next = new Set(selected);
    next.has(s) ? next.delete(s) : next.add(s);
    setSelected(next);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await logSymptom({
        symptoms: Array.from(selected),
        severity,
        started_at: new Date().toISOString(),
        note: note || undefined,
        inhaler_used: inhalerUsed,
      });
      if (severity === 'severe') {
        // ExposureStack -> Tab navigator -> RootStack (two levels up)
        navigation.getParent()?.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('EmergencyBoundary', { severity: 'severe' });
        return;
      }
      setMsg('Saved. Environment context has been attached — this does not identify a cause.');
      setSelected(new Set());
      setNote('');
      setInhalerUsed(false);
    } catch (e) {
      setMsg(`Could not save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title="Record an event">
      <InfoCard title="Symptoms">
        <View style={styles.chipRow}>
          {SYMPTOMS.map((s) => (
            <Chip key={s.key} label={s.label} selected={selected.has(s.key)} onPress={() => toggle(s.key)} />
          ))}
        </View>
      </InfoCard>
      <InfoCard title="Inhaler">
        <View style={styles.chipRow}>
          <Chip label="ใช้ยาสูดพ่น" selected={inhalerUsed} onPress={() => setInhalerUsed(!inhalerUsed)} />
        </View>
        <Text style={styles.inhalerNote}>
          บันทึกไว้เป็นข้อมูลประกอบเท่านั้น NextAir ไม่ได้แนะนำให้ใช้หรือไม่ใช้ยา
        </Text>
      </InfoCard>
      <InfoCard title="Severity">
        <View style={styles.chipRow}>
          {SEVERITIES.map((s) => (
            <Chip key={s} label={s} selected={severity === s} onPress={() => setSeverity(s)} />
          ))}
        </View>
      </InfoCard>
      <TextInput style={styles.note} value={note} onChangeText={setNote} placeholder="Optional note" placeholderTextColor={colors.textMuted} multiline />
      <PrimaryButton label={saving ? 'Saving…' : 'Save event'} onPress={save} disabled={saving} />
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <Text style={styles.disclaimer}>
        NextAir records what you feel — it does not diagnose, confirm a cause, or replace medical advice.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  inhalerNote: { ...type.caption, color: colors.textMuted, marginTop: space.sm },
  note: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, padding: space.sm, minHeight: 72, backgroundColor: colors.surface },
  msg: { ...type.secondary, color: colors.textMuted },
  disclaimer: { ...type.caption, color: colors.textMuted, fontStyle: 'italic' },
});
