import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { authTheme } from '@/theme/design';
import { PRIVACY_URL, TERMS_URL } from '../legal';

async function openLegalUrl(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open the link', url);
  }
}

/** Terms · Privacy policy — pinned to the bottom of every auth screen. */
export function LegalFooter() {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 14,
        gap: 6,
      }}
    >
      <TouchableOpacity
        onPress={() => openLegalUrl(TERMS_URL)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
      >
        <Text
          style={{
            fontSize: 11,
            color: authTheme.legal,
            textDecorationLine: 'underline',
          }}
        >
          Terms
        </Text>
      </TouchableOpacity>
      <Text style={{ fontSize: 11, color: authTheme.legal }}>·</Text>
      <TouchableOpacity
        onPress={() => openLegalUrl(PRIVACY_URL)}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
      >
        <Text
          style={{
            fontSize: 11,
            color: authTheme.legal,
            textDecorationLine: 'underline',
          }}
        >
          Privacy policy
        </Text>
      </TouchableOpacity>
    </View>
  );
}
