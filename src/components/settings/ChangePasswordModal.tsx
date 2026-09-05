import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, hairline, radii } from '@/theme/design';
import { changeEmailPassword } from '@/services/changePassword';
import { getMyCredentialKind, type CredentialKind } from '@/services/loginCredentials';
import { useAuthStore } from '@/store/authStore';
import { ChangeCredentialSheet } from './ChangeCredentialSheet';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ visible, onClose }: ChangePasswordModalProps) {
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const [identity, setIdentity] = useState<{ userId: string; kind: CredentialKind | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !userId) return;
    let active = true;
    setIdentity(null);
    setLoadError(null);
    void getMyCredentialKind(userId).then(
      (kind) => { if (active) setIdentity({ userId, kind }); },
      (error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : 'Unable to load your sign-in settings.'); },
    );
    return () => { active = false; };
  }, [userId, visible]);

  const isResolving = !identity || identity.userId !== userId;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {!visible ? null : isResolving ? (
        <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.white, borderRadius: radii.card, padding: 24, gap: 16 }}>
            {loadError || !userId ? <Text>{loadError ?? 'Sign in again to change your sign-in details.'}</Text> : <ActivityIndicator accessibilityLabel="Loading sign-in settings" />}
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sign-in settings" style={{ minHeight: 44, justifyContent: 'center' }}><Text>Close</Text></TouchableOpacity>
          </View>
        </View>
      ) : identity.kind ? (
        <ChangeCredentialSheet visible presentation="embedded" onClose={onClose} initialKind={identity.kind} />
      ) : (
        <EmailPasswordContent onClose={onClose} />
      )}
    </Modal>
  );
}

function EmailPasswordContent({ onClose }: Pick<ChangePasswordModalProps, 'onClose'>) {
  const ds = useScaledStyles();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const handleClose = () => {
    operation.current?.abort();
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    if (isLoading) return;
    const controller = new AbortController();
    operation.current = controller;
    setIsLoading(true);

    try {
      await changeEmailPassword(currentPassword, newPassword, controller.signal);
      if (controller.signal.aborted) return;

      Alert.alert('Success', 'Your password has been updated', [
        { text: 'OK', onPress: handleClose },
      ]);
    } catch (error: unknown) {
      if (!controller.signal.aborted) Alert.alert('Error', error instanceof Error ? error.message : 'Failed to update password');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <Pressable
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' }}
          onPress={handleClose}
        >
          <Pressable
            style={{ backgroundColor: colors.white, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
              <View style={{ width: ds.spacing(40), height: 4, borderRadius: 2, backgroundColor: colors.textMuted }} />
            </View>

            {/* Header */}
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: hairline, borderBottomColor: colors.divider, paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
            >
              <TouchableOpacity onPress={handleClose} disabled={isLoading} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ fontSize: ds.fontSize(16), color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: ds.fontSize(18), fontWeight: '600', color: colors.textPrimary }}>
                Change Password
              </Text>
              <View style={{ width: ds.spacing(56) }} />
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16), paddingBottom: ds.spacing(40) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {/* Current Password */}
              <View style={{ marginBottom: ds.spacing(16) }}>
              <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  Current Password
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    borderRadius: radii.stepper,
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                  }}
                >
                  <TextInput
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry={!showCurrentPassword}
                    placeholder="Enter current password"
                    placeholderTextColor={colors.textMuted}
                    style={{ flex: 1, fontSize: ds.fontSize(15), color: colors.textPrimary }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <Ionicons
                      name={showCurrentPassword ? 'eye-off' : 'eye'}
                      size={ds.icon(22)}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* New Password */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  New Password
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    borderRadius: radii.stepper,
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                  }}
                >
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNewPassword}
                    placeholder="Enter new password"
                    placeholderTextColor={colors.textMuted}
                    style={{ flex: 1, fontSize: ds.fontSize(15), color: colors.textPrimary }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    onPress={() => setShowNewPassword(!showNewPassword)}
                    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <Ionicons
                      name={showNewPassword ? 'eye-off' : 'eye'}
                      size={ds.icon(22)}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4), color: colors.textMuted }}>
                  Must be at least 8 characters
                </Text>
              </View>

              {/* Confirm Password */}
              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  Confirm New Password
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    borderRadius: radii.stepper,
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                  }}
                >
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.textMuted}
                    style={{ flex: 1, fontSize: ds.fontSize(15), color: colors.textPrimary }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off' : 'eye'}
                      size={ds.icon(22)}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isLoading}
                style={{
                  borderRadius: radii.submitButton,
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: Math.max(48, ds.buttonH),
                  backgroundColor: isLoading ? colors.primaryLight : colors.primary,
                }}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={{ fontSize: ds.buttonFont, fontWeight: '600', color: colors.white }}>
                    Update Password
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
  );
}
