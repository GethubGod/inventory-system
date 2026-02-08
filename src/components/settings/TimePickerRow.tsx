import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Modal, Pressable } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useDisplayStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';

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
  const ds = useScaledStyles();

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
        className="flex-row items-center justify-between"
        style={{ minHeight: Math.max(44, ds.rowH - ds.spacing(12)), paddingVertical: ds.spacing(10) }}
        activeOpacity={0.7}
      >
        <Text className="text-gray-700" style={{ fontSize: ds.fontSize(16) }}>{title}</Text>
        <View className="flex-row items-center">
          <Text className="text-gray-900 font-medium" style={{ fontSize: ds.fontSize(16), marginRight: ds.spacing(8) }}>
            {formatDisplayTime(value)}
          </Text>
          <Ionicons name="time-outline" size={ds.icon(18)} color={colors.gray[400]} />
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
              <View
                className="flex-row justify-between items-center border-b border-gray-100"
                style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
              >
                <TouchableOpacity onPress={() => setShowPicker(false)} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text className="text-gray-500" style={{ fontSize: ds.fontSize(16) }}>Cancel</Text>
                </TouchableOpacity>
                <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>
                  {title}
                </Text>
                <TouchableOpacity onPress={handleIOSDone} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text className="text-primary-500 font-semibold" style={{ fontSize: ds.fontSize(16) }}>
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={parseTime(value)}
                mode="time"
                display="spinner"
                onChange={handleChange}
                style={{ height: Math.max(200, ds.spacing(200)) }}
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
