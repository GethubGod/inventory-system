import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, shadow } from '@/constants';
import { useDisplayStore } from '@/store';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ExpandableSectionProps {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBgColor: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function ExpandableSection({
  title,
  icon,
  iconColor,
  iconBgColor,
  children,
  defaultExpanded = false,
}: ExpandableSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const { reduceMotion, hapticFeedback } = useDisplayStore();

  const toggle = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (!reduceMotion) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <View
      className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
      style={shadow.md}
    >
      {/* Header - always visible */}
      <TouchableOpacity
        onPress={toggle}
        className="flex-row items-center px-4 py-4"
        activeOpacity={0.7}
      >
        <View
          className="w-10 h-10 rounded-xl items-center justify-center mr-4"
          style={{ backgroundColor: iconBgColor }}
        >
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        <Text className="flex-1 text-lg font-semibold text-gray-900">
          {title}
        </Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.gray[400]}
        />
      </TouchableOpacity>

      {/* Content - conditionally rendered */}
      {isExpanded && (
        <View className="border-t border-gray-100">{children}</View>
      )}
    </View>
  );
}
