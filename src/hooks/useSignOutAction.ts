import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';

interface UseSignOutActionOptions {
  requireConfirmation?: boolean;
}

export function useSignOutAction({
  requireConfirmation = true,
}: UseSignOutActionOptions = {}) {
  const signOut = useAuthStore((state) => state.signOut);
  const isLoading = useAuthStore((state) => state.isLoading);

  const performSignOut = useCallback(async () => {
    if (isLoading) {
      return;
    }

    try {
      await signOut();
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('Failed to complete sign out.', error);

      if (Platform.OS === 'web' && typeof globalThis.alert === 'function') {
        globalThis.alert('Unable to sign out. Please try again.');
        return;
      }

      Alert.alert('Sign Out Failed', 'Unable to sign out. Please try again.');
    }
  }, [isLoading, signOut]);

  const requestSignOut = useCallback(() => {
    if (!requireConfirmation) {
      void performSignOut();
      return;
    }

    const message = 'Are you sure you want to sign out?';

    if (Platform.OS === 'web') {
      const confirmed =
        typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true;
      if (!confirmed) {
        return;
      }

      void performSignOut();
      return;
    }

    Alert.alert('Sign Out', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void performSignOut();
        },
      },
    ]);
  }, [performSignOut, requireConfirmation]);

  return {
    performSignOut,
    requestSignOut,
  };
}
