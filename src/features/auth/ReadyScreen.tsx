// Screen 06 — Ready. "You're set, <Name>" -> routes into the app (whatever
// the current tab layout resolves to for this account).

import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authTheme } from '@/theme/design';
import type { InviteLocationGroup } from '@/services/invites';
import { AuthPrimaryButton } from './components/AuthPrimaryButton';
import { AuthScreenShell } from './components/AuthScreenShell';
import { useOnboardingStore } from './onboardingStore';

function readyLine(locationGroup: InviteLocationGroup): string {
  switch (locationGroup) {
    case 'sushi':
      return 'Your Sushi order list is ready.';
    case 'poki':
      return 'Your Poki & Pho order list is ready.';
    default:
      return 'Your order list is ready.';
  }
}

export default function ReadyScreen() {
  const router = useRouter();
  const invitedName = useOnboardingStore((state) => state.invitedName);
  const locationGroup = useOnboardingStore((state) => state.locationGroup);
  const reset = useOnboardingStore((state) => state.reset);

  const handleEnter = () => {
    reset();
    // The index route resolves the right home (tabs or manager) from the
    // freshly hydrated session.
    router.replace('/');
  };

  return (
    <AuthScreenShell showLegalFooter={false}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: authTheme.accent,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <Ionicons name="checkmark" size={30} color={authTheme.text} />
        </View>
        <Text style={{ fontSize: 23, fontWeight: '700', color: authTheme.text, marginBottom: 5 }}>
          {`You're set${invitedName ? `, ${invitedName}` : ''}`}
        </Text>
        <Text style={{ fontSize: 14, color: authTheme.textDim, marginBottom: 24 }}>
          {readyLine(locationGroup)}
        </Text>
        <View style={{ alignSelf: 'stretch' }}>
          <AuthPrimaryButton label="See today's list" onPress={handleEnter} />
        </View>
      </View>
    </AuthScreenShell>
  );
}
