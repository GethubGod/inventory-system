import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Keyboard,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { AuthLogoHeader, SpinningFish } from '@/components';
import { supabase } from '@/lib';

const SIGN_IN_PASSWORD_HELPER =
  'If you recently created your password, it should be at least 8 characters and include letters and numbers.';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [signInHelper, setSignInHelper] = useState<string | null>(null);
  const { signIn, isLoading } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    try {
      setSignInHelper(null);
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (error: any) {
      const message = error?.message || 'Invalid email or password';
      if (message.toLowerCase().includes('invalid login credentials')) {
        setSignInHelper(SIGN_IN_PASSWORD_HELPER);
      }
      Alert.alert('Sign In Failed', message);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Email Required', 'Enter your email first, then tap Forgot password.');
      return;
    }

    try {
      setIsResettingPassword(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;

      Alert.alert(
        'Password Reset Email Sent',
        'Check your inbox for reset instructions.'
      );
    } catch (error: any) {
      Alert.alert(
        'Reset Failed',
        error?.message || 'Unable to send reset email right now.'
      );
    } finally {
      setIsResettingPassword(false);
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
        <Pressable className="flex-1 px-6 pt-10 pb-8" onPress={Keyboard.dismiss}>
          <View className="items-center mb-6">
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
              Welcome Back
            </Text>

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

            <View className="mb-2">
              <Text className="text-sm font-medium text-gray-700 mb-2">Password</Text>
              <View className={getInputStyle('password')} style={{ height: 48 }}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={focusedInput === 'password' ? '#F97316' : '#9CA3AF'}
                />
                <TextInput
                  className="flex-1 ml-3 text-gray-900 text-base"
                  placeholder="Enter your password"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    if (signInHelper) setSignInHelper(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
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

            <View className="mb-5 items-end">
              <TouchableOpacity onPress={handleForgotPassword} disabled={isResettingPassword}>
                <Text className="text-xs font-medium text-primary-500">
                  {isResettingPassword ? 'Sending reset link...' : 'Forgot password?'}
                </Text>
              </TouchableOpacity>
            </View>

            {signInHelper ? (
              <View className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <Text className="text-xs text-amber-800">{signInHelper}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              className={`rounded-xl items-center justify-center ${
                isLoading ? 'bg-primary-300' : 'bg-primary-500'
              }`}
              style={{ height: 52 }}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <SpinningFish size="small" />
              ) : (
                <Text className="text-white font-bold text-lg">Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="flex-row justify-center mt-8">
            <Text className="text-gray-300 text-base">Don{"'"}t have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text className="text-primary-500 font-bold text-base">Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
