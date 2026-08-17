import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { NAV_RAIL_WIDTH, useIsWide } from '../lib/responsive';
import { colors, shadow, space } from '../theme';
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
  // A bottom bar stretched across a desktop window puts five targets a mouse-width apart at
  // the very bottom edge. Past the tablet breakpoint the same tabs become a left rail — same
  // routes, same URLs, so every deep link in src/navigation/linking.ts still resolves.
  const wide = useIsWide();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarPosition: wide ? 'left' : 'bottom',
        // `material` is the variant that lays a rail out vertically; `uikit` (the default)
        // assumes a horizontal bar and crowds the labels when turned on its side.
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelStyle: wide
          ? { fontSize: 13, fontWeight: '600' }
          : { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarStyle: wide
          ? {
              backgroundColor: colors.surface,
              borderRightColor: colors.border,
              borderRightWidth: 1,
              width: NAV_RAIL_WIDTH,
              paddingTop: space.lg,
              paddingHorizontal: space.sm,
            }
          : {
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
