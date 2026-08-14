/** Screen 02 — Pair Sensor. Connect the Aeris Portable Device over Bluetooth. */
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { usePortable } from '../../state/portable';
import { colors, radius, space, type } from '../../theme';

export function PairSensorScreen() {
  const { state, deviceName, telemetry, startPairing, stopPairing, disconnectDevice } = usePortable();

  useEffect(() => stopPairing, [stopPairing]);

  return (
    <Screen title="Connect your device" subtitle="Pair your Aeris Portable over Bluetooth">
      <View style={styles.center}>
        <Text style={styles.bt}>{state === 'connected' ? '🔗' : '📶'}</Text>
        <Text style={styles.stateText}>{stateLabel(state)}</Text>
      </View>

      {state === 'connected' && deviceName ? (
        <View style={styles.card}>
          <Text style={styles.deviceName}>{deviceName}</Text>
          <Text style={styles.deviceMeta}>
            Battery {telemetry?.battery ?? '—'}% · {telemetry?.sensor_status ?? 'waiting for data'}
          </Text>
          <SecondaryButton label="Disconnect" onPress={disconnectDevice} />
        </View>
      ) : (
        <View>
          {state === 'scanning' || state === 'connecting' ? <ActivityIndicator color={colors.primary} /> : null}
          <PrimaryButton
            label={state === 'scanning' ? 'Scanning…' : 'Scan for device'}
            onPress={startPairing}
            disabled={state === 'scanning' || state === 'connecting'}
          />
        </View>
      )}

      <View style={styles.help}>
        <Pressable onPress={startPairing}><Text style={styles.helpLink}>Try again</Text></Pressable>
        <Text style={styles.helpLink}>Help</Text>
      </View>
      <Text style={styles.note}>Bluetooth pairing requires a development build (not Expo Go).</Text>
    </Screen>
  );
}

function stateLabel(s: string): string {
  switch (s) {
    case 'scanning': return 'Searching for your Aeris device…';
    case 'connecting': return 'Connecting…';
    case 'connected': return 'Connected';
    default: return 'Not connected';
  }
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  bt: { fontSize: 40 },
  stateText: { ...type.body, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, gap: space.sm, minHeight: 72 },
  deviceName: { ...type.h2, color: colors.text },
  deviceMeta: { ...type.caption, color: colors.textMuted },
  help: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
  helpLink: { color: colors.primary, fontWeight: '600' },
  note: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
