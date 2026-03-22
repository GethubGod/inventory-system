import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Modal, Pressable } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii } from '@/theme/design';

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
        style={{
          minHeight: Math.max(48, ds.rowH - ds.spacing(8)),
          paddingVertical: ds.spacing(12),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        activeOpacity={0.82}
      >
        <Text
          style={{
            fontSize: ds.fontSize(15),
            fontWeight: '600',
            color: glassColors.textPrimary,
          }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              marginRight: ds.spacing(8),
              color: glassColors.textPrimary,
              fontWeight: '600',
            }}
          >
            {formatDisplayTime(value)}
          </Text>
          <Ionicons
            name="time-outline"
            size={ds.icon(18)}
            color={glassColors.textSecondary}
          />
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
            style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' }}
            onPress={() => setShowPicker(false)}
          >
            <Pressable
              style={{
                backgroundColor: glassColors.background,
                borderTopLeftRadius: glassRadii.surface,
                borderTopRightRadius: glassRadii.surface,
              }}
              onPress={(e) => e.stopPropagation()}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: ds.spacing(16),
                  paddingVertical: ds.spacing(12),
                  borderBottomWidth: 1,
                  borderBottomColor: glassColors.divider,
                }}
              >
                <TouchableOpacity
                  onPress={() => setShowPicker(false)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(15),
                      color: glassColors.textSecondary,
                    }}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
                <Text
                  style={{
                    fontSize: ds.fontSize(18),
                    fontWeight: '700',
                    color: glassColors.textPrimary,
                  }}
                >
                  {title}
                </Text>
                <TouchableOpacity
                  onPress={handleIOSDone}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(15),
                      fontWeight: '700',
                      color: glassColors.accent,
                    }}
                  >
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
