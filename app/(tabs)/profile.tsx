import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { Location } from '@/types';

export default function ProfileScreen() {
  const { user, location, signOut, updateDefaultLocation, isLoading } =
    useAuthStore();
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    const { data } = await supabase
      .from('locations')
      .select('*')
      .eq('active', true)
      .order('name');

    if (data) {
      setLocations(data);
    }
  };

  const handleLocationChange = (selectedLocation: Location) => {
    Alert.alert(
      'Change Location',
      `Switch to ${selectedLocation.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            try {
              await updateDefaultLocation(selectedLocation.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to update location');
            }
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: signOut,
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['left', 'right']}>
      <ScrollView className="flex-1">
        {/* User Info Card */}
        <View className="bg-white m-4 p-6 rounded-card shadow-sm">
          <View className="items-center mb-4">
            <View className="w-20 h-20 bg-primary-100 rounded-full items-center justify-center mb-3">
              <Ionicons name="person" size={40} color="#F97316" />
            </View>
            <Text className="text-xl font-bold text-gray-900">
              {user?.name || 'User'}
            </Text>
            <Text className="text-gray-500">{user?.email}</Text>
            <View className="bg-primary-100 px-3 py-1 rounded-full mt-2">
              <Text className="text-primary-700 text-sm font-medium capitalize">
                {user?.role || 'Employee'}
              </Text>
            </View>
          </View>
        </View>

        {/* Current Location */}
        <View className="bg-white mx-4 p-4 rounded-card shadow-sm mb-4">
          <Text className="text-sm font-medium text-gray-500 mb-2">
            CURRENT LOCATION
          </Text>
          <View className="flex-row items-center">
            <Ionicons name="location" size={24} color="#F97316" />
            <Text className="text-lg font-semibold text-gray-900 ml-2">
              {location?.name || 'No location selected'}
            </Text>
          </View>
        </View>

        {/* Location Selector */}
        <View className="bg-white mx-4 rounded-card shadow-sm mb-4">
          <Text className="text-sm font-medium text-gray-500 px-4 pt-4 pb-2">
            SWITCH LOCATION
          </Text>
          {locations.map((loc, index) => (
            <TouchableOpacity
              key={loc.id}
              className={`flex-row items-center justify-between px-4 py-4 ${
                index < locations.length - 1 ? 'border-b border-gray-100' : ''
              }`}
              onPress={() => handleLocationChange(loc)}
            >
              <View className="flex-row items-center">
                <Ionicons
                  name={loc.id === location?.id ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={loc.id === location?.id ? '#F97316' : '#9CA3AF'}
                />
                <View className="ml-3">
                  <Text className="text-gray-900 font-medium">{loc.name}</Text>
                  <Text className="text-gray-500 text-sm">{loc.short_code}</Text>
                </View>
              </View>
              {loc.id === location?.id && (
                <View className="bg-primary-100 px-2 py-1 rounded">
                  <Text className="text-primary-700 text-xs font-medium">
                    Current
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign Out Button */}
        <TouchableOpacity
          className="bg-white mx-4 p-4 rounded-card shadow-sm mb-8 flex-row items-center justify-center"
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
