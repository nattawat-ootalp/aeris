import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { colors, shadow } from '../theme';
import { ExploreStackNavigator } from './ExploreStack';
import { ExposureStackNavigator } from './ExposureStack';
import { HistoryStackNavigator } from './HistoryStack';
import { HomeStackNavigator } from './HomeStack';
import { ProfileStackNavigator } from './ProfileStack';

const Tab = createBottomTabNavigator();

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  HomeTab: 'home-outline',
  ExposureTab: 'trending-up-outline',
  ExploreTab: 'location-outline',
  HistoryTab: 'time-outline',
  ProfileTab: 'person-outline',
};

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          // Web needs more room than Android: a browser has no home-indicator inset to absorb
          // the label's descenders, so 68 crops "Exposure"/"Explore" at the bottom edge.
          height: Platform.select({ ios: 88, web: 78, default: 68 }),
          paddingTop: 8,
          paddingBottom: Platform.select({ ios: 28, web: 16, default: 10 }),
          ...shadow,
        },
        tabBarIcon: ({ focused, color }) => (
          <Ionicons name={ICONS[route.name]} size={22} color={color} style={{ opacity: focused ? 1 : 0.7 }} />
        ),
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStackNavigator} options={{ title: 'Home' }} />
      <Tab.Screen name="ExposureTab" component={ExposureStackNavigator} options={{ title: 'Exposure' }} />
      <Tab.Screen name="ExploreTab" component={ExploreStackNavigator} options={{ title: 'Explore' }} />
      <Tab.Screen name="HistoryTab" component={HistoryStackNavigator} options={{ title: 'History' }} />
      <Tab.Screen name="ProfileTab" component={ProfileStackNavigator} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}
