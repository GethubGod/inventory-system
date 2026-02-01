import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { colors } from '@/constants';

interface LocationQuantity {
  name: string;
  shortCode: string;
  quantity: number;
}

export default function ExportFishOrderScreen() {
  const params = useLocalSearchParams<{
    fishItemId: string;
    fishItemName: string;
    fishItemQuantity: string;
    fishItemUnit: string;
    fishItemLocations: string;
  }>();

  // Parse params
  const itemName = params.fishItemName || 'Fish Item';
  const itemUnit = params.fishItemUnit || 'case';
  const initialLocations: LocationQuantity[] = params.fishItemLocations
    ? JSON.parse(params.fishItemLocations)
    : [];

  // Editable state
  const [locationQuantities, setLocationQuantities] = useState<LocationQuantity[]>(
    initialLocations.map((loc) => ({ ...loc }))
  );

  // Calculate total
  const totalQuantity = useMemo(() => {
    return locationQuantities.reduce((sum, loc) => sum + loc.quantity, 0);
  }, [locationQuantities]);

  // Update quantity for a location
  const updateQuantity = useCallback((index: number, newQuantity: number) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setLocationQuantities((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], quantity: Math.max(0, newQuantity) };
      return updated;
    });
  }, []);

  // Generate message text
  const messageText = useMemo(() => {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    let message = `Hi, I'd like to place an order:\n\n`;
    message += `FISH ORDER - Babytuna\n`;
    message += `Date: ${today}\n\n`;

    // Location breakdown
    locationQuantities.forEach((loc) => {
      if (loc.quantity > 0) {
        message += `${loc.name}:\n`;
        message += `- ${itemName}: ${loc.quantity} ${itemUnit}\n\n`;
      }
    });

    // Total
    message += `TOTAL: ${totalQuantity} ${itemUnit}\n\n`;
    message += `Please confirm availability.\nThank you!`;

    return message;
  }, [locationQuantities, itemName, itemUnit, totalQuantity]);

  // Handle copy to clipboard
  const handleCopyToClipboard = useCallback(async () => {
    await Clipboard.setStringAsync(messageText);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert('Copied!', 'Order copied to clipboard');
  }, [messageText]);

  // Handle share
  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      const result = await Share.share({
        message: messageText,
        title: 'Fish Order',
      });

      if (result.action === Share.sharedAction) {
        Alert.alert('Shared!', 'Order has been shared');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to share');
    }
  }, [messageText]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Confirm Order',
          headerBackTitle: 'Back',
          headerTintColor: '#F97316',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { color: '#111827', fontWeight: '600' },
        }}
      />
      <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          {/* Item Header */}
          <View
            className="bg-white rounded-2xl p-4 mb-4 border border-gray-200"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <View className="flex-row items-center mb-2">
              <Text className="text-2xl mr-2">🐟</Text>
              <Text className="text-xl font-bold text-gray-900 flex-1">
                {itemName}
              </Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-gray-500">Total Order</Text>
              <Text className="text-2xl font-bold text-primary-600">
                {totalQuantity} {itemUnit}
              </Text>
            </View>
          </View>

          {/* Editable Quantities */}
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">
            Adjust Quantities by Location
          </Text>

          {locationQuantities.map((loc, index) => (
            <View
              key={index}
              className="bg-white rounded-xl p-4 mb-3 border border-gray-200 flex-row items-center"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 4,
                elevation: 2,
              }}
            >
              {/* Location Info */}
              <View className="flex-1">
                <Text className="font-semibold text-gray-900">{loc.name}</Text>
                <Text className="text-sm text-gray-500">{loc.shortCode}</Text>
              </View>

              {/* Quantity Controls */}
              <View className="flex-row items-center">
                <TouchableOpacity
                  className="w-10 h-10 bg-gray-100 rounded-l-xl items-center justify-center"
                  onPress={() => updateQuantity(index, loc.quantity - 1)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="remove" size={20} color={colors.gray[600]} />
                </TouchableOpacity>

                <TextInput
                  className="w-16 h-10 bg-gray-50 text-center text-lg font-bold text-gray-900"
                  value={loc.quantity.toString()}
                  onChangeText={(text) => {
                    const num = parseInt(text, 10);
                    if (!isNaN(num)) {
                      updateQuantity(index, num);
                    }
                  }}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />

                <TouchableOpacity
                  className="w-10 h-10 bg-gray-100 rounded-r-xl items-center justify-center"
                  onPress={() => updateQuantity(index, loc.quantity + 1)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={20} color={colors.gray[600]} />
                </TouchableOpacity>
              </View>

              {/* Unit Label */}
              <Text className="text-sm text-gray-500 ml-2 w-12">{itemUnit}</Text>
            </View>
          ))}

          {/* Message Preview */}
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-3 px-1">
            Message Preview
          </Text>

          <View
            className="bg-white rounded-xl p-4 border border-gray-200"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <Text className="text-gray-700 text-sm leading-6 font-mono">
              {messageText}
            </Text>
          </View>
        </ScrollView>

        {/* Bottom Action Buttons */}
        <View className="bg-white border-t border-gray-200 px-4 py-4">
          <View className="flex-row space-x-3">
            {/* Copy to Clipboard */}
            <TouchableOpacity
              className="flex-1 bg-gray-100 rounded-xl py-4 flex-row items-center justify-center"
              onPress={handleCopyToClipboard}
              activeOpacity={0.8}
            >
              <Ionicons name="copy-outline" size={20} color={colors.gray[700]} />
              <Text className="text-gray-700 font-semibold ml-2">Copy</Text>
            </TouchableOpacity>

            {/* Share */}
            <TouchableOpacity
              className="flex-1 bg-primary-500 rounded-xl py-4 flex-row items-center justify-center"
              onPress={handleShare}
              activeOpacity={0.8}
            >
              <Ionicons name="share-outline" size={20} color="white" />
              <Text className="text-white font-semibold ml-2">Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
