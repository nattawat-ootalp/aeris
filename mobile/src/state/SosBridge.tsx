/**
 * Turns a press on the portable's SOS button into the app's SOS screen.
 *
 * Kept separate from PortableProvider because the provider sits *outside* the navigation
 * container and cannot navigate; this component renders inside it. It only routes — the SOS
 * screen is what records the event and applies the user's consent settings.
 */
import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePortable } from './portable';
import type { RootStackParamList } from '../navigation/types';

export function SosBridge() {
  const { lastSos, clearSos, deviceId } = usePortable();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (!lastSos) return;
    // Cleared immediately so one press opens the screen exactly once, even if the user
    // navigates away and back.
    clearSos();
    navigation.navigate('Sos', { source: 'portable', deviceId: deviceId ?? undefined });
  }, [lastSos, clearSos, deviceId, navigation]);

  return null;
}
