import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Alert, Image, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore, useSettingsStore, useDisplayStore } from '@/store';
import { colors } from '@/constants';
import { ChangePasswordModal } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useSettingsBackRoute } from '@/hooks/useSettingsBackRoute';
import { seedStations } from '@/services';

function ProfileSection({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, locations } = useAuthStore();
  const { avatarUri, setAvatarUri } = useSettingsStore();
  const { hapticFeedback } = useDisplayStore();
  const ds = useScaledStyles();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user?.name || '');
  const [isSeedingStations, setIsSeedingStations] = useState(false);
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

  const handleSeedStations = async () => {
    if (isSeedingStations) return;
    setIsSeedingStations(true);
    try {
      const result = await seedStations();
      const warningText =
        result.warnings.length > 0 ? `\n\nWarnings:\n- ${result.warnings.join('\n- ')}` : '';
      Alert.alert(
        'Seed Complete',
        `Created ${result.createdAreas} stations, ${result.createdItems} items, and linked ${result.upsertedLinks} item mappings.${warningText}`
      );
    } catch (error: any) {
      Alert.alert('Seed Failed', error?.message ?? 'Unable to seed stations.');
    } finally {
      setIsSeedingStations(false);
    }
  };

  const firstName = user?.name?.split(' ')[0] || 'Manager';

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
          <View className="flex-row items-center">
            <View className="bg-purple-100" style={{ paddingHorizontal: ds.spacing(10), paddingVertical: ds.spacing(4), borderRadius: ds.radius(999), marginRight: ds.spacing(8) }}>
              <Text className="text-purple-700 font-semibold" style={{ fontSize: ds.fontSize(11) }}>Manager</Text>
            </View>
            <Text className="text-gray-500 capitalize" style={{ fontSize: ds.fontSize(16) }}>{user?.role || 'Manager'}</Text>
          </View>
          <Ionicons name="lock-closed" size={ds.icon(16)} color={colors.gray[400]} />
        </View>
      </View>

      <View style={{ marginBottom: ds.spacing(16) }}>
        <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11), marginBottom: ds.spacing(4) }}>Managed Locations</Text>
        <View className="bg-gray-50 overflow-hidden" style={{ borderRadius: ds.radius(12) }}>
          {locations.map((loc, index) => (
            <View
              key={loc.id}
              className="flex-row items-center"
              style={{
                minHeight: Math.max(52, ds.rowH - ds.spacing(12)),
                paddingHorizontal: ds.spacing(14),
                borderBottomWidth: index < locations.length - 1 ? 1 : 0,
                borderBottomColor: '#F3F4F6',
              }}
            >
              <View
                className="bg-primary-100 items-center justify-center"
                style={{ width: ds.icon(28), height: ds.icon(28), borderRadius: ds.radius(8) }}
              >
                <Ionicons name="restaurant" size={ds.icon(16)} color={colors.primary[500]} />
              </View>
              <View className="flex-1" style={{ marginLeft: ds.spacing(10) }}>
                <Text className="text-gray-900 font-medium" style={{ fontSize: ds.fontSize(15) }}>{loc.name}</Text>
                <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12) }}>{loc.short_code}</Text>
              </View>
              <View
                style={{
                  width: ds.icon(10),
                  height: ds.icon(10),
                  borderRadius: ds.radius(999),
                  backgroundColor: loc.active ? '#22C55E' : '#D1D5DB',
                }}
              />
            </View>
          ))}
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
        onPress={handleSeedStations}
        disabled={isSeedingStations}
        className={isSeedingStations ? 'bg-gray-200 items-center flex-row justify-center' : 'bg-orange-100 items-center flex-row justify-center'}
        style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH), marginTop: ds.spacing(12) }}
        activeOpacity={0.7}
      >
        <Ionicons name="flask-outline" size={ds.icon(18)} color={colors.primary[600]} />
        <Text className="text-orange-700 font-semibold" style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(15) }}>
          {isSeedingStations ? 'Seeding Stations...' : 'Seed Stations'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ManagerProfileSettingsScreen() {
  const ds = useScaledStyles();
  const settingsBackRoute = useSettingsBackRoute();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View
        className="bg-white border-b border-gray-100 flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <TouchableOpacity
          onPress={() => router.replace(settingsBackRoute)}
          style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Profile</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <ProfileSection onChangePassword={() => setShowPasswordModal(true)} />
      </ScrollView>

      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </SafeAreaView>
  );
}
