import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(232, 80, 58, 0.14)' : 'transparent',
      }}
    >
      <Ionicons name={name} size={size} color={color} />
      <Text
        style={{
          fontSize: 10,
          fontWeight: '600',
          color,
          marginTop: 2,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
