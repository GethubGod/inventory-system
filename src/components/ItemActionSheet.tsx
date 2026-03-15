import React from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, hairline, radii } from '@/theme/design';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { BottomSheetShell } from './BottomSheetShell';

export interface ItemActionSheetItem {
  id: string;
  label: string;
  icon?: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  detail?: string;
}

export interface ItemActionSheetSection {
  id: string;
  title?: string;
  items: ItemActionSheetItem[];
}

interface ItemActionSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  sections: ItemActionSheetSection[];
  onClose: () => void;
  cancelLabel?: string;
  showCancelAction?: boolean;
}

export function ItemActionSheet({
  visible,
  title,
  subtitle,
  sections,
  onClose,
  cancelLabel = 'Cancel',
  showCancelAction = true,
}: ItemActionSheetProps) {
  const ds = useScaledStyles();
  const hasActions = sections.some((section) => section.items.length > 0);

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(10) }}>
        <Text
          style={{
            fontSize: ds.fontSize(18),
            fontWeight: '700',
            color: colors.textPrimary,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              fontSize: ds.fontSize(13),
              marginTop: ds.spacing(4),
              color: colors.textSecondary,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={{ maxHeight: ds.spacing(420) }}
        contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(6) }}
        showsVerticalScrollIndicator={false}
      >
        {hasActions ? (
          sections.map((section, sectionIndex) => {
            const visibleItems = section.items.filter((item) => Boolean(item));
            if (visibleItems.length === 0) return null;

            return (
              <View key={section.id} style={sectionIndex > 0 ? { marginTop: ds.spacing(16) } : undefined}>
                {section.title ? (
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      marginBottom: ds.spacing(6),
                      marginLeft: ds.spacing(6),
                      fontWeight: '600',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      color: colors.textSecondary,
                    }}
                  >
                    {section.title}
                  </Text>
                ) : null}

                <View
                  style={{
                    borderRadius: radii.button,
                    borderWidth: hairline,
                    borderColor: colors.glassBorder,
                    backgroundColor: colors.white,
                    overflow: 'hidden',
                  }}
                >
                  {visibleItems.map((item, itemIndex) => {
                    const disabled = item.disabled === true;
                    const labelColor = item.destructive ? colors.primary : colors.textPrimary;
                    const iconColor = item.destructive ? colors.primary : colors.textSecondary;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        disabled={disabled}
                        onPress={item.onPress}
                        activeOpacity={0.7}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          minHeight: Math.max(56, ds.rowH),
                          paddingHorizontal: ds.spacing(16),
                          paddingVertical: ds.spacing(10),
                          opacity: disabled ? 0.45 : 1,
                          borderBottomWidth: itemIndex < visibleItems.length - 1 ? hairline : 0,
                          borderBottomColor: colors.divider,
                        }}
                      >
                        {item.icon ? (
                          <View style={{ width: ds.icon(28), alignItems: 'center' }}>
                            <Ionicons name={item.icon as any} size={ds.icon(22)} color={iconColor} />
                          </View>
                        ) : (
                          <View style={{ width: ds.icon(28) }} />
                        )}
                        <View style={{ flex: 1, marginLeft: ds.spacing(12) }}>
                          <Text
                            style={{
                              fontSize: ds.fontSize(16),
                              fontWeight: '500',
                              color: labelColor,
                            }}
                          >
                            {item.label}
                          </Text>
                          {item.detail ? (
                            <Text
                              style={{
                                fontSize: ds.fontSize(13),
                                marginTop: ds.spacing(2),
                                color: colors.textSecondary,
                              }}
                            >
                              {item.detail}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })
        ) : (
          <View
            style={{
              borderRadius: radii.button,
              borderWidth: hairline,
              borderColor: colors.glassBorder,
              backgroundColor: colors.background,
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(24),
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                color: colors.textSecondary,
                textAlign: 'center',
              }}
            >
              No actions available.
            </Text>
          </View>
        )}

        {showCancelAction ? (
          <TouchableOpacity
            onPress={onClose}
            style={{ paddingVertical: ds.spacing(16), marginTop: ds.spacing(4) }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color: colors.textSecondary,
                textAlign: 'center',
              }}
            >
              {cancelLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </BottomSheetShell>
  );
}
