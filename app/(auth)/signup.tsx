import { useState } from 'react';
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
import { UserRole } from '@/types';
import { AuthLogoHeader, SpinningFish } from '@/components';

export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const { signUp, isLoading } = useAuthStore();

  const handleSignUp = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter a password');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    if (!selectedRole) {
      Alert.alert('Error', 'Please select your role');
      return;
    }

    try {
      const user = await signUp(
        email.trim(),
        password,
        name.trim(),
        selectedRole
      );

      // Route based on role
      if (user.role === 'manager') {
        router.replace('/(manager)');
      } else {
        router.replace('/(tabs)');
      }
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

  const RoleCard = ({
    role,
    icon,
    title,
    description,
  }: {
    role: UserRole;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
  }) => {
    const isSelected = selectedRole === role;
    return (
      <TouchableOpacity
        className={`flex-1 p-4 rounded-2xl border-2 ${
          isSelected
            ? 'border-primary-500 bg-primary-50'
            : 'border-gray-200 bg-white'
        }`}
        onPress={() => setSelectedRole(role)}
        activeOpacity={0.7}
      >
        <View className="items-center">
          <View
            className={`w-12 h-12 rounded-full items-center justify-center mb-2 ${
              isSelected ? 'bg-primary-500' : 'bg-gray-100'
            }`}
          >
            <Ionicons
              name={icon}
              size={24}
              color={isSelected ? 'white' : '#6B7280'}
            />
          </View>
          <Text
            className={`font-bold text-base ${
              isSelected ? 'text-primary-700' : 'text-gray-900'
            }`}
          >
            {title}
          </Text>
          <Text
            className={`text-xs mt-1 text-center ${
              isSelected ? 'text-primary-600' : 'text-gray-500'
            }`}
          >
            {description}
          </Text>
          {isSelected && (
            <View className="absolute top-2 right-2">
              <Ionicons name="checkmark-circle" size={20} color="#F97316" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
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
            {/* Logo */}
            <View className="items-center pt-2 mb-6">
              <AuthLogoHeader size={128} />
            </View>

            {/* Sign Up Form Card */}
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

              {/* Name Input */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Full Name
                </Text>
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
              <View className="mb-5">
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
                    placeholder="Create a password"
                    placeholderTextColor="#9CA3AF"
                    value={password}
                    onChangeText={setPassword}
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
                <Text className="text-xs text-gray-400 mt-1.5 ml-1">
                  Must be at least 6 characters
                </Text>
              </View>

              {/* Role Selection */}
              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-3">
                  Select Your Role
                </Text>
                <View className="flex-row gap-3">
                  <RoleCard
                    role="employee"
                    icon="person-outline"
                    title="Employee"
                    description="Submit orders"
                  />
                  <RoleCard
                    role="manager"
                    icon="briefcase-outline"
                    title="Manager"
                    description="Fulfill orders"
                  />
                </View>
              </View>

              {/* Create Account Button */}
              <TouchableOpacity
                className={`rounded-xl items-center justify-center ${
                  isLoading ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                style={{ height: 52 }}
                onPress={handleSignUp}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <SpinningFish size="small" />
                ) : (
                  <Text className="text-white font-bold text-lg">
                    Create Account
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Sign In Link */}
            <View className="flex-row justify-center mt-6">
              <Text className="text-gray-300 text-base">
                Already have an account?{' '}
              </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity>
                  <Text className="text-primary-500 font-bold text-base">
                    Sign In
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
