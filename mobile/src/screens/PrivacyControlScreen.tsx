/**
 * Privacy Control (TDD §7 MVP, §9). Sync/share toggles, explicit consent, and data
 * withdrawal. Sharing area context is separated from — and can never include — private
 * symptom data (symptom_events never reach any public/shared view, TDD §9).
 */
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Banner, Card, Muted, Screen } from '../components/ui';
import { colors, radius, space } from '../theme';
import type { PrivacyPrefs } from '../types';

export function PrivacyControlScreen() {
  const [prefs, setPrefs] = useState<PrivacyPrefs>({
    syncEnabled: false,
    shareAreaContext: false,
    consentGiven: false,
  });

  function set<K extends keyof PrivacyPrefs>(key: K, value: PrivacyPrefs[K]) {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      // Withdrawing consent disables all sync/share (TDD §9 data minimization).
      if (key === 'consentGiven' && value === false) {
        next.syncEnabled = false;
        next.shareAreaContext = false;
      }
      return next;
    });
  }

  function withdraw() {
    Alert.alert('Withdraw data', 'Stop syncing and request deletion of synced data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: () => setPrefs({ syncEnabled: false, shareAreaContext: false, consentGiven: false }),
      },
    ]);
  }

  const locked = !prefs.consentGiven;

  return (
    <Screen title="Privacy Control" subtitle="You decide what syncs and what is shared.">
      <Banner accent={colors.privacy}>
        Symptom entries are private and are never shared, regardless of these settings.
      </Banner>

      <Card title="Consent">
        <ToggleRow
          label="I consent to data sync"
          description="Required before anything leaves this device."
          value={prefs.consentGiven}
          onValueChange={(v) => set('consentGiven', v)}
        />
      </Card>

      <Card title="Sync & sharing">
        <ToggleRow
          label="Sync my data"
          description="Back up exposure/decisions to your account."
          value={prefs.syncEnabled}
          disabled={locked}
          onValueChange={(v) => set('syncEnabled', v)}
        />
        <ToggleRow
          label="Share area context"
          description="Contribute anonymized area readings. Never includes symptoms."
          value={prefs.shareAreaContext}
          disabled={locked}
          onValueChange={(v) => set('shareAreaContext', v)}
        />
        {locked ? <Muted>Give consent above to enable sync and sharing.</Muted> : null}
      </Card>

      <Pressable style={styles.withdraw} onPress={withdraw}>
        <Text style={styles.withdrawText}>Withdraw & delete synced data</Text>
      </Pressable>
    </Screen>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled ? styles.dim : null]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.privacy, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    gap: space.md,
  },
  dim: { opacity: 0.5 },
  toggleText: { flex: 1 },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toggleDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  withdraw: {
    borderWidth: 1,
    borderColor: colors.statusHigh,
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  withdrawText: { color: colors.statusHigh, fontWeight: '700', fontSize: 15 },
});
