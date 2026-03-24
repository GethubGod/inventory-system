import { Redirect, Stack } from 'expo-router';
import { AuthLoadingScreen } from '@/components';
import { useProtectedAuthGuard } from '@/hooks';
import { colors } from '@/theme/design';

export default function OrdersLayout() {
  const guard = useProtectedAuthGuard();

  if (guard.isChecking) {
    return <AuthLoadingScreen />;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        gestureEnabled: true,
        animation: 'simple_push',
      }}
    />
  );
}
