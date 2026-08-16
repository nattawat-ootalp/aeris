/** Screen 02 — Pair Sensor. Connect the Aeris Portable Device over Bluetooth. */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '../../components/ui';
import { Screen } from '../../components/Screen';
import { co2Label, eco2Label, tvocLabel } from '../../lib/format';
import { usePortable } from '../../state/portable';
import { colors, radius, space, type } from '../../theme';

export function PairSensorScreen() {
  const { state, deviceName, telemetry, scanFailure, startPairing, stopPairing, disconnectDevice } = usePortable();

  useEffect(() => stopPairing, [stopPairing]);

  return (
    <Screen title="Connect your device" subtitle="Pair your Aeris Portable over Bluetooth">
      <View style={styles.center}>
        <Ionicons name={state === 'connected' ? 'bluetooth' : 'bluetooth-outline'} size={40} color={state === 'connected' ? colors.primary : colors.textMuted} />
        <Text style={styles.stateText}>{stateLabel(state)}</Text>
      </View>

      {state === 'connected' && deviceName ? (
        <View style={styles.card}>
          <Text style={styles.deviceName}>{deviceName}</Text>
          <Text style={styles.deviceMeta}>
            Battery {telemetry?.battery ?? '—'}% · {telemetry?.sensor_status ?? 'waiting for data'}
          </Text>
          <Text style={styles.deviceMeta}>
            CO2 {co2Label(telemetry?.co2)} · TVOC {tvocLabel(telemetry?.tvoc)} · eCO2 (estimated) {eco2Label(telemetry?.eco2)}
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
          {scanFailure ? <Text style={styles.errorText}>{scanFailureLabel(scanFailure)}</Text> : null}
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

function scanFailureLabel(reason: string): string {
  switch (reason) {
    case 'permission-denied':
      return 'Bluetooth permission was denied. Enable it in your phone\'s app settings and try again.';
    case 'bluetooth-off':
      return 'Bluetooth is turned off. Turn it on and try again.';
    default:
      return 'Could not start scanning. Try again.';
  }
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
  stateText: { ...type.body, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, gap: space.sm, minHeight: 72 },
  deviceName: { ...type.h2, color: colors.text },
  deviceMeta: { ...type.caption, color: colors.textMuted },
  help: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
  helpLink: { color: colors.primary, fontWeight: '600' },
  note: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
  errorText: { ...type.caption, color: colors.high, textAlign: 'center', marginTop: space.sm },
});
