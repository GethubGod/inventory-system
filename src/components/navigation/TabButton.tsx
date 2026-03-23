import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { glassHairlineWidth } from '@/theme/design';

export interface TabButtonProps {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  size: number;
  focused: boolean;
}

/**
 * Custom tab button: renders a soft rounded bubble enclosing both
 * the icon and label when active, matching the Babytuna design system.
 */
export function TabButton({ name, label, color, size, focused }: TabButtonProps) {
  return (
    <View
      style={{
        width: 76,
        height: 50,
        borderRadius: 22,
        paddingTop: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(232, 80, 58, 0.10)' : 'transparent',
        borderWidth: focused ? glassHairlineWidth : 0,
        borderColor: focused ? 'rgba(232, 80, 58, 0.08)' : 'transparent',
      }}
    >
      <Ionicons name={name} size={size} color={color} />
      <Text
        style={{
          fontSize: 10,
          fontWeight: focused ? '600' : '500',
          color,
          marginTop: 3,
          letterSpacing: 0.1,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
