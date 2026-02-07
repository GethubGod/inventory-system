import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { AuthLogoHeader, SpinningFish } from '@/components';

const ACCESS_CODE_REGEX = /^\d{4}$/;

export default function CompleteProfileScreen() {
  const { session, profile, completeProfile, isLoading } = useAuthStore();
  const [fullName, setFullName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);

  const providerLabel = useMemo(() => {
    const provider = session?.user?.app_metadata?.provider;
    if (provider === 'google') return 'Google';
    if (provider === 'apple') return 'Apple';
    return 'your account';
  }, [session?.user?.app_metadata?.provider]);

  useEffect(() => {
    const initialName =
      profile?.full_name ??
      (session?.user?.user_metadata?.full_name as string | undefined) ??
      (session?.user?.user_metadata?.name as string | undefined) ??
      '';
    if (initialName) {
      setFullName(initialName);
    }
  }, [profile?.full_name, session?.user?.user_metadata?.full_name, session?.user?.user_metadata?.name]);

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (profile?.profile_completed) {
    return <Redirect href="/" />;
  }

  const sanitizeAccessCode = (value: string) => value.replace(/\D/g, '').slice(0, 4);

  const getInputStyle = (inputName: string) => {
    const isFocused = focusedInput === inputName;
    return `flex-row items-center px-4 rounded-xl ${
      isFocused
        ? 'bg-white border-2 border-primary-500'
        : 'bg-gray-100 border-2 border-transparent'
    }`;
  };

  const handleContinue = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }

    if (!ACCESS_CODE_REGEX.test(accessCode)) {
      setAccessCodeError('Access code must be exactly 4 digits.');
      return;
    }

    try {
      await completeProfile(fullName.trim(), accessCode);
      router.replace('/');
    } catch (error: any) {
      const message = error?.message || 'Unable to complete profile.';
      if (message.toLowerCase().includes('invalid access code')) {
        Alert.alert('Invalid Access Code', 'Please enter a valid 4-digit access code.');
        return;
      }
      Alert.alert('Profile Setup Failed', message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 bg-black"
      >
        <View className="flex-1 px-6 pt-10 pb-8">
          <View className="items-center mb-6">
            <AuthLogoHeader size={120} />
          </View>

          <View
            className="bg-white rounded-2xl p-6 border border-gray-100"
            style={{
              elevation: 8,
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 6 },
            }}
          >
            <Text className="text-2xl font-bold text-gray-900 mb-2 text-center">
              Complete Profile
            </Text>
            <Text className="text-sm text-gray-500 mb-6 text-center">
              Finish setup for {providerLabel}.
            </Text>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">Full Name</Text>
              <View className={getInputStyle('name')} style={{ height: 48 }}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={focusedInput === 'name' ? '#F97316' : '#9CA3AF'}
                />
                <TextInput
                  className="flex-1 ml-3 text-gray-900 text-base"
                  placeholder="Enter your full name"
                  placeholderTextColor="#9CA3AF"
                  value={fullName}
                  onChangeText={setFullName}
                  autoComplete="name"
                  onFocus={() => setFocusedInput('name')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            <View className="mb-6">
              <Text className="text-sm font-medium text-gray-700 mb-2">Access Code</Text>
              <View className={getInputStyle('accessCode')} style={{ height: 48 }}>
                <Ionicons
                  name="key-outline"
                  size={20}
                  color={focusedInput === 'accessCode' ? '#F97316' : '#9CA3AF'}
                />
                <TextInput
                  className="flex-1 ml-3 text-gray-900 text-base"
                  placeholder="Enter 4-digit code"
                  placeholderTextColor="#9CA3AF"
                  value={accessCode}
                  onChangeText={(value) => {
                    setAccessCode(sanitizeAccessCode(value));
                    if (accessCodeError) {
                      setAccessCodeError(null);
                    }
                  }}
                  secureTextEntry={!showAccessCode}
                  keyboardType="number-pad"
                  maxLength={4}
                  onFocus={() => setFocusedInput('accessCode')}
                  onBlur={() => {
                    setFocusedInput(null);
                    if (accessCode.length > 0 && !ACCESS_CODE_REGEX.test(accessCode)) {
                      setAccessCodeError('Access code must be exactly 4 digits.');
                    }
                  }}
                />
                <TouchableOpacity
                  onPress={() => setShowAccessCode(!showAccessCode)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showAccessCode ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#9CA3AF"
                  />
                </TouchableOpacity>
              </View>
              <Text className="text-xs text-gray-400 mt-1.5 ml-1">
                Enter the 4-digit code provided by your manager.
              </Text>
              {accessCodeError ? (
                <Text className="text-xs text-red-500 mt-1.5 ml-1">{accessCodeError}</Text>
              ) : null}
            </View>

            <TouchableOpacity
              className={`rounded-xl items-center justify-center ${
                isLoading ? 'bg-primary-300' : 'bg-primary-500'
              }`}
              style={{ height: 52 }}
              onPress={handleContinue}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <SpinningFish size="small" />
              ) : (
                <Text className="text-white font-bold text-lg">Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
