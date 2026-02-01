import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useDraftStore, useSettingsStore, FontSize } from '@/store';
import { colors } from '@/constants';

interface SettingsRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBgColor: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showChevron?: boolean;
  destructive?: boolean;
}

function SettingsRow({
  icon,
  iconColor,
  iconBgColor,
  title,
  subtitle,
  onPress,
  showChevron = true,
  destructive = false,
}: SettingsRowProps) {
  const handlePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="bg-white px-4 py-4 flex-row items-center border-b border-gray-100"
      activeOpacity={0.7}
    >
      <View
        className="w-10 h-10 rounded-xl items-center justify-center mr-4"
        style={{ backgroundColor: iconBgColor }}
      >
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text className={`font-semibold text-base ${destructive ? 'text-red-500' : 'text-gray-900'}`}>
          {title}
        </Text>
        {subtitle && (
          <Text className="text-gray-500 text-sm mt-0.5">{subtitle}</Text>
        )}
      </View>
      {showChevron && (
        <Ionicons name="chevron-forward" size={20} color={colors.gray[400]} />
      )}
    </TouchableOpacity>
  );
}

const FONT_SIZE_OPTIONS: { value: FontSize; label: string; preview: string }[] = [
  { value: 'normal', label: 'Normal', preview: 'Aa' },
  { value: 'large', label: 'Large', preview: 'Aa' },
  { value: 'xlarge', label: 'Extra Large', preview: 'Aa' },
];

export default function SettingsScreen() {
  const { user, location, signOut, setViewMode } = useAuthStore();
  const { getTotalItemCount, clearAllDrafts } = useDraftStore();
  const { fontSize, setFontSize } = useSettingsStore();

  const draftCount = getTotalItemCount();
  const firstName = user?.name?.split(' ')[0] || 'User';
  const isManager = user?.role === 'manager';

  const handleFontSizeChange = (size: FontSize) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setFontSize(size);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            await signOut();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleClearDrafts = () => {
    if (draftCount === 0) {
      Alert.alert('No Drafts', 'You have no draft items to clear.');
      return;
    }

    Alert.alert(
      'Clear Drafts',
      `Are you sure you want to clear all ${draftCount} draft item${draftCount !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            clearAllDrafts();
          },
        },
      ]
    );
  };

  const handleSwitchToManager = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setViewMode('manager');
    router.replace('/(manager)');
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="bg-white px-5 py-4 border-b border-gray-100">
          <Text className="text-2xl font-bold text-gray-900">Settings</Text>
        </View>

        {/* User Info Section */}
        <View className="bg-white mt-4 mx-4 rounded-2xl overflow-hidden"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          <View className="px-4 py-5 flex-row items-center">
            <View className="w-16 h-16 bg-primary-500 rounded-full items-center justify-center mr-4">
              <Text className="text-white font-bold text-2xl">
                {firstName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-gray-900 font-bold text-xl">{user?.name || 'User'}</Text>
              <Text className="text-gray-500 text-sm mt-1">{user?.email || ''}</Text>
              {location && (
                <View className="flex-row items-center mt-2">
                  <Ionicons name="location" size={14} color={colors.primary[500]} />
                  <Text className="text-primary-600 text-sm ml-1 font-medium">{location.name}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Account Section */}
        <View className="mt-6">
          <Text className="px-5 mb-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Account
          </Text>
          <View className="bg-white rounded-xl mx-4 overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <SettingsRow
              icon="person-outline"
              iconColor="#3B82F6"
              iconBgColor="#DBEAFE"
              title="Profile"
              subtitle="Edit your profile information"
              onPress={() => router.push('/profile')}
            />
            <SettingsRow
              icon="location-outline"
              iconColor={colors.primary[600]}
              iconBgColor={colors.primary[100]}
              title="Change Location"
              subtitle={location?.name || 'Select a location'}
              onPress={() => router.push('/(tabs)' as any)}
            />
          </View>
        </View>

        {/* Display Section */}
        <View className="mt-6">
          <Text className="px-5 mb-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Display
          </Text>
          <View className="bg-white rounded-xl mx-4 overflow-hidden p-4"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <View className="flex-row items-center mb-3">
              <View
                className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                style={{ backgroundColor: '#E0E7FF' }}
              >
                <Ionicons name="text-outline" size={22} color="#4F46E5" />
              </View>
              <Text className="text-base font-semibold text-gray-900">Font Size</Text>
            </View>
            <View className="flex-row justify-between">
              {FONT_SIZE_OPTIONS.map((option) => {
                const isSelected = fontSize === option.value;
                const previewSize = option.value === 'normal' ? 14 : option.value === 'large' ? 17 : 20;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => handleFontSizeChange(option.value)}
                    className={`flex-1 mx-1 py-3 rounded-xl items-center border-2 ${
                      isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <Text
                      style={{ fontSize: previewSize }}
                      className={`font-bold mb-1 ${isSelected ? 'text-primary-600' : 'text-gray-600'}`}
                    >
                      {option.preview}
                    </Text>
                    <Text
                      className={`text-xs ${isSelected ? 'text-primary-600 font-medium' : 'text-gray-500'}`}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Data Section */}
        <View className="mt-6">
          <Text className="px-5 mb-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Data
          </Text>
          <View className="bg-white rounded-xl mx-4 overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <SettingsRow
              icon="document-text-outline"
              iconColor="#F59E0B"
              iconBgColor="#FEF3C7"
              title="Draft Items"
              subtitle={draftCount > 0 ? `${draftCount} item${draftCount !== 1 ? 's' : ''} saved` : 'No drafts'}
              onPress={() => router.push('/draft')}
            />
            <SettingsRow
              icon="trash-outline"
              iconColor="#EF4444"
              iconBgColor="#FEE2E2"
              title="Clear All Drafts"
              onPress={handleClearDrafts}
              showChevron={false}
            />
          </View>
        </View>

        {/* Manager Switch - Only visible to managers */}
        {isManager && (
          <View className="mt-6">
            <View className="bg-white rounded-xl mx-4 overflow-hidden"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 4,
                elevation: 2,
              }}
            >
              <SettingsRow
                icon="swap-horizontal"
                iconColor="#7C3AED"
                iconBgColor="#EDE9FE"
                title="Switch to Manager View"
                subtitle="Manage orders and fulfillment"
                onPress={handleSwitchToManager}
              />
            </View>
          </View>
        )}

        {/* Sign Out Section */}
        <View className="mt-6">
          <View className="bg-white rounded-xl mx-4 overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <SettingsRow
              icon="log-out-outline"
              iconColor="#EF4444"
              iconBgColor="#FEE2E2"
              title="Sign Out"
              onPress={handleSignOut}
              showChevron={false}
              destructive
            />
          </View>
        </View>

        {/* App Info */}
        <View className="mt-8 items-center">
          <Text className="text-gray-400 text-sm">Fast Order v1.0.0</Text>
          <Text className="text-gray-400 text-xs mt-1">Babytuna Inventory System</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
