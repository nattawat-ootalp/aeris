/**
 * Analysis dashboard — §3 Exposure Simulator and §4 Time Machine.
 *
 * Mounted only on web (see MainTabs). Both screens are wide-form: a multi-column setup panel,
 * a timeline scrubber with per-frame ticks, and side-by-side result cards. None of that fits
 * a phone, and squeezing it in would make the five screens the phone app is actually for
 * harder to reach.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExposureSimulatorScreen } from '../screens/dashboard/ExposureSimulatorScreen';
import { TimeMachineScreen } from '../screens/dashboard/TimeMachineScreen';
import { colors } from '../theme';
import type { DashboardStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}
    >
      <Stack.Screen name="ExposureSimulator" component={ExposureSimulatorScreen}
                    options={{ headerShown: false }} />
      <Stack.Screen name="TimeMachine" component={TimeMachineScreen}
                    options={{ title: '' }} />
    </Stack.Navigator>
  );
}
