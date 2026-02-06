import { Image, View } from 'react-native';

type AuthLogoHeaderProps = {
  size?: number;
};

const LOGO_SOURCE = require('../../assets/images/babytuna-logo.png');

export function AuthLogoHeader({ size = 128 }: AuthLogoHeaderProps) {
  return (
    <View className="items-center">
      <Image
        source={LOGO_SOURCE}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}
