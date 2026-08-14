import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DailySummaryScreen } from '../screens/exposure/DailySummaryScreen';
import { ExposureEventDetailScreen } from '../screens/exposure/ExposureEventDetailScreen';
import { ExposureTimelineScreen } from '../screens/exposure/ExposureTimelineScreen';
import { SymptomEventScreen } from '../screens/exposure/SymptomEventScreen';
import { colors } from '../theme';
import type { ExposureStackParamList } from './types';

const Stack = createNativeStackNavigator<ExposureStackParamList>();

export function ExposureStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="ExposureTimeline" component={ExposureTimelineScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ExposureEventDetail" component={ExposureEventDetailScreen} options={{ title: '' }} />
      <Stack.Screen name="DailySummary" component={DailySummaryScreen} options={{ title: '' }} />
      <Stack.Screen name="SymptomEvent" component={SymptomEventScreen} options={{ title: '', presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
