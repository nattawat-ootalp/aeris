import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PersonalBaselineScreen } from '../screens/history/PersonalBaselineScreen';
import { PersonalPatternScreen } from '../screens/history/PersonalPatternScreen';
import { WeeklyHistoryScreen } from '../screens/history/WeeklyHistoryScreen';
import { colors } from '../theme';
import type { HistoryStackParamList } from './types';

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export function HistoryStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="WeeklyHistory" component={WeeklyHistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PersonalBaseline" component={PersonalBaselineScreen} options={{ title: '' }} />
      <Stack.Screen name="PersonalPattern" component={PersonalPatternScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}
