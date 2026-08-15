/** Screen 19 — Privacy. You control what is stored and shared (TDD §9). */
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { exportMyData, getPrivacy, updatePrivacy, withdrawMyData } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { useRemote } from '../../lib/useRemote';
import { colors, space, type } from '../../theme';
import type { PrivacySettings } from '../../types';

export function PrivacyScreen() {
  const { data, loading, error, reload } = useRemote<PrivacySettings>(useCallback(() => getPrivacy(), []));
  // Optimistic overlay so a toggle responds instantly; it is reconciled with the server's
  // answer (or rolled back) as soon as the write returns.
  const [pending, setPending] = useState<Partial<PrivacySettings>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const settings = data ? { ...data, ...pending } : null;

  const save = useCallback(
    async (changes: Partial<PrivacySettings>) => {
      setPending((p) => ({ ...p, ...changes }));
      setMsg(null);
      try {
        await updatePrivacy(changes);
      } catch (e) {
        setPending((p) => {
          const next = { ...p };
          for (const k of Object.keys(changes)) delete next[k as keyof PrivacySettings];
          return next;
        });
        setMsg(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [],
  );

  async function onExport() {
    setBusy(true);
    setMsg(null);
    try {
      const payload = await exportMyData();
      await Share.share({ message: JSON.stringify(payload, null, 2), title: 'Aeris data export' });
    } catch (e) {
      setMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function onWithdraw() {
    Alert.alert(
      'Withdraw & delete synced data',
      'This permanently deletes your synced symptom, exposure and device records. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setMsg(null);
            try {
              const res = await withdrawMyData();
              const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
              setMsg(`Withdrawn — ${total} synced record${total === 1 ? '' : 's'} deleted.`);
              setPending({});
              reload();
            } catch (e) {
              setMsg(`Could not withdraw: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <Screen title="Privacy" subtitle="ควบคุมข้อมูลของคุณ">
        <LoadingState />
      </Screen>
    );
  }
  if (error || !settings) {
    return (
      <Screen title="Privacy" subtitle="ควบคุมข้อมูลของคุณ">
        <ErrorState reason="Could not load your privacy settings" onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen title="Privacy" subtitle="ควบคุมข้อมูลของคุณ">
      <Toggle
        label="Precise location"
        hint="Off uses zone-level location only"
        value={settings.location_sharing === 'precise'}
        onChange={(v) => save({ location_sharing: v ? 'precise' : 'coarse' })}
      />
      <Toggle
        label="Cloud sync"
        value={settings.sync_enabled}
        onChange={(v) => save({ sync_enabled: v })}
      />
      <Toggle
        label="Share environmental data"
        hint="Symptom data is never shared, regardless of this setting"
        value={settings.share_environmental}
        onChange={(v) => save({ share_environmental: v })}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Retention</Text>
          <Text style={styles.hint}>Synced data older than this is removed</Text>
        </View>
        <Text style={styles.value}>{settings.retention_days} days</Text>
      </View>

      <Pressable style={styles.withdraw} onPress={onWithdraw} disabled={busy}>
        <Text style={styles.withdrawText}>Withdraw & delete my synced data</Text>
      </Pressable>
      <Pressable style={styles.exportBtn} onPress={onExport} disabled={busy}>
        <Text style={styles.exportText}>{busy ? 'Working…' : 'Export my data'}</Text>
      </Pressable>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {settings.withdrawn_at ? (
        <Text style={styles.msg}>Sync was withdrawn on {new Date(settings.withdrawn_at).toLocaleDateString()}.</Text>
      ) : null}
      <Text style={styles.note}>
        Turning off cloud sync means History and Personal Pattern will not be available.
      </Text>
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
  value: { ...type.bodyStrong, color: colors.text },
  withdraw: { borderWidth: 1, borderColor: colors.high, borderRadius: 12, padding: space.md, alignItems: 'center' },
  withdrawText: { color: colors.high, fontWeight: '700' },
  exportBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, alignItems: 'center' },
  exportText: { color: colors.text, fontWeight: '600' },
  msg: { ...type.secondary, color: colors.textMuted },
  note: { ...type.caption, color: colors.textMuted },
});
