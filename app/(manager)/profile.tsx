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
  Linking,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { useAuthStore, useSettingsStore, useDisplayStore } from '@/store';
import { colors, shadow } from '@/constants';
import {
  ExpandableSection,
  SettingsRow,
  SettingToggle,
  TimePickerRow,
  ChangePasswordModal,
  ReminderModal,
  ReminderListItem,
} from '@/components/settings';
import { Reminder, TEXT_SCALE_LABELS } from '@/types/settings';
import {
  requestNotificationPermissions,
  scheduleReminder,
  cancelReminder,
} from '@/services/notificationService';
import { seedStations, updateAccessCodes } from '@/services';
import { BrandLogo } from '@/components';

const ACCESS_CODE_REGEX = /^\d{4}$/;

// ============================================
// PROFILE SECTION
// ============================================
function ProfileSection({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, location, locations } = useAuthStore();
  const { avatarUri, setAvatarUri } = useSettingsStore();
  const { hapticFeedback } = useDisplayStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user?.name || '');
  const [isSeedingStations, setIsSeedingStations] = useState(false);

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

  const firstName = user?.name?.split(' ')[0] || 'Manager';

  return (
    <View className="px-4 py-4">
      {/* Avatar */}
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

      {/* Full Name */}
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

      {/* Email */}
      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Email</Text>
        <View className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <Text className="text-base text-gray-500">{user?.email || 'Not set'}</Text>
          <Ionicons name="lock-closed" size={16} color={colors.gray[400]} />
        </View>
      </View>

      {/* Role */}
      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Role</Text>
        <View className="flex-row items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <View className="flex-row items-center">
            <View className="bg-purple-100 px-2.5 py-1 rounded-full mr-2">
              <Text className="text-purple-700 text-xs font-semibold">Manager</Text>
            </View>
            <Text className="text-base text-gray-500">{user?.role || 'Manager'}</Text>
          </View>
          <Ionicons name="lock-closed" size={16} color={colors.gray[400]} />
        </View>
      </View>

      {/* Managed Locations */}
      <View className="mb-4">
        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">Managed Locations</Text>
        <View className="bg-gray-50 rounded-xl overflow-hidden">
          {locations.map((loc, index) => (
            <View
              key={loc.id}
              className={`flex-row items-center px-4 py-3 ${
                index < locations.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <View className="w-8 h-8 bg-primary-100 rounded-lg items-center justify-center">
                <Ionicons name="restaurant" size={16} color={colors.primary[500]} />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-gray-900 font-medium">{loc.name}</Text>
                <Text className="text-gray-400 text-xs">{loc.short_code}</Text>
              </View>
              <View
                className={`w-2.5 h-2.5 rounded-full ${
                  loc.active ? 'bg-green-500' : 'bg-gray-300'
                }`}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Change Password */}
      <TouchableOpacity
        onPress={onChangePassword}
        className="bg-gray-100 rounded-xl py-3.5 items-center flex-row justify-center"
        activeOpacity={0.7}
      >
        <Ionicons name="key-outline" size={18} color={colors.primary[600]} />
        <Text className="text-primary-600 font-semibold ml-2">Change Password</Text>
      </TouchableOpacity>

      {/* Seed Stations (Temporary) */}
      <TouchableOpacity
        onPress={handleSeedStations}
        disabled={isSeedingStations}
        className={`mt-3 rounded-xl py-3.5 items-center flex-row justify-center ${
          isSeedingStations ? 'bg-gray-200' : 'bg-orange-100'
        }`}
        activeOpacity={0.7}
      >
        <Ionicons name="flask-outline" size={18} color={colors.primary[600]} />
        <Text className="text-orange-700 font-semibold ml-2">
          {isSeedingStations ? 'Seeding Stations...' : 'Seed Stations'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================
// DISPLAY & ACCESSIBILITY SECTION
// ============================================
function DisplaySection() {
  const {
    textScale,
    setTextScale,
    hapticFeedback,
    setHapticFeedback,
    reduceMotion,
    setReduceMotion,
    resetToDefaults,
  } = useDisplayStore();

  const handleReset = () => {
    Alert.alert(
      'Reset Display Settings',
      'Reset all display and accessibility settings to defaults?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            if (hapticFeedback && Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            resetToDefaults();
          },
        },
      ]
    );
  };

  return (
    <View>
      {/* Text Size */}
      <View className="px-4 py-4">
        <Text className="text-base font-medium text-gray-900 mb-3">Text Size</Text>
        <View className="flex-row justify-between mb-2">
          {TEXT_SCALE_LABELS.map((label, index) => {
            const scaleValue = [0.8, 0.9, 1.0, 1.1, 1.4][index] as 0.8 | 0.9 | 1.0 | 1.1 | 1.4;
            const isSelected = textScale === scaleValue;
            return (
              <TouchableOpacity
                key={label}
                onPress={() => setTextScale(scaleValue)}
                className={`px-3 py-2 rounded-lg ${
                  isSelected ? 'bg-primary-500' : 'bg-gray-100'
                }`}
                activeOpacity={0.7}
              >
                <Text
                  className={`text-sm font-medium ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          className="text-gray-500 mt-2"
          style={{ fontSize: 14 * textScale }}
        >
          Preview: The quick brown fox jumps over the lazy dog
        </Text>
      </View>

      <View className="h-px bg-gray-100 mx-4" />

      {/* Haptic Feedback */}
      <SettingToggle
        title="Haptic Feedback"
        subtitle="Vibration on button presses"
        value={hapticFeedback}
        onValueChange={setHapticFeedback}
      />

      {/* Reduce Motion */}
      <SettingToggle
        title="Reduce Motion"
        subtitle="Minimize animations"
        value={reduceMotion}
        onValueChange={setReduceMotion}
        showBorder={false}
      />

      <View className="h-px bg-gray-100 mx-4" />

      {/* Reset */}
      <TouchableOpacity onPress={handleReset} className="px-4 py-4">
        <Text className="text-red-500 font-medium">Reset to Defaults</Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================
// NOTIFICATIONS SECTION
// ============================================
function NotificationsSection() {
  const { notifications, setNotificationSettings, setQuietHours } = useSettingsStore();

  const handlePushToggle = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Please enable notifications in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
    }
    setNotificationSettings({ pushEnabled: enabled });
  };

  return (
    <View>
      {/* Master Toggle */}
      <SettingToggle
        icon="notifications"
        iconColor="#F59E0B"
        iconBgColor="#FEF3C7"
        title="Push Notifications"
        subtitle="Receive alerts on your device"
        value={notifications.pushEnabled}
        onValueChange={handlePushToggle}
      />

      {notifications.pushEnabled && (
        <>
          <View className="px-4 py-2">
            <Text className="text-xs text-gray-500 uppercase tracking-wide">
              Notification Types
            </Text>
          </View>

          <SettingToggle
            title="Order Status Updates"
            subtitle="When orders are fulfilled"
            value={notifications.orderStatus}
            onValueChange={(v) => setNotificationSettings({ orderStatus: v })}
          />

          <SettingToggle
            title="New Orders"
            subtitle="When employees submit orders"
            value={notifications.newOrders}
            onValueChange={(v) => setNotificationSettings({ newOrders: v })}
          />

          <SettingToggle
            title="Daily Summary"
            subtitle="End of day order summary"
            value={notifications.dailySummary}
            onValueChange={(v) => setNotificationSettings({ dailySummary: v })}
          />

          <View className="h-px bg-gray-100 mx-4 my-2" />

          <SettingToggle
            title="Quiet Hours"
            subtitle="Silence notifications during set times"
            value={notifications.quietHours.enabled}
            onValueChange={(v) => setQuietHours({ enabled: v })}
          />

          {notifications.quietHours.enabled && (
            <View className="px-4 pb-4">
              <View className="bg-gray-50 rounded-xl px-4">
                <TimePickerRow
                  title="Start"
                  value={notifications.quietHours.startTime}
                  onTimeChange={(t) => setQuietHours({ startTime: t })}
                />
                <View className="h-px bg-gray-200" />
                <TimePickerRow
                  title="End"
                  value={notifications.quietHours.endTime}
                  onTimeChange={(t) => setQuietHours({ endTime: t })}
                />
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ============================================
// ACCESS CODES SECTION
// ============================================
function AccessCodesSection() {
  const { user } = useAuthStore();

  const [employeeAccessCode, setEmployeeAccessCode] = useState('');
  const [managerAccessCode, setManagerAccessCode] = useState('');
  const [showEmployeeAccessCode, setShowEmployeeAccessCode] = useState(false);
  const [showManagerAccessCode, setShowManagerAccessCode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const sanitizeCode = (value: string) => value.replace(/\D/g, '').slice(0, 4);
  const canShare = (code: string) => ACCESS_CODE_REGEX.test(code);

  const handleShare = async (role: 'employee' | 'manager') => {
    const code = role === 'employee' ? employeeAccessCode : managerAccessCode;
    const roleLabel = role === 'employee' ? 'Employee' : 'Manager';
    try {
      await Share.share({
        message: `Your ${roleLabel.toLowerCase()} access code for Babytuna is: ${code}\n\nUse this code when creating your account.`,
      });
    } catch {
      // User cancelled share
    }
  };

  const handleUpdateCodes = async () => {
    if (user?.role !== 'manager') {
      Alert.alert('Access Denied', 'Only managers can update access codes.');
      return;
    }

    if (!ACCESS_CODE_REGEX.test(employeeAccessCode) || !ACCESS_CODE_REGEX.test(managerAccessCode)) {
      setErrorMessage('Both access codes must be exactly 4 digits.');
      return;
    }

    if (employeeAccessCode === managerAccessCode) {
      setErrorMessage('Employee and manager codes cannot be the same.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);

      await updateAccessCodes({
        employeeAccessCode,
        managerAccessCode,
      });

      setIsSaved(true);
      Alert.alert('Success', 'Access codes updated.', [
        {
          text: 'Share Employee Code',
          onPress: () => handleShare('employee'),
        },
        { text: 'OK' },
      ]);
    } catch (error: any) {
      Alert.alert('Update Failed', error?.message || 'Unable to update access codes.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View className="px-4 py-4">
      <Text className="text-sm text-gray-500 mb-4">
        Set the 4-digit access codes used during sign up.
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-2">Employee Access Code</Text>
        <View className="flex-row items-center px-4 rounded-xl bg-gray-100 border-2 border-transparent">
          <Ionicons name="person-outline" size={20} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-3 text-gray-900 text-base"
            placeholder="4-digit employee code"
            placeholderTextColor="#9CA3AF"
            value={employeeAccessCode}
            onChangeText={(value) => {
              setEmployeeAccessCode(sanitizeCode(value));
              setIsSaved(false);
              if (errorMessage) setErrorMessage(null);
            }}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry={!showEmployeeAccessCode}
          />
          <TouchableOpacity
            onPress={() => setShowEmployeeAccessCode(!showEmployeeAccessCode)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showEmployeeAccessCode ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#9CA3AF"
            />
          </TouchableOpacity>
          {canShare(employeeAccessCode) && (
            <TouchableOpacity
              onPress={() => handleShare('employee')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="ml-2"
            >
              <Ionicons name="share-outline" size={20} color={colors.primary[500]} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-2">Manager Access Code</Text>
        <View className="flex-row items-center px-4 rounded-xl bg-gray-100 border-2 border-transparent">
          <Ionicons name="briefcase-outline" size={20} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-3 text-gray-900 text-base"
            placeholder="4-digit manager code"
            placeholderTextColor="#9CA3AF"
            value={managerAccessCode}
            onChangeText={(value) => {
              setManagerAccessCode(sanitizeCode(value));
              setIsSaved(false);
              if (errorMessage) setErrorMessage(null);
            }}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry={!showManagerAccessCode}
          />
          <TouchableOpacity
            onPress={() => setShowManagerAccessCode(!showManagerAccessCode)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showManagerAccessCode ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#9CA3AF"
            />
          </TouchableOpacity>
          {canShare(managerAccessCode) && (
            <TouchableOpacity
              onPress={() => handleShare('manager')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="ml-2"
            >
              <Ionicons name="share-outline" size={20} color={colors.primary[500]} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {errorMessage ? (
        <Text className="text-xs text-red-500 mb-3">{errorMessage}</Text>
      ) : null}

      {isSaved ? (
        <View className="bg-green-50 rounded-xl py-2.5 px-4 mb-3 flex-row items-center">
          <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
          <Text className="text-green-700 font-medium ml-2 text-sm">Codes saved successfully</Text>
        </View>
      ) : null}

      <TouchableOpacity
        className={`rounded-xl items-center justify-center ${
          isSaving ? 'bg-primary-300' : 'bg-primary-500'
        }`}
        style={{ height: 48 }}
        onPress={handleUpdateCodes}
        disabled={isSaving}
        activeOpacity={0.8}
      >
        <Text className="text-white font-semibold text-base">
          {isSaving ? 'Updating...' : 'Update Codes'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================
// ABOUT & SUPPORT SECTION
// ============================================
function AboutSection() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const { hapticFeedback } = useDisplayStore();

  const handleLink = (url: string) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Linking.openURL(url);
  };

  return (
    <View>
      {/* App Version */}
      <View className="px-4 py-4 flex-row justify-between items-center border-b border-gray-100">
        <Text className="text-base text-gray-900">App Version</Text>
        <Text className="text-base text-gray-500">{appVersion}</Text>
      </View>

      <SettingsRow
        icon="mail-outline"
        iconColor="#3B82F6"
        iconBgColor="#DBEAFE"
        title="Contact Support"
        subtitle="Get help with the app"
        onPress={() => handleLink('mailto:support@babytuna.com?subject=Babytuna App Support')}
      />

      <SettingsRow
        icon="document-text-outline"
        iconColor="#6B7280"
        iconBgColor="#F3F4F6"
        title="Terms of Service"
        onPress={() => handleLink('https://babytuna.com/terms')}
      />

      <SettingsRow
        icon="shield-outline"
        iconColor="#6B7280"
        iconBgColor="#F3F4F6"
        title="Privacy Policy"
        onPress={() => handleLink('https://babytuna.com/privacy')}
        showBorder={false}
      />

      {/* Footer */}
      <View className="items-center py-6">
        <Text className="text-gray-400 text-sm">Babytuna Manager Portal</Text>
      </View>
    </View>
  );
}

// ============================================
// MAIN MANAGER SETTINGS SCREEN
// ============================================
export default function ManagerSettingsScreen() {
  const { user, profile, signOut, setViewMode } = useAuthStore();
  const { hapticFeedback } = useDisplayStore();
  const isManager = (user?.role ?? profile?.role) === 'manager';
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleSwitchToEmployee = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setViewMode('employee');
    router.replace('/(tabs)');
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          if (hapticFeedback && Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="px-5 py-4 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <BrandLogo variant="header" size={28} style={{ marginRight: 10 }} />
            <Text className="text-2xl font-bold text-gray-900">Settings</Text>
          </View>
          <View className="bg-purple-100 px-3 py-1 rounded-full">
            <Text className="text-purple-700 text-sm font-semibold">Manager</Text>
          </View>
        </View>

        {/* Section 1: Profile */}
        <ExpandableSection
          title="Profile"
          icon="person-outline"
          iconColor="#3B82F6"
          iconBgColor="#DBEAFE"
          defaultExpanded={false}
        >
          <ProfileSection onChangePassword={() => setShowPasswordModal(true)} />
        </ExpandableSection>

        {/* Section 2: Display & Accessibility */}
        <ExpandableSection
          title="Display & Accessibility"
          icon="eye-outline"
          iconColor="#8B5CF6"
          iconBgColor="#EDE9FE"
        >
          <DisplaySection />
        </ExpandableSection>

        {/* Section 3: Notifications */}
        <ExpandableSection
          title="Notifications"
          icon="notifications-outline"
          iconColor="#F59E0B"
          iconBgColor="#FEF3C7"
        >
          <NotificationsSection />
        </ExpandableSection>

        {/* Section 4: Access Codes */}
        {isManager && (
          <ExpandableSection
            title="Access Codes"
            icon="key-outline"
            iconColor="#F97316"
            iconBgColor="#FFEDD5"
          >
            <AccessCodesSection />
          </ExpandableSection>
        )}

        {/* Section 5: About & Support */}
        <ExpandableSection
          title="About & Support"
          icon="information-circle-outline"
          iconColor="#6366F1"
          iconBgColor="#E0E7FF"
        >
          <AboutSection />
        </ExpandableSection>

        {/* User Management */}
        {isManager && (
          <View
            className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
            style={shadow.md}
          >
            <SettingsRow
              icon="people-outline"
              iconColor="#2563EB"
              iconBgColor="#DBEAFE"
              title="User Management"
              subtitle="View users, suspend inactive accounts, and delete accounts"
              onPress={() => router.push('/(manager)/settings/user-management')}
              showBorder={false}
            />
          </View>
        )}

        {/* Switch View */}
        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="swap-horizontal"
            iconColor="#7C3AED"
            iconBgColor="#EDE9FE"
            title="Switch to Employee View"
            subtitle="Place your own orders"
            onPress={handleSwitchToEmployee}
            showBorder={false}
          />
        </View>

        {/* Sign Out */}
        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="log-out-outline"
            iconColor="#EF4444"
            iconBgColor="#FEE2E2"
            title="Sign Out"
            onPress={handleSignOut}
            showChevron={false}
            destructive
            showBorder={false}
          />
        </View>

        {/* Signed in as */}
        <View className="items-center mt-2">
          <Text className="text-gray-400 text-sm">
            Signed in as {user?.email}
          </Text>
        </View>

        <View className="items-center px-6 pt-6 pb-10">
          <BrandLogo variant="footer" size={40} />
          <Text className="text-xs text-gray-500 mt-2">Babytuna Systems</Text>
          <Text className="text-xs text-gray-400 mt-1">Version {appVersion}</Text>
        </View>
      </ScrollView>

      {/* Modals */}
      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </SafeAreaView>
  );
}
