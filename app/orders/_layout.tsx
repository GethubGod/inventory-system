import { Stack } from 'expo-router';

export default function OrdersLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F9FAFB' },
      }}
    />
  );
}
