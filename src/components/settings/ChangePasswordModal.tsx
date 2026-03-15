import React, { useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import { colors, hairline, radii } from '@/theme/design';
import { useDisplayStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({
  visible,
  onClose,
}: ChangePasswordModalProps) {
  const { hapticFeedback } = useDisplayStore();
  const ds = useScaledStyles();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const handleClose = () => {
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

    setIsLoading(true);

    try {
      // Update password via Supabase Auth
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      if (hapticFeedback && Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert('Success', 'Your password has been updated', [
        { text: 'OK', onPress: handleClose },
      ]);
    } catch (error: any) {
      if (hapticFeedback && Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert('Error', error.message || 'Failed to update password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
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
    </Modal>
  );
}
