import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NotificationsScreen } from '../screens/home/NotificationsScreen';
import { AboutScreen } from '../screens/profile/AboutScreen';
import { AccountScreen } from '../screens/profile/AccountScreen';
import { ActionPlanScreen } from '../screens/profile/ActionPlanScreen';
import { EmergencyContactsScreen } from '../screens/profile/EmergencyContactsScreen';
import { PairSensorScreen } from '../screens/profile/PairSensorScreen';
import { PrivacyScreen } from '../screens/profile/PrivacyScreen';
import { ProfileSettingsScreen } from '../screens/profile/ProfileSettingsScreen';
import { SignInScreen } from '../screens/profile/SignInScreen';
import { SensorHealthScreen } from '../screens/profile/SensorHealthScreen';
import { colors } from '../theme';
import type { ProfileStackParamList } from './types';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Account" component={AccountScreen} options={{ title: '' }} />
      <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: '' }} />
      <Stack.Screen name="SensorHealth" component={SensorHealthScreen} options={{ title: '' }} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: '' }} />
      <Stack.Screen name="PairSensor" component={PairSensorScreen} options={{ title: '' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: '' }} />
      <Stack.Screen name="ActionPlan" component={ActionPlanScreen} options={{ title: '' }} />
      <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} options={{ title: '' }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}
