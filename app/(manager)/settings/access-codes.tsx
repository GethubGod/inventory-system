import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, TextInput, Share, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useDisplayStore } from '@/store';
import { colors } from '@/constants';
import { updateAccessCodes } from '@/services';
import { useScaledStyles } from '@/hooks/useScaledStyles';


const ACCESS_CODE_REGEX = /^\d{4}$/;

export default function ManagerAccessCodesScreen() {
  const ds = useScaledStyles();
  const { user } = useAuthStore();
  const { hapticFeedback } = useDisplayStore();

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
      // Share cancelled
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
      if (hapticFeedback && Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

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
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Access Codes</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
          <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(16) }}>
            Set the 4-digit access codes used during sign up.
          </Text>

          <View style={{ marginBottom: ds.spacing(16) }}>
            <Text className="text-gray-700 font-medium" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>Employee Access Code</Text>
            <View
              className="flex-row items-center bg-gray-100 border-2 border-transparent"
              style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(14), minHeight: Math.max(48, ds.buttonH) }}
            >
              <Ionicons name="person-outline" size={ds.icon(20)} color="#9CA3AF" />
              <TextInput
                className="flex-1 text-gray-900"
                style={{ marginLeft: ds.spacing(10), fontSize: ds.fontSize(16) }}
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
                  size={ds.icon(20)}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
              {canShare(employeeAccessCode) && (
                <TouchableOpacity
                  onPress={() => handleShare('employee')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ marginLeft: ds.spacing(8) }}
                >
                  <Ionicons name="share-outline" size={ds.icon(20)} color={colors.primary[500]} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={{ marginBottom: ds.spacing(16) }}>
            <Text className="text-gray-700 font-medium" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>Manager Access Code</Text>
            <View
              className="flex-row items-center bg-gray-100 border-2 border-transparent"
              style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(14), minHeight: Math.max(48, ds.buttonH) }}
            >
              <Ionicons name="briefcase-outline" size={ds.icon(20)} color="#9CA3AF" />
              <TextInput
                className="flex-1 text-gray-900"
                style={{ marginLeft: ds.spacing(10), fontSize: ds.fontSize(16) }}
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
                  size={ds.icon(20)}
                  color="#9CA3AF"
                />
              </TouchableOpacity>
              {canShare(managerAccessCode) && (
                <TouchableOpacity
                  onPress={() => handleShare('manager')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ marginLeft: ds.spacing(8) }}
                >
                  <Ionicons name="share-outline" size={ds.icon(20)} color={colors.primary[500]} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {errorMessage ? (
            <Text className="text-red-500" style={{ fontSize: ds.fontSize(12), marginBottom: ds.spacing(12) }}>{errorMessage}</Text>
          ) : null}

          {isSaved ? (
            <View
              className="bg-green-50 flex-row items-center"
              style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(10), marginBottom: ds.spacing(12) }}
            >
              <Ionicons name="checkmark-circle" size={ds.icon(18)} color="#22C55E" />
              <Text className="text-green-700 font-medium" style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(14) }}>
                Codes saved successfully
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            className={isSaving ? 'bg-primary-300 items-center justify-center' : 'bg-primary-500 items-center justify-center'}
            style={{ borderRadius: ds.radius(12), minHeight: Math.max(48, ds.buttonH) }}
            onPress={handleUpdateCodes}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont }}>
              {isSaving ? 'Updating...' : 'Update Codes'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
