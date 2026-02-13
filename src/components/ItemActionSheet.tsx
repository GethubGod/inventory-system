import React from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
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
        <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900">
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }} className="text-gray-500">
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
              <View key={section.id} className={sectionIndex > 0 ? 'mt-4' : ''}>
                {section.title ? (
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      marginBottom: ds.spacing(6),
                      marginLeft: ds.spacing(6),
                    }}
                    className="font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {section.title}
                  </Text>
                ) : null}

                <View className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  {visibleItems.map((item, itemIndex) => {
                    const disabled = item.disabled === true;
                    const labelColor = item.destructive ? colors.error : colors.gray[800];
                    const iconColor = item.destructive ? colors.error : colors.gray[600];
                    const rowBorder = itemIndex < visibleItems.length - 1 ? 'border-b border-gray-100' : '';

                    return (
                      <TouchableOpacity
                        key={item.id}
                        disabled={disabled}
                        onPress={item.onPress}
                        activeOpacity={0.7}
                        className={`flex-row items-center ${rowBorder} ${disabled ? 'opacity-45' : ''}`}
                        style={{ minHeight: Math.max(56, ds.rowH), paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(8) }}
                      >
                        {item.icon ? (
                          <View style={{ width: ds.icon(24), alignItems: 'center' }}>
                            <Ionicons name={item.icon as any} size={ds.icon(19)} color={iconColor} />
                          </View>
                        ) : (
                          <View style={{ width: ds.icon(24) }} />
                        )}
                        <View className="ml-3 flex-1">
                          <Text style={{ fontSize: ds.fontSize(16), color: labelColor }} className="font-medium">
                            {item.label}
                          </Text>
                          {item.detail ? (
                            <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2) }} className="text-gray-500">
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
          <View className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 items-center">
            <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 text-center">
              No actions available.
            </Text>
          </View>
        )}

        {showCancelAction ? (
          <TouchableOpacity onPress={onClose} className="py-4" style={{ marginTop: ds.spacing(4) }}>
            <Text style={{ fontSize: ds.fontSize(14) }} className="font-semibold text-gray-500 text-center">
              {cancelLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </BottomSheetShell>
  );
}
