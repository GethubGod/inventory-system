import { type Href } from 'expo-router';
import { useAuthStore } from '@/store';

export function useSettingsBackRoute(): Href {
  const { user, profile, session } = useAuthStore();
  const metadataRole =
    typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;
  const isManager = (user?.role ?? profile?.role ?? metadataRole) === 'manager';

  return isManager ? '/(manager)/profile' : '/(tabs)/settings';
}
