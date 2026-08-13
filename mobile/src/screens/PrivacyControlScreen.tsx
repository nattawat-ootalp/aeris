/** Privacy Control (MVP) — sync/share consent + data withdrawal (TDD §7/§9). */
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { colors, space } from '../theme';

export function PrivacyControlScreen() {
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [shareArea, setShareArea] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  return (
    <Screen title="Privacy" subtitle="You control what is stored and shared.">
      <Toggle label="Sync my data to the cloud" value={syncEnabled} onChange={setSyncEnabled} />
      <Toggle
        label="Share anonymized AREA readings"
        hint="Symptom data is never shared — only environmental readings, if you allow."
        value={shareArea}
        onChange={setShareArea}
      />
      <Pressable style={styles.withdraw} onPress={() => setWithdrawn(true)}>
        <Text style={styles.withdrawText}>Withdraw & delete my synced data</Text>
      </Pressable>
      {withdrawn ? <Text style={styles.msg}>Withdrawal requested — your synced data will be removed.</Text> : null}
      <Text style={styles.note}>Private health/symptom data is owner-only and never appears on any public view.</Text>
    </Screen>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  toggleText: { flex: 1 },
  label: { color: colors.text, fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  withdraw: { borderWidth: 1, borderColor: colors.high, borderRadius: 8, padding: space.md, alignItems: 'center', marginTop: space.md },
  withdrawText: { color: colors.high, fontWeight: '700' },
  msg: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textMuted, fontSize: 12, marginTop: space.md },
});
