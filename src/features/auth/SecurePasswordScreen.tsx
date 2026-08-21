// Screen 05b — Create a password. Standard secure field with
// textContentType="newPassword" so iCloud Keychain offers to save it
// (backed by the webcredentials associated domain; see the handback note —
// the AASA file goes live with the next web deploy).

import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { triggerNotificationHaptic, NotificationFeedbackType } from '@/lib/haptics';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/services/loginCredentials';
import { authTheme } from '@/theme/design';
import { AuthPrimaryButton } from './components/AuthPrimaryButton';
import { AuthScreenShell } from './components/AuthScreenShell';
import { useOnboardingStore } from './onboardingStore';

export default function SecurePasswordScreen() {
  const router = useRouter();
  const token = useOnboardingStore((state) => state.token);
  const invitedName = useOnboardingStore((state) => state.invitedName);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return <Redirect href={'/(auth)/welcome' as never} />;
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const handleSave = async () => {
    if (
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      setError(
        `Use between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding('password', password);
      triggerNotificationHaptic(NotificationFeedbackType.Success);
      router.replace('/(auth)/ready' as Parameters<typeof router.replace>[0]);
    } catch (submitError) {
      triggerNotificationHaptic(NotificationFeedbackType.Error);
      setError(
        submitError instanceof Error ? submitError.message : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreenShell>
      <View style={{ flex: 1, paddingTop: 24 }}>
        <Text style={{ fontSize: 21, fontWeight: '700', color: authTheme.text, marginBottom: 3 }}>
          Create a password
        </Text>
        <Text style={{ fontSize: 13, color: authTheme.textDim, marginBottom: 18 }}>
          Your iPhone will offer to save it.
        </Text>

        <Text
          style={{
            fontSize: 11,
            fontWeight: '600',
            letterSpacing: 0.5,
            color: 'rgba(255, 255, 255, 0.5)',
            marginBottom: 6,
          }}
        >
          PASSWORD
        </Text>
        {/* Invisible username field so iOS saves name + password together. */}
        <TextInput
          value={invitedName ?? ''}
          editable={false}
          textContentType="username"
          autoComplete="username"
          style={{ height: 0, width: 0, opacity: 0, position: 'absolute' }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <TextInput
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (error) setError(null);
          }}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_PASSWORD_LENGTH}
          passwordRules={`minlength: ${MIN_PASSWORD_LENGTH}; maxlength: ${MAX_PASSWORD_LENGTH};`}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          editable={!submitting}
          style={{
            backgroundColor: authTheme.well,
            borderWidth: 1,
            borderColor: authTheme.accent,
            borderRadius: 13,
            paddingHorizontal: 13,
            height: 48,
            fontSize: 16,
            letterSpacing: 2,
            color: authTheme.text,
            marginBottom: 8,
          }}
        />
        <Text
          style={{
            fontSize: 12,
            color: error ? authTheme.accent : tooShort ? authTheme.textDim : 'transparent',
            marginBottom: 12,
          }}
        >
          {error ?? `Use at least ${MIN_PASSWORD_LENGTH} characters`}
        </Text>

        <AuthPrimaryButton
          label="Save and continue"
          onPress={handleSave}
          loading={submitting}
          disabled={password.length < MIN_PASSWORD_LENGTH}
        />
        {!submitting ? (
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ alignItems: 'center', marginTop: 16 }}
            hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: authTheme.textDim }}>Back</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </AuthScreenShell>
  );
}
