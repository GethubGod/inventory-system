import React from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ImpactFeedbackStyle, triggerImpactHaptic } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { useSimpleOrderUiStore } from '@/store/simpleOrderUiStore';

/**
 * Floating pill toolbar — the employee app's navigation. White pill with a
 * hairline border and soft shadow, detached from the bottom edge. The active
 * tab gets a tint background plus its label; inactive tabs are icon-only. On
 * the Order tab (and the receive screen) a divider + dots button appends,
 * opening the checklist quick-actions sheet; elsewhere the pill shrinks to
 * just the tabs. Rendered as the Tabs navigator's custom tabBar, driven by
 * the same getVisibleEmployeeTabs derivation the invite preview and
 * Preview-as use.
 */

const PILL_TAB_META: Record<
  string,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  'simple-order': { label: 'Order', icon: 'list-outline' },
  'quick-order': { label: 'Advanced', icon: 'flash-outline' },
  cart: { label: 'Cart', icon: 'bag-handle-outline' },
  history: { label: 'History', icon: 'time-outline' },
  settings: { label: 'Settings', icon: 'person-circle-outline' },
};

/** Hidden routes highlight their pill parent (receive lives under Order, …). */
const ROUTE_PILL_ALIAS: Record<string, string> = {
  'receive-delivery': 'simple-order',
  profile: 'settings',
  orders: 'history',
  index: 'simple-order',
};

/** Routes where the pill appends the divider + quick-actions dots. */
const QUICK_ACTION_ROUTES = new Set(['simple-order', 'receive-delivery']);

export interface FloatingPillTabBarProps extends BottomTabBarProps {
  /** Visible tab route names, in display order (getVisibleEmployeeTabs). */
  visibleTabs: string[];
  cartCount?: number;
}

const INACTIVE_COLOR = '#8A8781';

export function FloatingPillTabBar({
  state,
  navigation,
  insets,
  visibleTabs,
  cartCount = 0,
}: FloatingPillTabBarProps) {
  const requestQuickActions = useSimpleOrderUiStore(
    (uiState) => uiState.requestQuickActions,
  );

  const currentRouteName = state.routes[state.index]?.name ?? '';
  const activePillRoute = ROUTE_PILL_ALIAS[currentRouteName] ?? currentRouteName;
  const showQuickActions = QUICK_ACTION_ROUTES.has(currentRouteName);

  const handleTabPress = (routeName: string) => {
    if (routeName !== currentRouteName) {
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    }
    const route = state.routes.find((entry) => entry.name === routeName);
    const event = navigation.emit({
      type: 'tabPress',
      target: route?.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(routeName as never);
    }
  };

  const handleQuickActions = () => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    if (currentRouteName !== 'simple-order') {
      navigation.navigate('simple-order' as never);
    }
    requestQuickActions();
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: Math.max(insets.bottom, 10) + 4,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          padding: 7,
          borderRadius: radii.pill,
          backgroundColor: tipsTheme.card,
          borderWidth: glassHairlineWidth,
          borderColor: tipsTheme.hairline,
          shadowColor: '#14120E',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.14,
          shadowRadius: 28,
          elevation: Platform.OS === 'android' ? 10 : 0,
        }}
      >
        {visibleTabs.map((routeName) => {
          const meta = PILL_TAB_META[routeName];
          if (!meta) return null;
          const active = routeName === activePillRoute;
          const color = active ? tipsTheme.accent : INACTIVE_COLOR;
          const showBadge = routeName === 'cart' && cartCount > 0;
          return (
            <TouchableOpacity
              key={routeName}
              onPress={() => handleTabPress(routeName)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={meta.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingVertical: 10,
                paddingHorizontal: 15,
                borderRadius: radii.pill,
                backgroundColor: active ? tipsTheme.tint : 'transparent',
              }}
            >
              <View>
                <Ionicons name={meta.icon} size={20} color={color} />
                {showBadge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -5,
                      right: -8,
                      minWidth: 15,
                      height: 15,
                      paddingHorizontal: 3,
                      borderRadius: radii.pill,
                      backgroundColor: tipsTheme.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{ fontSize: 9, fontWeight: '700', color: '#FFFFFF' }}
                      numberOfLines={1}
                    >
                      {cartCount > 99 ? '99+' : cartCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              {active ? (
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: '600',
                    color: tipsTheme.accent,
                  }}
                >
                  {meta.label}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}

        {showQuickActions ? (
          <>
            <View
              style={{
                width: 1,
                height: 22,
                backgroundColor: 'rgba(0, 0, 0, 0.08)',
                marginHorizontal: 5,
              }}
            />
            <TouchableOpacity
              onPress={handleQuickActions}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Quick actions"
              style={{
                paddingVertical: 10,
                paddingHorizontal: 15,
                borderRadius: radii.pill,
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={INACTIVE_COLOR} />
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  );
}

/** Clearance screens should reserve above the pill (pill height + detach gap). */
export function getFloatingPillClearance(insetsBottom: number): number {
  return Math.max(insetsBottom, 10) + 4 + 54 + 12;
}
