import { useEffect } from 'react';
import { LogBox, View, Text, Appearance, AppState, AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore, useDisplayStore } from '@/store';
import { useOrderSubscription } from '@/hooks';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import '../global.css';

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  'expo-notifications: Android Push notifications (remote notifications) functionality provided by expo-notifications was removed from Expo Go',
  '`expo-notifications` functionality is not fully supported in Expo Go',
  '[expo-notifications]: `shouldShowAlert` is deprecated',
]);

// Separate component for subscription to avoid hook issues
function OrderSubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  useOrderSubscription();
  return <>{children}</>;
}

function ThemeManager() {
  const theme = useDisplayStore((state) => state.theme);

  useEffect(() => {
    if (theme === 'light') {
      Appearance.setColorScheme('light');
    } else if (theme === 'dark') {
      Appearance.setColorScheme('dark');
    } else {
      // 'system' — follow device setting
      Appearance.setColorScheme(null);
    }
  }, [theme]);

  return null;
}

export default function RootLayout() {
  const { initialize, isInitialized, user } = useAuthStore();
  const theme = useDisplayStore((state) => state.theme);
  const reduceMotion = useDisplayStore((state) => state.reduceMotion);

  useEffect(() => {
    if (supabaseConfigError) return;

    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };

    if (AppState.currentState === 'active') {
      supabase.auth.startAutoRefresh();
    }

    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (supabaseConfigError) return;

    if (!isInitialized) {
      initialize();
    }
  }, [initialize, isInitialized]);

  const statusBarStyle = theme === 'dark' ? 'light' : 'dark';

  if (supabaseConfigError) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 24, justifyContent: 'center' }}>
        <StatusBar style={statusBarStyle} />
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 10 }}>
          App Configuration Required
        </Text>
        <Text style={{ fontSize: 15, color: '#4B5563', lineHeight: 22 }}>
          {__DEV__
            ? `${supabaseConfigError}. Add these values to your Expo environment and restart the app.`
            : 'This build is missing required configuration. Please reinstall the app or contact support.'}
        </Text>
      </View>
    );
  }

  // Wrap in subscription provider when user is authenticated
  const content = (
    <View style={{ flex: 1 }}>
      <ThemeManager />
      <StatusBar style={statusBarStyle} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FFFFFF' },
          animation: reduceMotion ? 'none' : 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(manager)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="orders" options={{ headerShown: false }} />
        <Stack.Screen name="suspended" options={{ headerShown: false }} />
      </Stack>
    </View>
  );

  // Only enable subscriptions when user is logged in
  if (user) {
    return <OrderSubscriptionProvider>{content}</OrderSubscriptionProvider>;
  }

  return content;
}
