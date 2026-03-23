import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
} from '@/theme/design';
import { FulfillmentExpandedSupplierItems } from './FulfillmentExpandedSupplierItems';

const AVATAR_PALETTE = [
  { background: '#F7E1D7', text: '#B05534' },
  { background: '#E6EEF6', text: '#446A86' },
  { background: '#EEE3F5', text: '#795096' },
  { background: '#E6F1E6', text: '#4A7A58' },
] as const;

export interface FulfillmentSupplierEmployee {
  id: string;
  name: string;
  initials: string;
  count: number;
}

export interface FulfillmentSupplierPreviewItem {
  id: string;
  name: string;
  quantityLabel: string;
  summaryLabel: string | null;
  badgeLabel: string | null;
  badgeOverflowCount: number;
  badgeToneIndex: number;
  isRemaining: boolean;
  onPress?: (() => void) | null;
}

interface FulfillmentSupplierCardProps {
  name: string;
  statusLabel?: string | null;
  employees: FulfillmentSupplierEmployee[];
  employeeSummary: string;
  summaryStats: string;
  items: FulfillmentSupplierPreviewItem[];
  isExpanded: boolean;
  orderLabel: string;
  onToggle: () => void;
  onOrderPress: () => void;
}

function AvatarStack({ employees }: { employees: FulfillmentSupplierEmployee[] }) {
  const ds = useScaledStyles();

  if (employees.length === 0) return null;

  const visibleEmployees = employees.slice(0, 3);

  return (
    <View style={{ flexDirection: 'row', marginRight: 10 }}>
      {visibleEmployees.map((employee, index) => {
        const palette = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
        return (
          <View
            key={employee.id}
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: palette.background,
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: index === 0 ? 0 : -5,
              zIndex: visibleEmployees.length - index,
            }}
          >
            <Text style={{ color: palette.text, fontSize: ds.fontSize(8), fontWeight: '700' }}>
              {employee.initials}
            </Text>
          </View>
        );
      })}

      {employees.length > 3 ? (
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: '#F2ECE4',
            borderWidth: 1.5,
            borderColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: -5,
          }}
        >
          <Text style={{ color: '#7B6B5D', fontSize: ds.fontSize(8), fontWeight: '700' }}>
            +{employees.length - 3}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function FulfillmentSupplierCard({
  name,
  statusLabel,
  employees,
  employeeSummary,
  summaryStats,
  items,
  isExpanded,
  orderLabel,
  onToggle,
  onOrderPress,
}: FulfillmentSupplierCardProps) {
  const ds = useScaledStyles();
  const chevronProgress = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;
  const contentProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(chevronProgress, {
      toValue: isExpanded ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chevronProgress, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    contentProgress.setValue(0);
    Animated.timing(contentProgress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [contentProgress, isExpanded]);

  const chevronStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: chevronProgress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '180deg'],
          }),
        },
      ],
    }),
    [chevronProgress]
  );

  const contentStyle = useMemo(
    () => ({
      opacity: contentProgress,
      transform: [
        {
          translateY: contentProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [6, 0],
          }),
        },
      ],
    }),
    [contentProgress]
  );

  return (
    <View
      style={{
        backgroundColor: '#FBFAF8',
        borderRadius: 22,
        borderWidth: glassHairlineWidth,
        borderColor: '#DEDAD4',
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => ({
          opacity: pressed ? 0.94 : 1,
          paddingHorizontal: ds.spacing(16),
          paddingTop: ds.spacing(16),
          paddingBottom: isExpanded ? ds.spacing(10) : ds.spacing(14),
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Animated.View
                style={[
                  {
                    width: 16,
                    marginRight: ds.spacing(10),
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  chevronStyle,
                ]}
              >
                <Ionicons
                  name="chevron-down"
                  size={13}
                  color="#9A9188"
                />
              </Animated.View>

              <Text
                numberOfLines={1}
                style={{
                  color: glassColors.textPrimary,
                  fontSize: ds.fontSize(17),
                  fontWeight: '700',
                  flexShrink: 1,
                }}
              >
                {name}
              </Text>
              {statusLabel ? (
                <View
                  style={{
                    marginLeft: ds.spacing(8),
                    paddingHorizontal: ds.spacing(8),
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: glassColors.warningSoft,
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.accentBorder,
                  }}
                >
                  <Text
                    style={{
                      color: glassColors.warningText,
                      fontSize: ds.fontSize(10),
                      fontWeight: '700',
                    }}
                  >
                    {statusLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: ds.spacing(9),
                marginLeft: 22,
              }}
            >
              <AvatarStack employees={employees} />
              <Text
                numberOfLines={1}
                style={{
                  color: '#8D847A',
                  fontSize: ds.fontSize(12),
                  fontWeight: '500',
                  flex: 1,
                }}
              >
                {employeeSummary}
              </Text>
            </View>

            <Text
              style={{
                color: '#8D847A',
                fontSize: ds.fontSize(12),
                fontWeight: '600',
                marginTop: ds.spacing(8),
                marginLeft: 22,
              }}
            >
              {summaryStats}
            </Text>
          </View>

          {!isExpanded ? (
            <TouchableOpacity
              onPress={(event) => {
                event.stopPropagation();
                onOrderPress();
              }}
              activeOpacity={0.88}
              style={{
                width: 124,
                height: 52,
                borderRadius: 16,
                backgroundColor: glassColors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: glassColors.textOnPrimary,
                  fontSize: ds.fontSize(15),
                  fontWeight: '700',
                }}
              >
                Order
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Pressable>

      {isExpanded ? (
        <Animated.View
          style={[
            contentStyle,
            {
              paddingTop: 0,
            },
          ]}
        >
          <FulfillmentExpandedSupplierItems
            items={items}
            orderLabel={orderLabel}
            onOrderPress={onOrderPress}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
