// Screen 07 — Sign in. Name + PIN-or-password as real text fields so iOS
// autofill works (username/password content types). Server-verified, rate
// limited, manager-resettable. The legacy access-code signup stays reachable
// through the small link at the bottom (standing roadmap rule).

import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { AuthLoadingScreen } from '@/components';
import { useAuthScreenGuard } from '@/hooks';
import { getLoginFailureCode, signInWithName } from '@/services/loginCredentials';
import { authTheme } from '@/theme/design';
import { AuthPrimaryButton } from './components/AuthPrimaryButton';
import { AuthScreenShell } from './components/AuthScreenShell';

const FIELD_LABEL_STYLE = {
  fontSize: 11,
  fontWeight: '600' as const,
  letterSpacing: 0.5,
  color: 'rgba(255, 255, 255, 0.5)',
  marginBottom: 6,
};

export default function NameSignInScreen() {
  const guard = useAuthScreenGuard();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (guard.isChecking) return <AuthLoadingScreen />;
  if (guard.authenticatedRedirectTo) return <Redirect href={guard.authenticatedRedirectTo} />;

  const canSubmit = name.trim().length > 0 && secret.length > 0 && !submitting;

  const handleSignIn = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInWithName(name, secret);
      // The auth guard redirects on the next render once the session lands.
    } catch (signInError) {
      const code = getLoginFailureCode(signInError);
      setError(
        signInError instanceof Error && (code || signInError.message)
          ? signInError.message
          : 'Unable to sign in right now. Check your connection.',
      );
      if (code === 'invalid') setSecret('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreenShell>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ fontSize: 23, fontWeight: '700', color: authTheme.text, marginBottom: 20 }}>
          Sign in
        </Text>

        <Text style={FIELD_LABEL_STYLE}>NAME</Text>
        <TextInput
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (error) setError(null);
          }}
          placeholder="Your name"
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          textContentType="username"
          autoComplete="username"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          editable={!submitting}
          style={{
            backgroundColor: authTheme.well,
            borderWidth: 1,
            borderColor: authTheme.wellBorder,
            borderRadius: 13,
            paddingHorizontal: 13,
            height: 48,
            fontSize: 15,
            fontWeight: '600',
            color: authTheme.text,
            marginBottom: 13,
          }}
        />

        <Text style={FIELD_LABEL_STYLE}>PIN OR PASSWORD</Text>
        <TextInput
          value={secret}
          onChangeText={(value) => {
            setSecret(value);
            if (error) setError(null);
          }}
          placeholder="••••"
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleSignIn}
          editable={!submitting}
          style={{
            backgroundColor: authTheme.well,
            borderWidth: 1,
            borderColor: authTheme.wellBorder,
            borderRadius: 13,
            paddingHorizontal: 13,
            height: 48,
            fontSize: 16,
            letterSpacing: 3,
            color: authTheme.text,
            marginBottom: error ? 8 : 16,
          }}
        />

        {error ? (
          <Text style={{ fontSize: 12, color: authTheme.accent, marginBottom: 10 }}>{error}</Text>
        ) : null}

        <AuthPrimaryButton
          label="Sign in"
          onPress={handleSignIn}
          loading={submitting}
          disabled={!canSubmit}
        />

        <Text
          style={{
            fontSize: 12,
            color: authTheme.textFaint,
            textAlign: 'center',
            marginTop: 13,
          }}
        >
          Forgot it? Ask the manager for a reset
        </Text>
      </View>

      <View style={{ alignItems: 'center', marginBottom: 6 }}>
        <Link href="/(auth)/signup" asChild>
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: authTheme.textDim }}>
              Have a sign-up code instead?
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </AuthScreenShell>
  );
}
