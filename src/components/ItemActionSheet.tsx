import React from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/theme/design';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/design/tokens';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { BottomSheetShell } from './BottomSheetShell';
import { GlassSurface } from './ui/GlassSurface';

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
  const insets = useSafeAreaInsets();
  const hasActions = sections.some((section) => section.items.length > 0);

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(ds.spacing(10), insets.bottom + ds.spacing(8))}
    >
      <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(12) }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
            <Text
              style={{
                fontSize: ds.fontSize(20),
                fontWeight: '700',
                color: glassColors.textPrimary,
                letterSpacing: -0.3,
              }}
            >
              {title}
            </Text>
            {subtitle ? (
              <GlassSurface
                intensity="subtle"
                style={{
                  marginTop: ds.spacing(12),
                  borderRadius: glassRadii.surface,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(12),
                  }}
                >
                  <View
                    style={{
                      width: ds.icon(38),
                      height: ds.icon(38),
                      borderRadius: ds.icon(19),
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: glassColors.accentSoft,
                    }}
                  >
                    <Ionicons name="cube-outline" size={ds.icon(18)} color={glassColors.accent} />
                  </View>
                  <View style={{ flex: 1, marginLeft: ds.spacing(12) }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(11),
                        fontWeight: '700',
                        letterSpacing: 0.7,
                        textTransform: 'uppercase',
                        color: glassColors.textSecondary,
                      }}
                    >
                      Current Item
                    </Text>
                    <Text
                      style={{
                        marginTop: ds.spacing(4),
                        fontSize: ds.fontSize(14),
                        color: glassColors.textPrimary,
                        lineHeight: ds.fontSize(19),
                      }}
                    >
                      {subtitle}
                    </Text>
                  </View>
                </View>
              </GlassSurface>
            ) : null}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close actions"
            onPress={onClose}
            activeOpacity={0.8}
            style={{
              width: ds.icon(36),
              height: ds.icon(36),
              borderRadius: ds.icon(18),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: glassColors.mediumFill,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
            }}
          >
            <Ionicons name="close" size={ds.icon(18)} color={glassColors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ maxHeight: ds.spacing(432) }}
        contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(4) }}
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
                      fontSize: ds.fontSize(11),
                      marginBottom: ds.spacing(8),
                      marginLeft: ds.spacing(6),
                      fontWeight: '700',
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                      color: glassColors.textSecondary,
                    }}
                  >
                    {section.title}
                  </Text>
                ) : null}

                <GlassSurface
                  intensity="subtle"
                  style={{
                    borderRadius: glassRadii.surface,
                    overflow: 'hidden',
                  }}
                >
                  {visibleItems.map((item, itemIndex) => {
                    const disabled = item.disabled === true;
                    const iconBackground = item.destructive
                      ? glassColors.dangerSoft
                      : sectionIndex === 0
                        ? glassColors.accentSoft
                        : glassColors.mediumFill;
                    const iconColor = item.destructive
                      ? glassColors.dangerText
                      : sectionIndex === 0
                        ? glassColors.accent
                        : glassColors.textPrimary;
                    const labelColor = item.destructive ? glassColors.dangerText : glassColors.textPrimary;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        disabled={disabled}
                        onPress={item.onPress}
                        activeOpacity={0.78}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'flex-start',
                          minHeight: Math.max(64, ds.rowH),
                          paddingHorizontal: ds.spacing(16),
                          paddingVertical: ds.spacing(14),
                          opacity: disabled ? 0.45 : 1,
                          borderBottomWidth: itemIndex < visibleItems.length - 1 ? glassHairlineWidth : 0,
                          borderBottomColor: glassColors.divider,
                        }}
                      >
                        {item.icon ? (
                          <View
                            style={{
                              width: ds.icon(40),
                              height: ds.icon(40),
                              borderRadius: ds.icon(20),
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: iconBackground,
                              borderWidth: glassHairlineWidth,
                              borderColor: item.destructive
                                ? 'rgba(163, 45, 45, 0.12)'
                                : glassColors.cardBorder,
                            }}
                          >
                            <Ionicons name={item.icon as any} size={ds.icon(18)} color={iconColor} />
                          </View>
                        ) : (
                          <View style={{ width: ds.icon(40), height: ds.icon(40) }} />
                        )}
                        <View style={{ flex: 1, marginLeft: ds.spacing(12), paddingTop: ds.spacing(2) }}>
                          <Text
                            style={{
                              fontSize: ds.fontSize(15),
                              fontWeight: '600',
                              color: labelColor,
                            }}
                          >
                            {item.label}
                          </Text>
                          {item.detail ? (
                            <Text
                              style={{
                                fontSize: ds.fontSize(13),
                                marginTop: ds.spacing(4),
                                color: glassColors.textSecondary,
                                lineHeight: ds.fontSize(18),
                              }}
                            >
                              {item.detail}
                            </Text>
                          ) : null}
                        </View>

                        <View style={{ paddingTop: ds.spacing(8), marginLeft: ds.spacing(8) }}>
                          <Ionicons
                            name="chevron-forward"
                            size={ds.icon(16)}
                            color={glassColors.textSecondary}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </GlassSurface>
              </View>
            );
          })
        ) : (
          <GlassSurface
            intensity="subtle"
            style={{
              borderRadius: glassRadii.surface,
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
          </GlassSurface>
        )}

        {showCancelAction ? (
          <GlassSurface
            intensity="medium"
            style={{
              marginTop: ds.spacing(12),
              borderRadius: radii.submitButton,
            }}
          >
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              style={{
                minHeight: ds.buttonH,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: ds.spacing(16),
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: colors.textPrimary,
                  textAlign: 'center',
                }}
              >
                {cancelLabel}
              </Text>
            </TouchableOpacity>
          </GlassSurface>
        ) : null}
      </ScrollView>
    </BottomSheetShell>
  );
}
