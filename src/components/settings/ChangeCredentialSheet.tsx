import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { isValidPassword, isValidPin, setMyCredential, type CredentialKind } from '@/services/loginCredentials';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';

interface ChangeCredentialSheetProps {
  visible: boolean;
  onClose: () => void;
  initialKind?: CredentialKind;
}

export function ChangeCredentialSheet({ visible, onClose, initialKind = 'pin' }: ChangeCredentialSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const [credentialKind, setCredentialKind] = useState<CredentialKind>(initialKind);
  const [secretDraft, setSecretDraft] = useState('');
  const [secretConfirm, setSecretConfirm] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setCredentialKind(initialKind);
    setSecretDraft('');
    setSecretConfirm('');
    setSheetError(null);
  }, [initialKind, visible]);
  const closeSheet = () => { if (!isSaving) onClose(); };

  const handleSaveCredential = useCallback(async () => {
    const secret = secretDraft.trim();
    if (credentialKind === 'pin' && !isValidPin(secret)) {
      setSheetError('The PIN must be exactly 4 digits.');
      return;
    }
    if (credentialKind === 'password' && !isValidPassword(secret)) {
      setSheetError('The password must be at least 8 characters.');
      return;
    }
    if (secret !== secretConfirm.trim()) {
      setSheetError(
        credentialKind === 'pin' ? 'The PINs do not match.' : 'The passwords do not match.',
      );
      return;
    }
    setIsSaving(true);
    setSheetError(null);
    try {
      await setMyCredential(credentialKind, secret);
      onClose();
      Alert.alert(
        'Saved',
        credentialKind === 'pin'
          ? 'Sign in with your name and this PIN from now on.'
          : 'Sign in with your name and this password from now on.',
      );
    } catch (error) {
      setSheetError(
        error instanceof Error ? error.message : 'Could not save your sign-in.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [credentialKind, onClose, secretConfirm, secretDraft]);

  const sheetInputStyle = {
    minHeight: 48,
    backgroundColor: tipsTheme.card,
    borderWidth: glassHairlineWidth,
    borderColor: tipsTheme.hairline,
    borderRadius: 14,
    paddingHorizontal: ds.spacing(14),
    fontSize: ds.fontSize(15),
    color: tipsTheme.ink,
  } as const;

  const sheetCta = (label: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={isSaving}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        minHeight: 50,
        borderRadius: radii.pill,
        backgroundColor: isSaving ? tipsTheme.disabled : tipsTheme.accent,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: ds.spacing(14),
      }}
    >
      {isSaving ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );

  const sheetErrorView = sheetError ? (
    <View
      style={{
        backgroundColor: tipsTheme.tint,
        borderRadius: 12,
        paddingHorizontal: ds.spacing(12),
        paddingVertical: ds.spacing(9),
        marginTop: ds.spacing(10),
      }}
    >
      <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.alert }}>{sheetError}</Text>
    </View>
  ) : null;

  return (
      <BottomSheetShell
        visible={visible}
        onClose={closeSheet}
        bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
      >
        <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
          Change PIN or password
        </Text>
        <Text
          style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
        >
          You sign in with your name and this.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            borderRadius: radii.pill,
            padding: 4,
            marginBottom: ds.spacing(12),
          }}
        >
          {(
            [
              { kind: 'pin' as CredentialKind, label: 'Restaurant PIN' },
              { kind: 'password' as CredentialKind, label: 'Password' },
            ]
          ).map((option) => {
            const selected = option.kind === credentialKind;
            return (
              <TouchableOpacity
                key={option.kind}
                onPress={() => {
                  setCredentialKind(option.kind);
                  setSecretDraft('');
                  setSecretConfirm('');
                  setSheetError(null);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                style={{
                  flex: 1,
                  paddingVertical: ds.spacing(9),
                  borderRadius: radii.pill,
                  backgroundColor: selected ? tipsTheme.accent : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: selected ? '700' : '600',
                    color: selected ? '#FFFFFF' : tipsTheme.ink2,
                  }}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput
          value={secretDraft}
          onChangeText={setSecretDraft}
          placeholder={credentialKind === 'pin' ? 'New 4-digit PIN' : 'New password'}
          placeholderTextColor={tipsTheme.ink3}
          secureTextEntry
          keyboardType={credentialKind === 'pin' ? 'number-pad' : 'default'}
          maxLength={credentialKind === 'pin' ? 4 : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          accessibilityLabel={credentialKind === 'pin' ? 'New PIN' : 'New password'}
          style={[sheetInputStyle, { marginBottom: ds.spacing(8) }]}
        />
        <TextInput
          value={secretConfirm}
          onChangeText={setSecretConfirm}
          placeholder={credentialKind === 'pin' ? 'Repeat the PIN' : 'Repeat the password'}
          placeholderTextColor={tipsTheme.ink3}
          secureTextEntry
          keyboardType={credentialKind === 'pin' ? 'number-pad' : 'default'}
          maxLength={credentialKind === 'pin' ? 4 : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={
            credentialKind === 'pin' ? 'Repeat the new PIN' : 'Repeat the new password'
          }
          style={sheetInputStyle}
        />
        {sheetErrorView}
        {sheetCta(
          credentialKind === 'pin' ? 'Save PIN' : 'Save password',
          () => void handleSaveCredential(),
        )}
      </BottomSheetShell>
  );
}
