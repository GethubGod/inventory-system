import { View, ActivityIndicator, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store';

export default function Index() {
  const { session, user, isLoading, isInitialized } = useAuthStore();

  // Show loading state while initializing
  if (!isInitialized || isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-5xl mb-4">🐟</Text>
        <ActivityIndicator size="large" color="#F97316" />
        <Text className="text-gray-500 mt-4">Loading...</Text>
      </View>
    );
  }

  // Not logged in - go to login
  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Logged in - route based on role
  if (user?.role === 'manager') {
    return <Redirect href="/(manager)" />;
  }

  // Default: employee goes to tabs
  return <Redirect href="/(tabs)" />;
}
