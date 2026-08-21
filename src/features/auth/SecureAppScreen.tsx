// Screen 04 — Secure your app. Two option cards: restaurant PIN (primary)
// and create-a-password (secondary). Both ship (confirmed decision).

import { Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PinDigitsIcon } from '@/components/icons/PinDigitsIcon';
import { authTheme } from '@/theme/design';
import { AuthScreenShell } from './components/AuthScreenShell';
import { StepProgress } from './components/StepProgress';
import { useOnboardingStore } from './onboardingStore';

interface OptionCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  highlighted?: boolean;
  onPress: () => void;
}

function OptionCard({ title, subtitle, icon, highlighted = false, onPress }: OptionCardProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: authTheme.well,
        borderWidth: 1,
        borderColor: highlighted ? authTheme.accent : authTheme.wellBorder,
        borderRadius: 17,
        padding: 15,
        marginBottom: 10,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: highlighted ? authTheme.accentSoft : authTheme.wellIcon,
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: authTheme.text }}>{title}</Text>
        <Text style={{ fontSize: 12, color: authTheme.textDim, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.4)" />
    </TouchableOpacity>
  );
}

export default function SecureAppScreen() {
  const router = useRouter();
  const token = useOnboardingStore((state) => state.token);

  // Deep-linking straight here without an invite makes no sense — restart.
  if (!token) {
    return <Redirect href={'/(auth)/welcome' as never} />;
  }

  return (
    <AuthScreenShell>
      <StepProgress step={2} />
      <Text style={{ fontSize: 21, fontWeight: '700', color: authTheme.text, marginBottom: 3 }}>
        Secure your app
      </Text>
      <Text style={{ fontSize: 13, color: authTheme.textDim, marginBottom: 18 }}>
        Pick one. You can change it later.
      </Text>

      <OptionCard
        title="Use your restaurant PIN"
        subtitle="The same 4-digit code you use at the register"
        icon={<PinDigitsIcon size={24} color={authTheme.accent} />}
        highlighted
        onPress={() => router.push('/(auth)/secure-pin' as Parameters<typeof router.push>[0])}
      />
      <OptionCard
        title="Create a password"
        subtitle="Saves to iPhone autofill so you never retype it"
        icon={<Ionicons name="lock-closed-outline" size={20} color={authTheme.text} />}
        onPress={() =>
          router.push('/(auth)/secure-password' as Parameters<typeof router.push>[0])
        }
      />
      <View style={{ flex: 1 }} />
    </AuthScreenShell>
  );
}
