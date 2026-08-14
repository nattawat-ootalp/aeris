import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, Text } from 'react-native';
import { colors, shadow } from '../theme';
import { ExploreStackNavigator } from './ExploreStack';
import { ExposureStackNavigator } from './ExposureStack';
import { HistoryStackNavigator } from './HistoryStack';
import { HomeStackNavigator } from './HomeStack';
import { ProfileStackNavigator } from './ProfileStack';

const Tab = createBottomTabNavigator();

const ICONS: Record<string, string> = {
  HomeTab: '🏠',
  ExposureTab: '📈',
  ExploreTab: '📍',
  HistoryTab: '🕐',
  ProfileTab: '👤',
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
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          ...shadow,
        },
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{ICONS[route.name]}</Text>
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
