// Screen 03 — Hello. Name from the invite preview, one Continue button.
// No avatar, no explainer copy (confirmed decisions).

import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { AuthLoadingScreen, LoadingIndicator } from '@/components';
import { useAuthScreenGuard } from '@/hooks';
import {
  describeInviteFailure,
  fetchInvitePreview,
  getInviteFailureReason,
} from '@/services/invites';
import { authTheme } from '@/theme/design';
import { AuthPrimaryButton } from './components/AuthPrimaryButton';
import { AuthScreenShell } from './components/AuthScreenShell';
import { StepProgress } from './components/StepProgress';
import { useOnboardingStore } from './onboardingStore';

export default function InviteHelloScreen() {
  const router = useRouter();
  const guard = useAuthScreenGuard();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = (Array.isArray(params.token) ? params.token[0] : params.token)?.trim() ?? '';

  const setInvite = useOnboardingStore((state) => state.setInvite);
  const invitedName = useOnboardingStore((state) => state.invitedName);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus('error');
      setErrorMessage(describeInviteFailure('invalid'));
      return;
    }

    setStatus('loading');
    fetchInvitePreview(token)
      .then((preview) => {
        if (cancelled) return;
        setInvite(token, preview);
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        const reason = getInviteFailureReason(error);
        setErrorMessage(
          reason ? describeInviteFailure(reason) : 'Unable to check this invite. Try again.',
        );
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [token, setInvite]);

  if (guard.isChecking) return <AuthLoadingScreen />;
  if (guard.authenticatedRedirectTo) return <Redirect href={guard.authenticatedRedirectTo} />;

  return (
    <AuthScreenShell>
      <StepProgress step={1} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {status === 'loading' ? (
          <View style={{ alignItems: 'center' }}>
            <LoadingIndicator size="large" />
          </View>
        ) : status === 'error' ? (
          <>
            <Text
              style={{
                fontSize: 21,
                fontWeight: '700',
                color: authTheme.text,
                textAlign: 'center',
                marginBottom: 8,
              }}
            >
              {"This invite won't work"}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: authTheme.textDim,
                textAlign: 'center',
                marginBottom: 24,
              }}
            >
              {errorMessage}
            </Text>
            <AuthPrimaryButton
              label="Back to start"
              onPress={() =>
                router.replace('/(auth)/welcome' as Parameters<typeof router.replace>[0])
              }
            />
          </>
        ) : (
          <>
            <Text
              style={{
                fontSize: 31,
                fontWeight: '700',
                color: authTheme.text,
                textAlign: 'center',
                marginBottom: 26,
              }}
            >
              Hello, {invitedName ?? 'there'}
            </Text>
            <AuthPrimaryButton
              label="Continue"
              onPress={() => router.push('/(auth)/secure' as Parameters<typeof router.push>[0])}
            />
          </>
        )}
      </View>
      {status === 'error' ? (
        <TouchableOpacity
          onPress={() => router.replace('/(auth)/welcome' as Parameters<typeof router.replace>[0])}
          style={{ alignItems: 'center', marginBottom: 6 }}
        >
          <Text style={{ fontSize: 12, color: authTheme.textFaint }}>
            Ask the manager for a new link if this keeps happening
          </Text>
        </TouchableOpacity>
      ) : null}
    </AuthScreenShell>
  );
}
