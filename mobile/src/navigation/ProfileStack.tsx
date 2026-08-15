import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NotificationsScreen } from '../screens/home/NotificationsScreen';
import { AboutScreen } from '../screens/profile/AboutScreen';
import { PairSensorScreen } from '../screens/profile/PairSensorScreen';
import { PrivacyScreen } from '../screens/profile/PrivacyScreen';
import { ProfileSettingsScreen } from '../screens/profile/ProfileSettingsScreen';
import { SensorHealthScreen } from '../screens/profile/SensorHealthScreen';
import { colors } from '../theme';
import type { ProfileStackParamList } from './types';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SensorHealth" component={SensorHealthScreen} options={{ title: '' }} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: '' }} />
      <Stack.Screen name="PairSensor" component={PairSensorScreen} options={{ title: '' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: '' }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}
