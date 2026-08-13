/**
 * Symptom Event (TDD §7 MVP, §9). PRIVATE health data: logged to the user's own record
 * only, and NEVER rendered on any shared/public view. This screen contains no
 * environmental status and no medical interpretation — it only records what the user
 * reports (non-diagnostic, TDD §1.2, §9).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api/client';
import { Banner, Card, Muted, Screen } from '../components/ui';
import { DEMO_DEVICE_ID } from '../constants';
import { colors, radius, space } from '../theme';
import type { SymptomEventRecord, SymptomSeverity } from '../types';

const SEVERITIES: SymptomSeverity[] = ['mild', 'moderate', 'severe'];

export function SymptomEventScreen() {
  const [symptom, setSymptom] = useState('');
  const [severity, setSeverity] = useState<SymptomSeverity>('mild');
  const [note, setNote] = useState('');
  const [log, setLog] = useState<SymptomEventRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  async function save() {
    if (!symptom.trim()) return;
    setSaving(true);
    const record: SymptomEventRecord = {
      id: `${Date.now()}`,
      symptom: symptom.trim(),
      severity,
      note: note.trim() || undefined,
      occurred_at: new Date().toISOString(),
    };
    // Always keep the private local log; attempt a best-effort sync to the user's own record.
    setLog((prev) => [record, ...prev]);
    const res = await api.logSymptom(DEMO_DEVICE_ID, record);
    setSyncNote(res.ok ? 'Synced to your private record.' : 'Saved locally (offline — not yet synced).');
    setSymptom('');
    setNote('');
    setSeverity('mild');
    setSaving(false);
  }

  return (
    <Screen title="Symptom Event" subtitle="Log how you feel. Non-diagnostic.">
      <Banner accent={colors.privacy}>Private health data — kept to you and never shown on shared views.</Banner>

      <Card>
        <Text style={styles.fieldLabel}>Symptom</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. wheezing, tight chest"
          placeholderTextColor={colors.textMuted}
          value={symptom}
          onChangeText={setSymptom}
        />

        <Text style={[styles.fieldLabel, { marginTop: space.md }]}>Severity</Text>
        <View style={styles.severityRow}>
          {SEVERITIES.map((s) => {
            const active = s === severity;
            return (
              <Pressable
                key={s}
                onPress={() => setSeverity(s)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.fieldLabel, { marginTop: space.md }]}>Note (optional)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="context, triggers, medication taken…"
          placeholderTextColor={colors.textMuted}
          value={note}
          onChangeText={setNote}
          multiline
        />

        <Pressable style={styles.button} onPress={save} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Log symptom'}</Text>
        </Pressable>
        {syncNote ? <Muted>{syncNote}</Muted> : null}
      </Card>

      {log.length > 0 ? (
        <Card title="Your recent entries (private)">
          {log.map((r) => (
            <View key={r.id} style={styles.logRow}>
              <Text style={styles.logSymptom}>
                {r.symptom} · {r.severity}
              </Text>
              <Text style={styles.logTime}>{new Date(r.occurred_at).toLocaleString()}</Text>
              {r.note ? <Text style={styles.logNote}>{r.note}</Text> : null}
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: colors.textMuted, fontSize: 13, marginBottom: space.xs },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  severityRow: { flexDirection: 'row', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  chipActive: { borderColor: colors.privacy, backgroundColor: `${colors.privacy}22` },
  chipText: { color: colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.privacy },
  button: {
    marginTop: space.lg,
    backgroundColor: colors.privacy,
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  buttonText: { color: '#0f1419', fontWeight: '800', fontSize: 15 },
  logRow: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  logSymptom: { color: colors.text, fontWeight: '600' },
  logTime: { color: colors.textMuted, fontSize: 12 },
  logNote: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
