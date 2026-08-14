/** Aeris mobile — app root. Navigation container + root stack (Onboarding -> Main tabs). */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MainTabs } from './src/navigation/MainTabs';
import type { RootStackParamList } from './src/navigation/types';
import { EmergencyBoundaryScreen } from './src/screens/emergency/EmergencyBoundaryScreen';
import { OnboardingScreen } from './src/screens/onboarding/OnboardingScreen';
import { PortableProvider } from './src/state/portable';
import { colors } from './src/theme';

const RootStack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <PortableProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <RootStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen
              name="EmergencyBoundary"
              component={EmergencyBoundaryScreen}
              options={{ presentation: 'modal', headerShown: false }}
            />
          </RootStack.Navigator>
        </NavigationContainer>
      </PortableProvider>
    </SafeAreaProvider>
  );
}
