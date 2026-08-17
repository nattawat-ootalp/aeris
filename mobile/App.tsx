/** Aeris mobile — app root. Navigation container + root stack (Onboarding -> Main tabs). */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useOnboarded } from './src/lib/onboarding';
import { documentTitle, linking } from './src/navigation/linking';
import { MainTabs } from './src/navigation/MainTabs';
import type { RootStackParamList } from './src/navigation/types';
import { EmergencyBoundaryScreen } from './src/screens/emergency/EmergencyBoundaryScreen';
import { SosScreen } from './src/screens/emergency/SosScreen';
import { OnboardingScreen } from './src/screens/onboarding/OnboardingScreen';
import { PortableProvider } from './src/state/portable';
import { SosBridge } from './src/state/SosBridge';
import { colors } from './src/theme';

const RootStack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const onboarded = useOnboarded();

  // Hold the splash-coloured view until the stored flag is known, so a returning user never
  // sees onboarding flash before being sent to Home.
  if (onboarded === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PortableProvider>
        <StatusBar style="dark" />
        {/* Gives every screen its own URL in the web build (and keeps `aeris://` deep links
            working on device). `/` is unmapped on purpose so the onboarding flag below, not
            the address bar, decides the first screen — see src/navigation/linking.ts. */}
        <NavigationContainer linking={linking} documentTitle={documentTitle}>
          <RootStack.Navigator
            initialRouteName={onboarded ? 'Main' : 'Onboarding'}
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
          >
            <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen
              name="Sos"
              component={SosScreen}
              options={{ presentation: 'modal', headerShown: false }}
            />
            <RootStack.Screen
              name="EmergencyBoundary"
              component={EmergencyBoundaryScreen}
              options={{ presentation: 'modal', headerShown: false }}
            />
          </RootStack.Navigator>
          <SosBridge />
        </NavigationContainer>
      </PortableProvider>
    </SafeAreaProvider>
  );
}
