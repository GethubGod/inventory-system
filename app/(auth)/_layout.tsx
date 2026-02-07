import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F9FAFB' },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="complete-profile" />
    </Stack>
  );
}
