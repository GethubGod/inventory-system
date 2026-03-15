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
import { colors } from '@/constants';
import { useDisplayStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { GlassSurface } from '@/components/ui';
import { glassColors, glassHairlineWidth, glassRadii } from '@/design/tokens';

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
  const ds = useScaledStyles();

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
    <GlassSurface
      intensity="subtle"
      blurred={false}
      style={{
        marginHorizontal: ds.spacing(16),
        marginBottom: ds.spacing(16),
        borderRadius: glassRadii.surface,
      }}
    >
      {/* Header - always visible */}
      <TouchableOpacity
        onPress={toggle}
        className="flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(14), minHeight: Math.max(ds.rowH, 60) }}
        activeOpacity={0.7}
      >
        <View
          className="items-center justify-center"
          style={{
            width: Math.max(40, ds.icon(40)),
            height: Math.max(40, ds.icon(40)),
            borderRadius: ds.radius(12),
            marginRight: ds.spacing(14),
            backgroundColor: iconBgColor,
          }}
        >
          <Ionicons name={icon} size={ds.icon(22)} color={iconColor} />
        </View>
        <Text className="flex-1 font-semibold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>
          {title}
        </Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={ds.icon(20)}
          color={colors.gray[400]}
        />
      </TouchableOpacity>

      {/* Content - conditionally rendered */}
      {isExpanded && (
        <View
          style={{
            borderTopWidth: glassHairlineWidth,
            borderTopColor: glassColors.divider,
          }}
        >
          {children}
        </View>
      )}
    </GlassSurface>
  );
}
