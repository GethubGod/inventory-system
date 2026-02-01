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
import { useAuthStore } from '@/store';
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

export default function ManagerSettingsScreen() {
  const { user, locations, signOut, setViewMode } = useAuthStore();

  const firstName = user?.name?.split(' ')[0] || 'Manager';

  const handleSwitchToEmployee = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setViewMode('employee');
    router.replace('/(tabs)');
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
              <Text className="text-gray-900 font-bold text-xl">{user?.name || 'Manager'}</Text>
              <Text className="text-gray-500 text-sm mt-1">{user?.email || ''}</Text>
              <View className="flex-row items-center mt-2">
                <View className="bg-purple-100 px-2.5 py-1 rounded-full">
                  <Text className="text-purple-700 text-xs font-semibold capitalize">
                    {user?.role || 'Manager'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Locations Section */}
        <View className="mt-6">
          <Text className="px-5 mb-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Managed Locations
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
            {locations.map((loc, index) => (
              <View
                key={loc.id}
                className={`flex-row items-center px-4 py-4 ${
                  index < locations.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <View className="w-10 h-10 bg-primary-100 rounded-xl items-center justify-center">
                  <Ionicons name="restaurant" size={20} color="#F97316" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-gray-900 font-medium">{loc.name}</Text>
                  <Text className="text-gray-500 text-sm">{loc.short_code}</Text>
                </View>
                <View
                  className={`w-3 h-3 rounded-full ${
                    loc.active ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
              </View>
            ))}
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
              onPress={() => {}}
            />
            <SettingsRow
              icon="mail-outline"
              iconColor="#8B5CF6"
              iconBgColor="#EDE9FE"
              title="Email"
              subtitle={user?.email || ''}
              onPress={() => {}}
              showChevron={false}
            />
          </View>
        </View>

        {/* Switch View Section */}
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
              title="Switch to Employee View"
              subtitle="Place your own orders"
              onPress={handleSwitchToEmployee}
            />
          </View>
        </View>

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
          <Text className="text-gray-400 text-xs mt-1">Babytuna Manager Portal</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
