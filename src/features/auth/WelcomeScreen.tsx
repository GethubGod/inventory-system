// Screens 01/02 — Welcome. Two actions only; the paste state is revealed by
// "I have an invite link". The clipboard is read exclusively from that tap
// (iOS surfaces a paste notice; never read silently on launch).

import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { AuthLoadingScreen, AuthLogoHeader } from '@/components';
import { useAuthScreenGuard } from '@/hooks';
import { parseJoinToken } from '@/services/inviteLinks';
import { authTheme } from '@/theme/design';
import { AuthPrimaryButton } from './components/AuthPrimaryButton';
import { AuthScreenShell } from './components/AuthScreenShell';

const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

function extractToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (RAW_TOKEN_PATTERN.test(trimmed)) return trimmed;
  return parseJoinToken(trimmed);
}

export default function WelcomeScreen() {
  const router = useRouter();
  const guard = useAuthScreenGuard();
  const [showPaste, setShowPaste] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (guard.isChecking) return <AuthLoadingScreen />;
  if (guard.authenticatedRedirectTo) return <Redirect href={guard.authenticatedRedirectTo} />;

  const handleShowPaste = async () => {
    setShowPaste(true);
    setError(null);
    try {
      // User-initiated read only — this tap is the trigger.
      const clip = await Clipboard.getStringAsync();
      if (clip && extractToken(clip)) {
        setLinkInput(clip.trim());
      }
    } catch {
      // Clipboard unavailable — the field still accepts manual paste.
    }
  };

  const handleContinue = () => {
    const token = extractToken(linkInput);
    if (!token) {
      setError("That doesn't look like an invite link. Paste the whole link from your manager.");
      return;
    }
    setError(null);
    router.push(
      { pathname: '/(auth)/invite-hello', params: { token } } as Parameters<typeof router.push>[0],
    );
  };

  return (
    <AuthScreenShell>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <AuthLogoHeader size={64} />
        </View>

        {showPaste ? (
          <>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '600',
                letterSpacing: 0.5,
                color: 'rgba(255, 255, 255, 0.5)',
                marginBottom: 6,
              }}
            >
              PASTE YOUR INVITE LINK
            </Text>
            <TextInput
              accessibilityLabel="Invite link"
              value={linkInput}
              onChangeText={(value) => {
                setLinkInput(value);
                if (error) setError(null);
              }}
              placeholder="tips.babytunasystems.com/join/…"
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              style={{
                backgroundColor: authTheme.well,
                borderWidth: 1,
                borderColor: authTheme.accent,
                borderRadius: 13,
                paddingHorizontal: 13,
                height: 48,
                fontSize: 14,
                color: authTheme.text,
                marginBottom: error ? 8 : 12,
              }}
            />
            {error ? (
              <Text style={{ fontSize: 12, color: authTheme.accent, marginBottom: 10 }}>
                {error}
              </Text>
            ) : null}
            <AuthPrimaryButton label="Continue" onPress={handleContinue} />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => {
                setShowPaste(false);
                setLinkInput('');
                setError(null);
              }}
              style={{ alignItems: 'center', marginTop: 16 }}
              hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255, 255, 255, 0.6)' }}>
                Back
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={{ gap: 10 }}>
            <AuthPrimaryButton label="I have an invite link" onPress={handleShowPaste} />
            <AuthPrimaryButton
              label="Sign in"
              variant="ghost"
              onPress={() =>
                router.push('/(auth)/sign-in' as Parameters<typeof router.push>[0])
              }
            />
          </View>
        )}
      </View>
    </AuthScreenShell>
  );
}
