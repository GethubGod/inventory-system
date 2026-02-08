import { type Href } from 'expo-router';
import { useAuthStore } from '@/store';

export function useSettingsBackRoute(): Href {
  const { user, profile } = useAuthStore();
  const isManager = (user?.role ?? profile?.role) === 'manager';

  return isManager ? '/(manager)/profile' : '/(tabs)/settings';
}
