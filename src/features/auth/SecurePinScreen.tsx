// Screen 05a — PIN entry. Custom pad, four dots, confirm-by-re-entry, then
// the invite is accepted and the PIN stored server-side (bcrypt, rate
// limited). Secure storage of the session itself is unchanged (SecureStore).

import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { LoadingIndicator } from '@/components';
import { triggerNotificationHaptic, NotificationFeedbackType } from '@/lib/haptics';
import { PIN_LENGTH } from '@/services/loginCredentials';
import { authTheme } from '@/theme/design';
import { AuthPrimaryButton } from './components/AuthPrimaryButton';
import { AuthScreenShell } from './components/AuthScreenShell';
import { PinDots, PinPad } from './components/PinPad';
import { useOnboardingStore } from './onboardingStore';

type Phase = 'enter' | 'confirm' | 'submitting' | 'failed';

export default function SecurePinScreen() {
  const router = useRouter();
  const token = useOnboardingStore((state) => state.token);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);

  const [phase, setPhase] = useState<Phase>('enter');
  const [firstPin, setFirstPin] = useState('');
  const [digits, setDigits] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  if (!token) {
    return <Redirect href={'/(auth)/welcome' as never} />;
  }

  const submit = async (pin: string) => {
    setPhase('submitting');
    try {
      await completeOnboarding('pin', pin);
      triggerNotificationHaptic(NotificationFeedbackType.Success);
      router.replace('/(auth)/ready' as Parameters<typeof router.replace>[0]);
    } catch (error) {
      triggerNotificationHaptic(NotificationFeedbackType.Error);
      setFailureMessage(error instanceof Error ? error.message : 'Something went wrong. Try again.');
      setFirstPin(pin);
      setPhase('failed');
    }
  };

  const handleDigit = (digit: string) => {
    if (phase === 'submitting') return;
    if (mismatch) setMismatch(false);
    const next = (digits + digit).slice(0, PIN_LENGTH);
    setDigits(next);

    if (next.length < PIN_LENGTH) return;

    if (phase === 'enter') {
      setFirstPin(next);
      setDigits('');
      setPhase('confirm');
      return;
    }

    if (phase === 'confirm') {
      if (next === firstPin) {
        void submit(next);
      } else {
        triggerNotificationHaptic(NotificationFeedbackType.Warning);
        setMismatch(true);
        setFirstPin('');
        setDigits('');
        setPhase('enter');
      }
    }
  };

  const handleBackspace = () => {
    if (phase === 'submitting') return;
    setDigits((current) => current.slice(0, -1));
  };

  const title =
    phase === 'confirm' ? 'Enter it again' : phase === 'failed' ? 'Almost there' : 'Enter your PIN';
  const subtitle =
    phase === 'confirm'
      ? 'Same 4 digits, to confirm'
      : mismatch
        ? "Those didn't match. Start with the first 4 digits again"
        : 'The one the manager gave you';

  return (
    <AuthScreenShell>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {phase === 'failed' ? (
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
              {title}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: authTheme.textDim,
                textAlign: 'center',
                marginBottom: 24,
              }}
            >
              {failureMessage}
            </Text>
            <AuthPrimaryButton label="Try again" onPress={() => void submit(firstPin)} />
          </>
        ) : (
          <>
            <Text
              style={{
                fontSize: 21,
                fontWeight: '700',
                color: authTheme.text,
                textAlign: 'center',
                marginBottom: 3,
              }}
            >
              {title}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: mismatch ? authTheme.accent : authTheme.textDim,
                textAlign: 'center',
              }}
            >
              {subtitle}
            </Text>
            <PinDots filled={digits.length} error={mismatch} />
            {phase === 'submitting' ? (
              <View style={{ height: 254, alignItems: 'center', justifyContent: 'center' }}>
                <LoadingIndicator size="large" />
                <Text style={{ fontSize: 13, color: authTheme.textDim, marginTop: 12 }}>
                  Setting up your account
                </Text>
              </View>
            ) : (
              <PinPad onDigit={handleDigit} onBackspace={handleBackspace} />
            )}
          </>
        )}
      </View>
      {phase !== 'submitting' ? (
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ alignItems: 'center', marginBottom: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: authTheme.textDim }}>Back</Text>
        </TouchableOpacity>
      ) : null}
    </AuthScreenShell>
  );
}
