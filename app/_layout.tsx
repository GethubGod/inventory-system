import { useEffect } from 'react';
import { LogBox, View, Appearance } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore, useDisplayStore } from '@/store';
import { useOrderSubscription } from '@/hooks';
import '../global.css';

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated and will be removed in a future release. Please use 'react-native-safe-area-context' instead.",
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
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  const statusBarStyle = theme === 'dark' ? 'light' : 'dark';

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
