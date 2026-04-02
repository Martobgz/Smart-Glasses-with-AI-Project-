import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import SpotifyScreen from './src/screens/SpotifyScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Home: '👓',
  Notifications: '🔔',
  Spotify: '🎵',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#12121c" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused }) => {
              const icon = TAB_ICONS[route.name] ?? '•';
              return (
                <React.Fragment>
                  {/* Using emoji as icon for zero-dependency fallback */}
                  <React.Fragment key={focused ? 'active' : 'inactive'} />
                </React.Fragment>
              );
            },
            tabBarLabel: ({ focused, color }) => (
              <React.Fragment>
                {/* Label handled below via tabBarIcon option */}
              </React.Fragment>
            ),
            // Simpler approach: just use the emoji in the label
            tabBarIcon: () => null,
            tabBarLabel: ({ focused }) =>
              `${TAB_ICONS[route.name] ?? ''} ${route.name}`,
            tabBarActiveTintColor: '#4a90d9',
            tabBarInactiveTintColor: '#555',
            tabBarStyle: {
              backgroundColor: '#1a1a2e',
              borderTopColor: '#2a2a3a',
              paddingBottom: 4,
            },
            headerStyle: { backgroundColor: '#12121c' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '700' },
          })}>
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Glasses' }}
          />
          <Tab.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{ title: 'History' }}
          />
          <Tab.Screen
            name="Spotify"
            component={SpotifyScreen}
            options={{ title: 'Music' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
