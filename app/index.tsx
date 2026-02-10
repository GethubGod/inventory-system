import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store';
import { SpinningFish } from '@/components';

export default function Index() {
  const { session, user, profile, isLoading, isInitialized, viewMode } = useAuthStore();

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

  // Force onboarding until profile is completed.
  if (!profile?.profile_completed) {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  if (profile.is_suspended) {
    return <Redirect href="/suspended" />;
  }

  const metadataRole =
    typeof session.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;
  const role = user?.role ?? profile.role ?? metadataRole;

  // Route based on viewMode for managers, employees always go to tabs.
  if (role === 'manager' && viewMode === 'manager') {
    return <Redirect href="/(manager)" />;
  }

  // Default: employee view (tabs)
  return <Redirect href="/(tabs)" />;
}
