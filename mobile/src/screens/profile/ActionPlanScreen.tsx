/**
 * Asthma Action Plan Interface — displays and edits the plan the user or their healthcare
 * professional wrote.
 *
 * Aeris is storage and display only here. It ships no default steps, suggests no wording, and
 * never reorders or completes what the author entered (TDD §1.2/§14): an empty plan stays
 * visibly empty until a person fills it in.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getActionPlan, saveActionPlan } from '../../api/client';
import { ErrorState, InfoCard, LoadingState, PrimaryButton, SectionLabel } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { useRemote } from '../../lib/useRemote';
import { colors, radius, space, statusColor, type } from '../../theme';
import type { ActionPlan, WatchStatus } from '../../types';

type StepKey = 'normal_steps' | 'caution_steps' | 'high_steps' | 'emergency_steps';

const BANDS: { key: StepKey; label: string; status: WatchStatus | 'Emergency' }[] = [
  { key: 'normal_steps', label: 'Normal', status: 'Normal' },
  { key: 'caution_steps', label: 'Caution', status: 'Caution' },
  { key: 'high_steps', label: 'High', status: 'High' },
  { key: 'emergency_steps', label: 'Emergency', status: 'Emergency' },
];

function bandColor(status: WatchStatus | 'Emergency'): string {
  return status === 'Emergency' ? colors.high : statusColor(status);
}

export function ActionPlanScreen() {
  const { data, loading, error, reload } = useRemote<ActionPlan>(useCallback(() => getActionPlan(), []));
  const [draft, setDraft] = useState<Record<StepKey, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading) {
    return (
      <Screen title="Action Plan" subtitle="แผนรับมือที่คุณหรือแพทย์กำหนดไว้">
        <LoadingState />
      </Screen>
    );
  }
  if (error || !data) {
    return (
      <Screen title="Action Plan" subtitle="แผนรับมือที่คุณหรือแพทย์กำหนดไว้">
        <ErrorState reason="Could not load your action plan" onRetry={reload} />
      </Screen>
    );
  }

  const editing = draft != null;

  const startEditing = () => {
    // One step per line — the author's own wording and order, unchanged.
    setDraft({
      normal_steps: data.normal_steps.join('\n'),
      caution_steps: data.caution_steps.join('\n'),
      high_steps: data.high_steps.join('\n'),
      emergency_steps: data.emergency_steps.join('\n'),
    });
    setSaveError(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const toSteps = (text: string) =>
        text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      await saveActionPlan({
        normal_steps: toSteps(draft.normal_steps),
        caution_steps: toSteps(draft.caution_steps),
        high_steps: toSteps(draft.high_steps),
        emergency_steps: toSteps(draft.emergency_steps),
      });
      setDraft(null);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title="Action Plan"
      subtitle="แผนรับมือที่คุณหรือแพทย์กำหนดไว้"
      right={
        editing ? (
          <Pressable onPress={() => setDraft(null)}><Text style={styles.link}>Cancel</Text></Pressable>
        ) : (
          <Pressable onPress={startEditing}><Text style={styles.link}>Edit</Text></Pressable>
        )
      }
    >
      <InfoCard>
        <Text style={styles.boundary}>
          Aeris เก็บและแสดงแผนนี้ตามที่คุณหรือบุคลากรทางการแพทย์เขียนไว้เท่านั้น ระบบไม่ได้สร้าง
          แก้ไข หรือแนะนำขั้นตอนการรักษาเอง และไม่ใช่เครื่องมือวินิจฉัยโรค
        </Text>
        {data.clinician_name ? (
          <Text style={styles.meta}>
            Written by {data.clinician_name}
            {data.reviewed_at ? ` · reviewed ${data.reviewed_at.slice(0, 10)}` : ''}
          </Text>
        ) : null}
      </InfoCard>

      {BANDS.map((band) => {
        const steps = data[band.key];
        return (
          <InfoCard key={band.key}>
            <View style={styles.bandHeader}>
              <View style={[styles.dot, { backgroundColor: bandColor(band.status) }]} />
              <SectionLabel>{band.label}</SectionLabel>
            </View>
            {editing ? (
              <TextInput
                style={styles.input}
                value={draft[band.key]}
                onChangeText={(t) => setDraft({ ...draft, [band.key]: t })}
                placeholder="หนึ่งขั้นตอนต่อหนึ่งบรรทัด"
                placeholderTextColor={colors.textMuted}
                multiline
              />
            ) : steps.length ? (
              steps.map((step, i) => (
                <View key={`${band.key}-${i}`} style={styles.step}>
                  <Text style={styles.stepIndex}>{i + 1}</Text>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>ยังไม่ได้บันทึกขั้นตอนสำหรับระดับนี้</Text>
            )}
          </InfoCard>
        );
      })}

      {editing ? (
        <>
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
          <PrimaryButton label={saving ? 'Saving…' : 'Save plan'} onPress={save} disabled={saving} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { ...type.bodyStrong, color: colors.primary },
  boundary: { ...type.secondary, color: colors.textMuted, lineHeight: 20 },
  meta: { ...type.caption, color: colors.textFaint, marginTop: space.sm },
  bandHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  step: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  stepIndex: { ...type.caption, color: colors.textFaint, width: 16 },
  stepText: { ...type.body, color: colors.text, flex: 1 },
  empty: { ...type.secondary, color: colors.textMuted, fontStyle: 'italic' },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.bgTint,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  error: { ...type.secondary, color: colors.high, textAlign: 'center' },
});
