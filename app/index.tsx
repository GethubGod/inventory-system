import { View, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store';
import { SpinningFish } from '@/components';

export default function Index() {
  const { session, user, isLoading, isInitialized, viewMode } = useAuthStore();

  // Show loading state while initializing
  if (!isInitialized || isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <SpinningFish size="large" showText text="Loading..." />
      </View>
    );
  }

  // Not logged in - go to login
  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Route based on viewMode for managers, employees always go to tabs
  if (user?.role === 'manager' && viewMode === 'manager') {
    return <Redirect href="/(manager)" />;
  }

  // Default: employee view (tabs)
  return <Redirect href="/(tabs)" />;
}
