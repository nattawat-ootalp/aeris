import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { colors } from '../theme';
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
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIcon: () => <Text style={{ fontSize: 18 }}>{ICONS[route.name]}</Text>,
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
