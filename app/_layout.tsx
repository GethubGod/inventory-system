import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store';
import { useOrderSubscription } from '@/hooks';
import '../global.css';

// Separate component for subscription to avoid hook issues
function OrderSubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  useOrderSubscription();
  return <>{children}</>;
}

export default function RootLayout() {
  const { initialize, isInitialized, user } = useAuthStore();

  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // Wrap in subscription provider when user is authenticated
  const content = (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FFFFFF' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(manager)" options={{ headerShown: false }} />
        <Stack.Screen name="orders" options={{ headerShown: false }} />
      </Stack>
    </View>
  );

  // Only enable subscriptions when user is logged in
  if (user) {
    return <OrderSubscriptionProvider>{content}</OrderSubscriptionProvider>;
  }

  return content;
}
