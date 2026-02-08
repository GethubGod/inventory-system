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
import { useScaledStyles } from '@/hooks/useScaledStyles';

export default function ProfileScreen() {
  const ds = useScaledStyles();
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
        <View className="bg-white shadow-sm border border-gray-100" style={{ margin: ds.spacing(16), padding: ds.spacing(24), borderRadius: ds.radius(16) }}>
          <View className="items-center" style={{ marginBottom: ds.spacing(16) }}>
            <View className="bg-primary-100 rounded-full items-center justify-center" style={{ width: ds.icon(80), height: ds.icon(80), marginBottom: ds.spacing(12) }}>
              <Ionicons name="person" size={ds.icon(40)} color="#F97316" />
            </View>
            <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(20) }}>
              {user?.name || 'User'}
            </Text>
            <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>{user?.email}</Text>
            <View className="bg-primary-100 rounded-full" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(6), marginTop: ds.spacing(12) }}>
              <Text className="text-primary-700 font-semibold capitalize" style={{ fontSize: ds.fontSize(14) }}>
                {user?.role || 'Employee'}
              </Text>
            </View>
          </View>
        </View>

        {/* Current Location */}
        <View className="bg-white shadow-sm border border-gray-100" style={{ marginHorizontal: ds.spacing(16), padding: ds.spacing(16), borderRadius: ds.radius(16), marginBottom: ds.spacing(16) }}>
          <Text className="font-medium text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(12), marginBottom: ds.spacing(8) }}>
            Current Location
          </Text>
          <View className="flex-row items-center">
            <View className="bg-primary-100 rounded-full items-center justify-center" style={{ width: ds.icon(40), height: ds.icon(40) }}>
              <Ionicons name="location" size={ds.icon(20)} color="#F97316" />
            </View>
            <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18), marginLeft: ds.spacing(12) }}>
              {location?.name || 'No location selected'}
            </Text>
          </View>
        </View>

        {/* Location Selector */}
        <View className="bg-white shadow-sm border border-gray-100" style={{ marginHorizontal: ds.spacing(16), borderRadius: ds.radius(16), marginBottom: ds.spacing(16) }}>
          <Text className="font-medium text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(12), paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(16), paddingBottom: ds.spacing(8) }}>
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
          className="bg-white shadow-sm border border-gray-100 flex-row items-center justify-center"
          style={{ marginHorizontal: ds.spacing(16), padding: ds.spacing(16), borderRadius: ds.radius(16), marginBottom: ds.spacing(32), height: ds.buttonH + 4 }}
          onPress={handleSignOut}
          disabled={isLoading}
        >
          <Ionicons name="log-out-outline" size={ds.icon(20)} color="#EF4444" />
          <Text className="text-red-500 font-semibold" style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
