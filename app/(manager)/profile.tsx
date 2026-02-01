import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { Location } from '@/types';

export default function ManagerProfileScreen() {
  const { user, locations, signOut, isLoading } = useAuthStore();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['left', 'right']}>
      <ScrollView className="flex-1">
        {/* User Info Card */}
        <View className="bg-white m-4 p-6 rounded-2xl shadow-sm border border-gray-100">
          <View className="items-center mb-4">
            <View className="w-20 h-20 bg-primary-100 rounded-full items-center justify-center mb-3">
              <Ionicons name="person" size={40} color="#F97316" />
            </View>
            <Text className="text-xl font-bold text-gray-900">
              {user?.name || 'Manager'}
            </Text>
            <Text className="text-gray-500">{user?.email}</Text>
            <View className="bg-purple-100 px-4 py-1.5 rounded-full mt-3">
              <Text className="text-purple-700 font-semibold capitalize">
                {user?.role || 'Manager'}
              </Text>
            </View>
          </View>
        </View>

        {/* Locations Overview */}
        <View className="bg-white mx-4 rounded-2xl shadow-sm border border-gray-100 mb-4">
          <Text className="text-sm font-medium text-gray-500 px-4 pt-4 pb-2">
            MANAGED LOCATIONS
          </Text>
          {locations.map((loc, index) => (
            <View
              key={loc.id}
              className={`flex-row items-center px-4 py-4 ${
                index < locations.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <View className="w-10 h-10 bg-primary-50 rounded-full items-center justify-center">
                <Ionicons name="location" size={20} color="#F97316" />
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

        {/* Quick Stats */}
        <View className="bg-white mx-4 rounded-2xl shadow-sm border border-gray-100 mb-4 p-4">
          <Text className="text-sm font-medium text-gray-500 mb-3">
            ACCOUNT INFO
          </Text>
          <View className="flex-row items-center py-2">
            <Ionicons name="mail-outline" size={20} color="#6B7280" />
            <Text className="text-gray-700 ml-3">{user?.email}</Text>
          </View>
          <View className="flex-row items-center py-2">
            <Ionicons name="calendar-outline" size={20} color="#6B7280" />
            <Text className="text-gray-700 ml-3">
              Joined{' '}
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric',
                  })
                : 'Recently'}
            </Text>
          </View>
        </View>

        {/* Sign Out Button */}
        <TouchableOpacity
          className="bg-white mx-4 p-4 rounded-2xl shadow-sm border border-gray-100 mb-8 flex-row items-center justify-center"
          onPress={handleSignOut}
          disabled={isLoading}
        >
          <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          <Text className="text-red-500 font-semibold ml-2">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
