import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSettingsStore, useDisplayStore } from '@/store';
import { DEFAULT_EXPORT_FORMAT_SETTINGS } from '@/types/settings';
import { colors } from '@/constants';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useSettingsBackRoute } from '@/hooks/useSettingsBackRoute';

export default function ExportFormatSettingsScreen() {
  const { exportFormat, setExportFormat } = useSettingsStore();
  const { hapticFeedback } = useDisplayStore();
  const settingsBackRoute = useSettingsBackRoute();
  const [template, setTemplate] = useState(exportFormat.template);

  const handleSave = () => {
    setExportFormat({ template });
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    router.replace(settingsBackRoute);
  };

  const handleReset = () => {
    Alert.alert(
      'Reset Format',
      'Reset the message template to the default format?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => setTemplate(DEFAULT_EXPORT_FORMAT_SETTINGS.template),
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.replace(settingsBackRoute)}
            className="p-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-gray-900">Export Format</Text>
          <TouchableOpacity onPress={handleReset} className="p-2">
            <Text className="text-sm text-red-500 font-medium">Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <Text className="text-sm text-gray-600 mb-3">
            Edit the template used when sending supplier orders. Use the placeholders below.
          </Text>

          <View className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
            <Text className="text-xs text-gray-500 uppercase tracking-wide mb-2">Template</Text>
            <TextInput
              className="text-sm text-gray-900"
              value={template}
              onChangeText={setTemplate}
              multiline
              numberOfLines={12}
              textAlignVertical="top"
              style={{ minHeight: 240 }}
            />
          </View>

          <View className="bg-gray-100 rounded-2xl p-4">
            <Text className="text-xs text-gray-500 uppercase tracking-wide mb-2">Placeholders</Text>
            <Text className="text-sm text-gray-700">{'{{supplier}} - Supplier name'}</Text>
            <Text className="text-sm text-gray-700">{'{{date}} - Current date'}</Text>
            <Text className="text-sm text-gray-700">{'{{items}} - Item list'}</Text>
          </View>
        </ScrollView>

        <View className="bg-white border-t border-gray-200 px-4 py-4">
          <TouchableOpacity
            onPress={handleSave}
            className="bg-primary-500 rounded-xl py-4 items-center flex-row justify-center"
          >
            <Ionicons name="save-outline" size={18} color="white" />
            <Text className="text-white font-semibold ml-2">Save Format</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
