import { Text, TouchableOpacity } from 'react-native';
import { LoadingIndicator } from '@/components';
import { authTheme, radii } from '@/theme/design';

interface AuthPrimaryButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}

/** Pill CTA used across the auth flow (red primary / outlined ghost). */
export function AuthPrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: AuthPrimaryButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
      style={{
        height: 52,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isPrimary ? authTheme.accent : 'transparent',
        borderWidth: isPrimary ? 0 : 1,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        opacity: disabled && !loading ? 0.5 : 1,
      }}
    >
      {loading ? (
        <LoadingIndicator size="small" />
      ) : (
        <Text style={{ color: authTheme.text, fontSize: 15, fontWeight: '700' }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}
