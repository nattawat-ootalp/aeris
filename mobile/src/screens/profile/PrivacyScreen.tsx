/** Screen 19 — Privacy. You control what is stored and shared (TDD §9). */
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { colors, space, type } from '../../theme';

export function PrivacyScreen() {
  const [preciseLocation, setPreciseLocation] = useState(false);
  const [cloudSync, setCloudSync] = useState(true);
  const [symptomHistory, setSymptomHistory] = useState(true);
  const [withdrawn, setWithdrawn] = useState(false);

  return (
    <Screen title="Privacy" subtitle="ควบคุมข้อมูลของคุณ">
      <Toggle label="Precise location" hint="Off uses zone-level location only" value={preciseLocation} onChange={setPreciseLocation} />
      <Toggle label="Cloud sync" value={cloudSync} onChange={setCloudSync} />
      <Toggle label="Keep symptom history" hint="Symptom data is never shared publicly" value={symptomHistory} onChange={setSymptomHistory} />
      <Pressable style={styles.withdraw} onPress={() => setWithdrawn(true)}>
        <Text style={styles.withdrawText}>Withdraw & delete my synced data</Text>
      </Pressable>
      {withdrawn ? <Text style={styles.msg}>Withdrawal requested — your synced data will be removed.</Text> : null}
      <Pressable style={styles.exportBtn}>
        <Text style={styles.exportText}>Export my data</Text>
      </Pressable>
      <Text style={styles.note}>Turning off cloud sync means History and Personal Pattern will not be available.</Text>
    </Screen>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md },
  label: { ...type.body, color: colors.text },
  hint: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  withdraw: { borderWidth: 1, borderColor: colors.high, borderRadius: 12, padding: space.md, alignItems: 'center' },
  withdrawText: { color: colors.high, fontWeight: '700' },
  exportBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, alignItems: 'center' },
  exportText: { color: colors.text, fontWeight: '600' },
  msg: { ...type.secondary, color: colors.textMuted },
  note: { ...type.caption, color: colors.textMuted },
});
