import { Image, View } from 'react-native';

type AuthLogoHeaderProps = {
  /** Height of the mark; the wordmark scales with it. */
  size?: number;
};

// The full lockup, as delivered — mark plus the red wordmark, scaling as one
// unit. Auth screens are black; the white inside the mark's circle stays white.
const LOCKUP = require('../../assets/images/smelter-lockup.png');

const LOCKUP_ASPECT = 1198 / 257;

export function AuthLogoHeader({ size = 96 }: AuthLogoHeaderProps) {
  return (
    <View className="items-center">
      <Image
        source={LOCKUP}
        style={{ width: Math.round(size * LOCKUP_ASPECT), height: size }}
        resizeMode="contain"
      />
    </View>
  );
}
