import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QuickOrderScreen as QuickOrderChatScreen } from '@/features/ordering/QuickOrderScreen';
import { EMPLOYEE_ORDERING_MODE } from '@/features/ordering/modes';
import { useModuleAccessGuard } from '@/hooks';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';

/**
 * Compact screen header carrying the Beta hint for the renamed surface.
 * The tab bar shows the space-constrained "Advanced" label; this header keeps
 * the full "Advanced ordering (Beta)" name visible on the screen itself.
 */
function AdvancedOrderingHeader() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Text style={styles.headerTitle}>Advanced ordering</Text>
      <View style={styles.betaPill}>
        <Text style={styles.betaPillText}>BETA</Text>
      </View>
    </View>
  );
}

export default function QuickOrderScreen() {
  // Phase 3: this surface is gated by the ordering_advanced module. Deep links
  // to a disabled module redirect home, mirroring how role guards behave.
  const guard = useModuleAccessGuard('ordering_advanced');

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <View style={styles.container}>
      <AdvancedOrderingHeader />
      <ErrorBoundary title="Advanced ordering unavailable">
        <QuickOrderChatScreen mode={EMPLOYEE_ORDERING_MODE} />
      </ErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 8,
    backgroundColor: colors.background,
    borderBottomWidth: glassHairlineWidth,
    borderBottomColor: glassColors.cardBorder,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: glassColors.textPrimary,
    letterSpacing: 0.1,
  },
  betaPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(232, 80, 58, 0.10)',
    borderWidth: glassHairlineWidth,
    borderColor: 'rgba(232, 80, 58, 0.18)',
  },
  betaPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.6,
  },
});
