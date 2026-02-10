import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  ToastAndroid,
  Image,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore, useSettingsStore, useDisplayStore } from '@/store';
import { colors } from '@/constants';
import { ChangePasswordModal } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';


function ProfileSection({
  onChangePassword,
  onDeleteAccount,
  isDeletingAccount,
}: {
  onChangePassword: () => void;
  onDeleteAccount: () => void;
  isDeletingAccount: boolean;
}) {
  const { user, location } = useAuthStore();
  const { avatarUri, setAvatarUri } = useSettingsStore();
  const { hapticFeedback } = useDisplayStore();
  const ds = useScaledStyles();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user?.name || '');
  const avatarSize = Math.max(76, ds.icon(80));

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Needed', 'Please allow photo library access to change your avatar.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      if (hapticFeedback && Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleSaveName = () => {
    setIsEditingName(false);
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const firstName = user?.name?.split(' ')[0] || 'User';

  return (
    <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
      <TouchableOpacity onPress={pickImage} className="items-center" style={{ marginBottom: ds.spacing(16) }}>
        <View
          className="rounded-full overflow-hidden bg-primary-500 items-center justify-center"
          style={{ width: avatarSize, height: avatarSize }}
        >
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} className="w-full h-full" />
          ) : (
            <Text className="text-white font-bold" style={{ fontSize: ds.fontSize(30) }}>
              {firstName.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        <Text className="text-primary-500 font-medium" style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(8) }}>Change Photo</Text>
      </TouchableOpacity>

      <View style={{ marginBottom: ds.spacing(16) }}>
        <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11), marginBottom: ds.spacing(4) }}>Full Name</Text>
        {isEditingName ? (
          <View className="flex-row items-center">
            <TextInput
              value={tempName}
              onChangeText={setTempName}
              className="flex-1 bg-gray-100 text-gray-900"
              style={{
                borderRadius: ds.radius(12),
                minHeight: Math.max(48, ds.buttonH),
                paddingHorizontal: ds.spacing(14),
                fontSize: ds.fontSize(16),
              }}
              autoFocus
            />
            <TouchableOpacity onPress={handleSaveName} style={{ marginLeft: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="checkmark" size={ds.icon(22)} color={colors.primary[500]} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditingName(false)} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="close" size={ds.icon(22)} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => {
              setTempName(user?.name || '');
              setIsEditingName(true);
            }}
            className="flex-row items-center justify-between bg-gray-50"
            style={{
              borderRadius: ds.radius(12),
              minHeight: Math.max(48, ds.buttonH),
              paddingHorizontal: ds.spacing(14),
              paddingVertical: ds.spacing(10),
            }}
          >
            <Text className="text-gray-900" style={{ fontSize: ds.fontSize(16) }}>{user?.name || 'Not set'}</Text>
            <Ionicons name="pencil" size={ds.icon(18)} color={colors.gray[400]} />
          </TouchableOpacity>
        )}
      </View>

      <View style={{ marginBottom: ds.spacing(16) }}>
        <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11), marginBottom: ds.spacing(4) }}>Email</Text>
        <View
          className="flex-row items-center justify-between bg-gray-50"
          style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH), paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(10) }}
        >
          <Text className="text-gray-500" style={{ fontSize: ds.fontSize(16) }}>{user?.email || 'Not set'}</Text>
          <Ionicons name="lock-closed" size={ds.icon(16)} color={colors.gray[400]} />
        </View>
      </View>

      <View style={{ marginBottom: ds.spacing(16) }}>
        <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11), marginBottom: ds.spacing(4) }}>Role</Text>
        <View
          className="flex-row items-center justify-between bg-gray-50"
          style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH), paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(10) }}
        >
          <Text className="text-gray-500 capitalize" style={{ fontSize: ds.fontSize(16) }}>{user?.role || 'Employee'}</Text>
          <Ionicons name="lock-closed" size={ds.icon(16)} color={colors.gray[400]} />
        </View>
      </View>

      <View style={{ marginBottom: ds.spacing(16) }}>
        <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11), marginBottom: ds.spacing(4) }}>Location</Text>
        <View
          className="flex-row items-center justify-between bg-gray-50"
          style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH), paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(10) }}
        >
          <View className="flex-row items-center">
            <Ionicons name="location" size={ds.icon(16)} color={colors.primary[500]} />
            <Text className="text-gray-500" style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(16) }}>{location?.name || 'Not set'}</Text>
          </View>
          <Ionicons name="lock-closed" size={ds.icon(16)} color={colors.gray[400]} />
        </View>
      </View>

      <TouchableOpacity
        onPress={onChangePassword}
        className="bg-gray-100 items-center flex-row justify-center"
        style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH) }}
        activeOpacity={0.7}
      >
        <Ionicons name="key-outline" size={ds.icon(18)} color={colors.primary[600]} />
        <Text className="text-primary-600 font-semibold" style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(15) }}>Change Password</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onDeleteAccount}
        disabled={isDeletingAccount}
        className={isDeletingAccount ? 'bg-gray-200 items-center flex-row justify-center' : 'bg-red-100 items-center flex-row justify-center'}
        style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH), marginTop: ds.spacing(12) }}
        activeOpacity={0.7}
      >
        {isDeletingAccount ? (
          <ActivityIndicator size="small" color="#9CA3AF" />
        ) : (
          <Ionicons name="trash-outline" size={ds.icon(18)} color="#DC2626" />
        )}
        <Text className={isDeletingAccount ? 'text-gray-500 font-semibold' : 'text-red-700 font-semibold'} style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(15) }}>
          {isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ProfileSettingsScreen() {
  const ds = useScaledStyles();
  const { deleteSelfAccount } = useAuthStore();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const openDeleteConfirmation = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setDeleteConfirmText('');
            setShowDeleteModal(true);
          },
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE' || isDeletingAccount) return;
    setIsDeletingAccount(true);

    try {
      await deleteSelfAccount('DELETE');
      setShowDeleteModal(false);
      setDeleteConfirmText('');
      if (Platform.OS === 'android') {
        ToastAndroid.show('Account deleted', ToastAndroid.SHORT);
      } else {
        Alert.alert('Account deleted');
      }
      router.replace('/(auth)/login');
    } catch (error: any) {
      Alert.alert(
        'Unable to delete account',
        error?.message || 'Please try again in a moment.'
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View
        className="bg-white border-b border-gray-100 flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Profile</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <ProfileSection
          onChangePassword={() => setShowPasswordModal(true)}
          onDeleteAccount={openDeleteConfirmation}
          isDeletingAccount={isDeletingAccount}
        />
      </ScrollView>

      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />

      <Modal
        visible={showDeleteModal}
        animationType="fade"
        transparent
        onRequestClose={() => {
          if (!isDeletingAccount) {
            setShowDeleteModal(false);
          }
        }}
      >
        <View className="flex-1 bg-black/40 items-center justify-center" style={{ padding: ds.spacing(20) }}>
          <View
            className="bg-white w-full"
            style={{ borderRadius: ds.radius(16), padding: ds.spacing(16), maxWidth: 420 }}
          >
            <Text className="text-gray-900 font-bold" style={{ fontSize: ds.fontSize(18) }}>
              Confirm permanent deletion
            </Text>
            <Text className="text-gray-600" style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(8) }}>
              Type DELETE to permanently remove your account.
            </Text>

            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              editable={!isDeletingAccount}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Type DELETE"
              placeholderTextColor={colors.gray[400]}
              className="bg-gray-100 text-gray-900"
              style={{
                marginTop: ds.spacing(12),
                borderRadius: ds.radius(12),
                minHeight: Math.max(48, ds.buttonH),
                paddingHorizontal: ds.spacing(14),
                fontSize: ds.fontSize(16),
              }}
            />

            <View className="flex-row" style={{ marginTop: ds.spacing(14) }}>
              <TouchableOpacity
                onPress={() => {
                  if (isDeletingAccount) return;
                  setShowDeleteModal(false);
                }}
                disabled={isDeletingAccount}
                className="flex-1 bg-gray-100 items-center justify-center"
                style={{
                  borderRadius: ds.radius(12),
                  minHeight: Math.max(44, ds.buttonH - 2),
                  marginRight: ds.spacing(10),
                }}
              >
                <Text className="text-gray-700 font-semibold" style={{ fontSize: ds.fontSize(15) }}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                className={
                  deleteConfirmText !== 'DELETE' || isDeletingAccount
                    ? 'flex-1 bg-gray-200 items-center justify-center'
                    : 'flex-1 bg-red-600 items-center justify-center'
                }
                style={{ borderRadius: ds.radius(12), minHeight: Math.max(44, ds.buttonH - 2) }}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className={deleteConfirmText !== 'DELETE' ? 'text-gray-500 font-semibold' : 'text-white font-semibold'} style={{ fontSize: ds.fontSize(15) }}>
                    Permanently Delete
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
