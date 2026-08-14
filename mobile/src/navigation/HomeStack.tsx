import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CurrentExposureScreen } from '../screens/home/CurrentExposureScreen';
import { DataQualityScreen } from '../screens/home/DataQualityScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { NotificationsScreen } from '../screens/home/NotificationsScreen';
import { colors } from '../theme';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export function HomeStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CurrentExposure" component={CurrentExposureScreen} options={{ title: '' }} />
      <Stack.Screen name="DataQuality" component={DataQualityScreen} options={{ title: '' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}
