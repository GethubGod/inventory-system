import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { AuthLogoHeader, SpinningFish } from '@/components';
import { validatePassword } from '@/lib';

const ACCESS_CODE_REGEX = /^\d{4}$/;

export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const { signUp, isLoading } = useAuthStore();

  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const isPasswordEmpty = password.length === 0;
  const hasConfirmPassword = confirmPassword.length > 0;
  const passwordsMatch = hasConfirmPassword && password === confirmPassword;

  const canCreateAccount = !isLoading && passwordValidation.isValid && passwordsMatch;

  const sanitizeAccessCode = (value: string) => value.replace(/\D/g, '').slice(0, 4);

  const handleSignUp = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }
    if (!passwordValidation.isValid) {
      setPasswordError('Please meet all password requirements before creating your account.');
      return;
    }
    if (!passwordsMatch) {
      setConfirmPasswordError('Passwords do not match.');
      return;
    }
    if (!ACCESS_CODE_REGEX.test(accessCode)) {
      setAccessCodeError('Access code must be exactly 4 digits.');
      return;
    }

    try {
      await signUp(email.trim(), password, name.trim(), accessCode);
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message || 'Failed to create account');
    }
  };

  const getInputStyle = (inputName: string) => {
    const isFocused = focusedInput === inputName;
    return `flex-row items-center px-4 rounded-xl ${
      isFocused
        ? 'bg-white border-2 border-primary-500'
        : 'bg-gray-100 border-2 border-transparent'
    }`;
  };

  return (
    <SafeAreaView className="flex-1 bg-black">
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 bg-black"
      >
        <ScrollView
          className="flex-1 bg-black"
          contentContainerStyle={{ paddingVertical: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="px-6">
            <View className="items-center pt-2 mb-6">
              <AuthLogoHeader size={128} />
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
              <Text className="text-2xl font-bold text-gray-900 mb-6 text-center">
                Create Account
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
                    placeholder="Enter your name"
                    placeholderTextColor="#9CA3AF"
                    value={name}
                    onChangeText={setName}
                    autoComplete="name"
                    onFocus={() => setFocusedInput('name')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Email</Text>
                <View className={getInputStyle('email')} style={{ height: 48 }}>
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={focusedInput === 'email' ? '#F97316' : '#9CA3AF'}
                  />
                  <TextInput
                    className="flex-1 ml-3 text-gray-900 text-base"
                    placeholder="Enter your email"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    onFocus={() => setFocusedInput('email')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View className="mb-3">
                <Text className="text-sm font-medium text-gray-700 mb-2">Password</Text>
                <View className={getInputStyle('password')} style={{ height: 48 }}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={focusedInput === 'password' ? '#F97316' : '#9CA3AF'}
                  />
                  <TextInput
                    className="flex-1 ml-3 text-gray-900 text-base"
                    placeholder="Create a password"
                    placeholderTextColor="#9CA3AF"
                    value={password}
                    onChangeText={(value) => {
                      setPassword(value);
                      if (passwordError) setPasswordError(null);
                      if (confirmPasswordError && value === confirmPassword) {
                        setConfirmPasswordError(null);
                      }
                    }}
                    secureTextEntry={!showPassword}
                    autoComplete="password-new"
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color="#9CA3AF"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                <Text className="text-sm font-semibold text-gray-800 mb-2">Password requirements</Text>
                {passwordValidation.checks.map((check) => {
                  const isNeutral = isPasswordEmpty;
                  const isMet = !isNeutral && check.ok;
                  const iconName = isNeutral
                    ? 'ellipse-outline'
                    : isMet
                      ? 'checkmark-circle'
                      : 'close-circle';
                  const iconColor = isNeutral ? '#9CA3AF' : isMet ? '#16A34A' : '#DC2626';
                  const textColor = isNeutral ? 'text-gray-500' : isMet ? 'text-green-700' : 'text-red-600';

                  return (
                    <View key={check.key} className="flex-row items-center py-1">
                      <Ionicons name={iconName} size={15} color={iconColor} />
                      <Text className={`ml-2 text-xs ${textColor}`}>{check.label}</Text>
                    </View>
                  );
                })}
                {passwordError ? (
                  <Text className="text-xs text-red-600 mt-2">{passwordError}</Text>
                ) : null}
              </View>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Confirm Password</Text>
                <View className={getInputStyle('confirmPassword')} style={{ height: 48 }}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={20}
                    color={focusedInput === 'confirmPassword' ? '#F97316' : '#9CA3AF'}
                  />
                  <TextInput
                    className="flex-1 ml-3 text-gray-900 text-base"
                    placeholder="Re-enter your password"
                    placeholderTextColor="#9CA3AF"
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      if (confirmPasswordError) setConfirmPasswordError(null);
                    }}
                    secureTextEntry={!showConfirmPassword}
                    autoComplete="password-new"
                    onFocus={() => setFocusedInput('confirmPassword')}
                    onBlur={() => setFocusedInput(null)}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color="#9CA3AF"
                    />
                  </TouchableOpacity>
                </View>

                {confirmPassword.length === 0 ? (
                  <Text className="text-xs text-gray-500 mt-1.5 ml-1">Re-enter password to confirm.</Text>
                ) : passwordsMatch ? (
                  <View className="mt-1.5 ml-1 flex-row items-center">
                    <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                    <Text className="text-xs text-green-700 ml-1">Passwords match</Text>
                  </View>
                ) : (
                  <View className="mt-1.5 ml-1 flex-row items-center">
                    <Ionicons name="close-circle" size={14} color="#DC2626" />
                    <Text className="text-xs text-red-600 ml-1">Passwords do not match</Text>
                  </View>
                )}

                {confirmPasswordError ? (
                  <Text className="text-xs text-red-600 mt-1.5 ml-1">{confirmPasswordError}</Text>
                ) : null}
              </View>

              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-3">Access Code</Text>
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
                  canCreateAccount ? 'bg-primary-500' : 'bg-gray-300'
                }`}
                style={{ height: 52 }}
                onPress={handleSignUp}
                disabled={!canCreateAccount}
                activeOpacity={canCreateAccount ? 0.8 : 1}
              >
                {isLoading ? (
                  <SpinningFish size="small" />
                ) : (
                  <Text className="text-white font-bold text-lg">Create Account</Text>
                )}
              </TouchableOpacity>
            </View>

            <View className="flex-row justify-center mt-6">
              <Text className="text-gray-300 text-base">Already have an account? </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity>
                  <Text className="text-primary-500 font-bold text-base">Sign In</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
