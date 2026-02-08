import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Image,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore, useSettingsStore, useDisplayStore } from '@/store';
import { colors } from '@/constants';
import { ChangePasswordModal } from '@/components/settings';

function ProfileSection({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, location } = useAuthStore();
  const { avatarUri, setAvatarUri } = useSettingsStore();
  const { hapticFeedback } = useDisplayStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user?.name || '');

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
    <View className="px-4 py-4">
      <TouchableOpacity onPress={pickImage} className="items-center mb-4">
        <View className="w-20 h-20 rounded-full overflow-hidden bg-primary-500 items-center justify-center">
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} className="w-full h-full" />
          ) : (
            <Text className="text-white font-bold text-3xl">
              {firstName.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        <Text className="text-primary-500 text-sm mt-2 font-medium">Change Photo</Text>
      </TouchableOpacity>

      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Full Name</Text>
        {isEditingName ? (
          <View className="flex-row items-center">
            <TextInput
              value={tempName}
              onChangeText={setTempName}
              className="flex-1 bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
              autoFocus
            />
            <TouchableOpacity onPress={handleSaveName} className="ml-2 p-2">
              <Ionicons name="checkmark" size={24} color={colors.primary[500]} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditingName(false)} className="p-2">
              <Ionicons name="close" size={24} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => {
              setTempName(user?.name || '');
              setIsEditingName(true);
            }}
            className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3"
          >
            <Text className="text-base text-gray-900">{user?.name || 'Not set'}</Text>
            <Ionicons name="pencil" size={18} color={colors.gray[400]} />
          </TouchableOpacity>
        )}
      </View>

      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Email</Text>
        <View className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <Text className="text-base text-gray-500">{user?.email || 'Not set'}</Text>
          <Ionicons name="lock-closed" size={16} color={colors.gray[400]} />
        </View>
      </View>

      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Role</Text>
        <View className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <Text className="text-base text-gray-500 capitalize">{user?.role || 'Employee'}</Text>
          <Ionicons name="lock-closed" size={16} color={colors.gray[400]} />
        </View>
      </View>

      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Location</Text>
        <View className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <View className="flex-row items-center">
            <Ionicons name="location" size={16} color={colors.primary[500]} />
            <Text className="text-base text-gray-500 ml-2">{location?.name || 'Not set'}</Text>
          </View>
          <Ionicons name="lock-closed" size={16} color={colors.gray[400]} />
        </View>
      </View>

      <TouchableOpacity
        onPress={onChangePassword}
        className="bg-gray-100 rounded-xl py-3.5 items-center flex-row justify-center"
        activeOpacity={0.7}
      >
        <Ionicons name="key-outline" size={18} color={colors.primary[600]} />
        <Text className="text-primary-600 font-semibold ml-2">Change Password</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ProfileSettingsScreen() {
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 mr-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Profile</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <ProfileSection onChangePassword={() => setShowPasswordModal(true)} />
      </ScrollView>

      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </SafeAreaView>
  );
}
