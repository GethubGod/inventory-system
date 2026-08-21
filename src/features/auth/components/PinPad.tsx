import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerImpactHaptic, ImpactFeedbackStyle } from '@/lib/haptics';
import { authTheme } from '@/theme/design';
import { PIN_LENGTH } from '@/services/loginCredentials';

interface PinDotsProps {
  filled: number;
  error?: boolean;
}

/** Four entry dots; filled ones turn accent (alert red on mismatch). */
export function PinDots({ filled, error = false }: PinDotsProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 14,
        marginVertical: 18,
      }}
    >
      {Array.from({ length: PIN_LENGTH }, (_, index) => {
        const on = index < filled;
        return (
          <View
            key={index}
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 1.5,
              borderColor: on ? authTheme.accent : 'rgba(255, 255, 255, 0.35)',
              backgroundColor: on ? authTheme.accent : 'transparent',
              opacity: error ? 0.55 : 1,
            }}
          />
        );
      })}
    </View>
  );
}

interface PinPadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}

const PAD_ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'backspace'],
];

/** Custom 4-digit pad: digit wells, backspace, haptic ticks. */
export function PinPad({ onDigit, onBackspace, disabled = false }: PinPadProps) {
  const handlePress = (key: string) => {
    triggerImpactHaptic(ImpactFeedbackStyle.Light);
    if (key === 'backspace') {
      onBackspace();
    } else {
      onDigit(key);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {PAD_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row', gap: 10 }}>
          {row.map((key, keyIndex) =>
            key === '' ? (
              <View key={keyIndex} style={{ flex: 1 }} />
            ) : (
              <TouchableOpacity
                key={keyIndex}
                onPress={() => handlePress(key)}
                disabled={disabled}
                activeOpacity={0.7}
                accessibilityLabel={key === 'backspace' ? 'Delete digit' : `Digit ${key}`}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: key === 'backspace' ? 'transparent' : authTheme.well,
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {key === 'backspace' ? (
                  <Ionicons name="backspace-outline" size={24} color={authTheme.textDim} />
                ) : (
                  <Text style={{ fontSize: 22, fontWeight: '700', color: authTheme.text }}>
                    {key}
                  </Text>
                )}
              </TouchableOpacity>
            ),
          )}
        </View>
      ))}
    </View>
  );
}
