import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Modal, Pressable } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useDisplayStore } from '@/store';

interface TimePickerRowProps {
  title: string;
  value: string; // "HH:MM" format
  onTimeChange: (time: string) => void;
  disabled?: boolean;
}

export function TimePickerRow({
  title,
  value,
  onTimeChange,
  disabled = false,
}: TimePickerRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const { hapticFeedback } = useDisplayStore();

  // Parse "HH:MM" string to Date
  const parseTime = (timeString: string): Date => {
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  // Format Date to "HH:MM" string
  const formatTime = (date: Date): string => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Format for display (12-hour with AM/PM)
  const formatDisplayTime = (timeString: string): string => {
    const [hours, minutes] = timeString.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const handlePress = () => {
    if (disabled) return;
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setShowPicker(true);
  };

  const handleChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      onTimeChange(formatTime(selectedDate));
    }
  };

  const handleIOSDone = () => {
    setShowPicker(false);
  };

  return (
    <View className={disabled ? 'opacity-50' : ''}>
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled}
        className="flex-row items-center justify-between py-3"
        activeOpacity={0.7}
      >
        <Text className="text-base text-gray-700">{title}</Text>
        <View className="flex-row items-center">
          <Text className="text-base text-gray-900 font-medium mr-2">
            {formatDisplayTime(value)}
          </Text>
          <Ionicons name="time-outline" size={18} color={colors.gray[400]} />
        </View>
      </TouchableOpacity>

      {/* iOS Modal Picker */}
      {Platform.OS === 'ios' && showPicker && (
        <Modal
          visible={showPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowPicker(false)}
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setShowPicker(false)}
          >
            <Pressable
              className="bg-white rounded-t-3xl"
              onPress={(e) => e.stopPropagation()}
            >
              <View className="flex-row justify-between items-center px-4 py-3 border-b border-gray-100">
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text className="text-gray-500 text-base">Cancel</Text>
                </TouchableOpacity>
                <Text className="text-lg font-semibold text-gray-900">
                  {title}
                </Text>
                <TouchableOpacity onPress={handleIOSDone}>
                  <Text className="text-primary-500 text-base font-semibold">
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={parseTime(value)}
                mode="time"
                display="spinner"
                onChange={handleChange}
                style={{ height: 200 }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Android Inline Picker */}
      {Platform.OS === 'android' && showPicker && (
        <DateTimePicker
          value={parseTime(value)}
          mode="time"
          display="default"
          onChange={handleChange}
        />
      )}
    </View>
  );
}
