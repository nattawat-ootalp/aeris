/** Remembers that onboarding was completed, so returning users land straight on Home. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = 'aeris.onboarded.v1';

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1').catch(() => {});
}

/** `null` while the stored flag is still being read — callers must render nothing until then
 *  rather than flashing onboarding at a user who has already finished it. */
export function useOnboarded(): boolean | null {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setOnboarded(v === '1'))
      .catch(() => setOnboarded(false)); // storage unavailable: show onboarding
  }, []);
  return onboarded;
}
