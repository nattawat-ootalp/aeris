/** Symptom Event (MVP) — PRIVATE health log. Never shown on any shared/public view (TDD §9). */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { logSymptom } from '../api/client';
import { Screen } from '../components/Screen';
import { colors, space } from '../theme';

const LEVELS = ['mild', 'moderate', 'severe'] as const;
type Level = (typeof LEVELS)[number];

export function SymptomEventScreen() {
  const [severity, setSeverity] = useState<Level>('mild');
  const [note, setNote] = useState('');
  const [token, setToken] = useState(''); // scaffold: a real app supplies this from sign-in
  const [msg, setMsg] = useState<string | null>(null);

  function submit() {
    if (!token) {
      setMsg('Sign-in required to store private symptom data.');
      return;
    }
    logSymptom(token, { severity, note: note || undefined })
      .then(() => setMsg('Logged privately.'))
      .catch((e) => setMsg(`Could not save: ${e}`));
  }

  return (
    <Screen title="Symptom" subtitle="Private to you — used only to help you notice patterns.">
      <View style={styles.pills}>
        {LEVELS.map((l) => (
          <Pressable key={l} onPress={() => setSeverity(l)} style={[styles.pill, severity === l ? styles.pillActive : null]}>
            <Text style={[styles.pillText, severity === l ? styles.pillTextActive : null]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.note} value={note} onChangeText={setNote} placeholder="Optional note" placeholderTextColor={colors.textMuted} multiline />
      <TextInput style={styles.tokenInput} value={token} onChangeText={setToken} placeholder="Session token (dev)" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
      <Pressable style={styles.button} onPress={submit}>
        <Text style={styles.buttonText}>Log symptom</Text>
      </Pressable>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <Text style={styles.disclaimer}>
        Aeris records what you feel — it does not diagnose, confirm a cause, or replace medical advice.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', gap: space.sm },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: space.sm, paddingHorizontal: space.md },
  pillActive: { backgroundColor: colors.caution, borderColor: colors.caution },
  pillText: { color: colors.textMuted, textTransform: 'capitalize' },
  pillTextActive: { color: '#111', fontWeight: '700' },
  note: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, padding: space.sm, minHeight: 72, backgroundColor: colors.surface },
  tokenInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, padding: space.sm, backgroundColor: colors.surface },
  button: { backgroundColor: colors.normal, borderRadius: 8, padding: space.md, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  msg: { color: colors.textMuted, fontSize: 13 },
  disclaimer: { color: colors.textMuted, fontSize: 12, marginTop: space.md, fontStyle: 'italic' },
});
