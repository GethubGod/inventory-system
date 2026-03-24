import { View } from 'react-native';
import { colors } from '@/theme/design';
import { LoadingIndicator } from './LoadingIndicator';

export function AuthLoadingScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
      }}
    >
      <LoadingIndicator size="large" showText text="Loading..." />
    </View>
  );
}
