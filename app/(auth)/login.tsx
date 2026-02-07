import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { AuthLogoHeader, SpinningFish } from '@/components';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [oauthLoadingProvider, setOauthLoadingProvider] = useState<'google' | 'apple' | null>(null);
  const { signIn, signInWithOAuth, isLoading } = useAuthStore();

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
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Sign In Failed', error.message || 'Invalid email or password');
    }
  };

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    setOauthLoadingProvider(provider);
    try {
      await signInWithOAuth(provider);
      router.replace('/');
    } catch (error: any) {
      const message = error?.message || 'OAuth failed. Please try again.';
      if (message.toLowerCase().includes('cancel')) {
        Alert.alert('Sign In Cancelled', 'OAuth sign-in was cancelled.');
        return;
      }
      if (message.toLowerCase().includes('missing session')) {
        Alert.alert('Sign In Failed', 'Missing session after redirect. Please try again.');
        return;
      }
      Alert.alert('Sign In Failed', message);
    } finally {
      setOauthLoadingProvider(null);
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
        <View className="flex-1 px-6 pt-10 pb-8">
          {/* Logo */}
          <View className="items-center mb-6">
            <AuthLogoHeader size={128} />
          </View>

          {/* Login Form Card */}
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

            {/* OAuth Buttons */}
            <View className="mb-5">
              <TouchableOpacity
                className="h-12 rounded-xl border border-gray-200 bg-white flex-row items-center justify-center"
                onPress={() => handleOAuthSignIn('google')}
                disabled={isLoading || oauthLoadingProvider !== null}
                activeOpacity={0.8}
              >
                <Ionicons name="logo-google" size={18} color="#111827" />
                <Text className="ml-2 text-gray-900 font-semibold text-base">
                  {oauthLoadingProvider === 'google' ? 'Connecting...' : 'Continue with Google'}
                </Text>
              </TouchableOpacity>

              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  className="h-12 mt-3 rounded-xl border border-gray-200 bg-white flex-row items-center justify-center"
                  onPress={() => handleOAuthSignIn('apple')}
                  disabled={isLoading || oauthLoadingProvider !== null}
                  activeOpacity={0.8}
                >
                  <Ionicons name="logo-apple" size={20} color="#111827" />
                  <Text className="ml-2 text-gray-900 font-semibold text-base">
                    {oauthLoadingProvider === 'apple' ? 'Connecting...' : 'Continue with Apple'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View className="flex-row items-center mb-5">
              <View className="flex-1 h-px bg-gray-200" />
              <Text className="mx-3 text-xs text-gray-400 font-medium">OR</Text>
              <View className="flex-1 h-px bg-gray-200" />
            </View>

            {/* Email Input */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">
                Email
              </Text>
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

            {/* Password Input */}
            <View className="mb-6">
              <Text className="text-sm font-medium text-gray-700 mb-2">
                Password
              </Text>
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
                  onChangeText={setPassword}
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

            {/* Sign In Button */}
            <TouchableOpacity
                className={`rounded-xl items-center justify-center ${
                  isLoading ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                style={{ height: 52 }}
                onPress={handleLogin}
                disabled={isLoading || oauthLoadingProvider !== null}
                activeOpacity={0.8}
              >
              {isLoading ? (
                <SpinningFish size="small" />
              ) : (
                <Text className="text-white font-bold text-lg">Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Sign Up Link */}
          <View className="flex-row justify-center mt-8">
            <Text className="text-gray-300 text-base">
              Don't have an account?{' '}
            </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text className="text-primary-500 font-bold text-base">
                  Sign Up
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
