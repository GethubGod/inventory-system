import { Stack } from 'expo-router';
import { authTheme, colors } from '@/theme/design';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="welcome" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="invite-hello" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="secure" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="secure-pin" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="secure-password" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="ready" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="sign-in" options={{ contentStyle: { backgroundColor: authTheme.background } }} />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="complete-profile" />
    </Stack>
  );
}
