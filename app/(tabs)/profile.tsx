import { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { Location } from '@/types';

export default function ProfileScreen() {
  const { user, location, locations, setLocation, fetchLocations, signOut, isLoading } =
    useAuthStore();

  useEffect(() => {
    fetchLocations();
  }, []);

  const handleLocationChange = (selectedLocation: Location) => {
    setLocation(selectedLocation);
  };

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
              {user?.name || 'User'}
            </Text>
            <Text className="text-gray-500">{user?.email}</Text>
            <View className="bg-primary-100 px-4 py-1.5 rounded-full mt-3">
              <Text className="text-primary-700 font-semibold capitalize">
                {user?.role || 'Employee'}
              </Text>
            </View>
          </View>
        </View>

        {/* Current Location */}
        <View className="bg-white mx-4 p-4 rounded-2xl shadow-sm border border-gray-100 mb-4">
          <Text className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Current Location
          </Text>
          <View className="flex-row items-center">
            <View className="w-10 h-10 bg-primary-100 rounded-full items-center justify-center">
              <Ionicons name="location" size={20} color="#F97316" />
            </View>
            <Text className="text-lg font-bold text-gray-900 ml-3">
              {location?.name || 'No location selected'}
            </Text>
          </View>
        </View>

        {/* Location Selector */}
        <View className="bg-white mx-4 rounded-2xl shadow-sm border border-gray-100 mb-4">
          <Text className="text-xs font-medium text-gray-500 uppercase tracking-wide px-4 pt-4 pb-2">
            Switch Location
          </Text>
          {locations.map((loc, index) => {
            const isSelected = loc.id === location?.id;
            return (
              <TouchableOpacity
                key={loc.id}
                className={`flex-row items-center justify-between px-4 py-4 ${
                  index < locations.length - 1 ? 'border-b border-gray-100' : ''
                }`}
                onPress={() => handleLocationChange(loc)}
                activeOpacity={0.7}
              >
                <View className="flex-row items-center flex-1">
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center ${
                      isSelected ? 'bg-primary-500' : 'bg-gray-100'
                    }`}
                  >
                    <Ionicons
                      name="restaurant"
                      size={20}
                      color={isSelected ? 'white' : '#6B7280'}
                    />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text
                      className={`font-semibold ${
                        isSelected ? 'text-primary-700' : 'text-gray-900'
                      }`}
                    >
                      {loc.name}
                    </Text>
                    <Text
                      className={`text-sm ${
                        isSelected ? 'text-primary-600' : 'text-gray-500'
                      }`}
                    >
                      {loc.short_code}
                    </Text>
                  </View>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={24} color="#F97316" />
                )}
              </TouchableOpacity>
            );
          })}
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
