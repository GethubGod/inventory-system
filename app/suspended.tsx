import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { colors } from '@/constants';

export default function SuspendedScreen() {
  const { session, signOut, isLoading } = useAuthStore();

  if (!session && !isLoading) {
    return <Redirect href="/(auth)/login" />;
  }

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
      <View className="flex-1 items-center justify-center px-8">
        <View className="w-16 h-16 rounded-full items-center justify-center mb-5" style={{ backgroundColor: colors.errorBg }}>
          <Ionicons name="ban-outline" size={30} color={colors.error} />
        </View>
        <Text className="text-2xl font-bold text-gray-900 text-center">Account Suspended</Text>
        <Text className="text-base text-gray-600 text-center mt-3">
          Your account has been suspended. Contact your manager.
        </Text>
        <TouchableOpacity
          className="mt-8 rounded-xl px-6 py-3.5"
          style={{ backgroundColor: colors.text }}
          onPress={handleSignOut}
        >
          <Text className="text-white font-semibold">Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
