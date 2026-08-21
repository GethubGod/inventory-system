// The "123" PIN mark from the flow spec. No Ionicons glyph carries this
// meaning, so it is a purpose-built SVG per the onboarding design rules
// (no emoji glyphs anywhere in UI).

import Svg, { Text as SvgText } from 'react-native-svg';

interface PinDigitsIconProps {
  size?: number;
  color: string;
}

export function PinDigitsIcon({ size = 22, color }: PinDigitsIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <SvgText
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="bold"
        fill={color}
      >
        123
      </SvgText>
    </Svg>
  );
}
