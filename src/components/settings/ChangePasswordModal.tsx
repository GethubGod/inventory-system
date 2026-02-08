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
import { colors } from '@/constants';
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
          className="flex-1 bg-black/50 justify-end"
          onPress={handleClose}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <View className="items-center" style={{ paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
              <View style={{ width: ds.spacing(40), height: ds.spacing(4), borderRadius: ds.radius(999) }} className="bg-gray-300" />
            </View>

            {/* Header */}
            <View
              className="flex-row justify-between items-center border-b border-gray-100"
              style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
            >
              <TouchableOpacity onPress={handleClose} disabled={isLoading} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text className="text-gray-500" style={{ fontSize: ds.fontSize(16) }}>Cancel</Text>
              </TouchableOpacity>
              <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>
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
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Current Password
                </Text>
                <View
                  className="flex-row items-center bg-gray-100"
                  style={{
                    borderRadius: ds.radius(12),
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                  }}
                >
                  <TextInput
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry={!showCurrentPassword}
                    placeholder="Enter current password"
                    placeholderTextColor={colors.gray[400]}
                    className="flex-1 text-gray-900"
                    style={{ fontSize: ds.fontSize(15) }}
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
                      color={colors.gray[400]}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* New Password */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  New Password
                </Text>
                <View
                  className="flex-row items-center bg-gray-100"
                  style={{
                    borderRadius: ds.radius(12),
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                  }}
                >
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNewPassword}
                    placeholder="Enter new password"
                    placeholderTextColor={colors.gray[400]}
                    className="flex-1 text-gray-900"
                    style={{ fontSize: ds.fontSize(15) }}
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
                      color={colors.gray[400]}
                    />
                  </TouchableOpacity>
                </View>
                <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4) }}>
                  Must be at least 8 characters
                </Text>
              </View>

              {/* Confirm Password */}
              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Confirm New Password
                </Text>
                <View
                  className="flex-row items-center bg-gray-100"
                  style={{
                    borderRadius: ds.radius(12),
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                  }}
                >
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.gray[400]}
                    className="flex-1 text-gray-900"
                    style={{ fontSize: ds.fontSize(15) }}
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
                      color={colors.gray[400]}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isLoading}
                className={`rounded-xl items-center justify-center ${
                  isLoading ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                style={{ minHeight: Math.max(48, ds.buttonH), borderRadius: ds.radius(12) }}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont }}>
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
