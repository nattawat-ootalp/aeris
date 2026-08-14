import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CompareLocationsScreen } from '../screens/explore/CompareLocationsScreen';
import { DestinationAssessmentScreen } from '../screens/explore/DestinationAssessmentScreen';
import { ExploreMapScreen } from '../screens/explore/ExploreMapScreen';
import { colors } from '../theme';
import type { ExploreStackParamList } from './types';

const Stack = createNativeStackNavigator<ExploreStackParamList>();

export function ExploreStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="ExploreMap" component={ExploreMapScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DestinationAssessment" component={DestinationAssessmentScreen} options={{ title: '' }} />
      <Stack.Screen name="CompareLocations" component={CompareLocationsScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}
