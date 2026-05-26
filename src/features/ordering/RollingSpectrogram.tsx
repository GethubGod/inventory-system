import React from 'react';
import Svg, { Rect } from 'react-native-svg';

export const BAR_COUNT = 65;
const BAR_WIDTH = 2;
const BAR_GAP = 2;
const BAR_RADIUS = 1;
const MIN_BAR_HEIGHT = 2;

// Intrinsic coordinate width of the full bar field. The <Svg> scales this
// uniformly to fill its parent, so the spectrogram fits whatever width the
// composer preview strip leaves for it while keeping the spec's bar geometry.
const INTRINSIC_WIDTH = BAR_COUNT * (BAR_WIDTH + BAR_GAP);

type Props = {
  /** Length must equal BAR_COUNT; values 0..1. index 0 = oldest, last = newest. */
  amplitudes: number[];
  width?: number;
  height?: number;
  barColor?: string;
};

function RollingSpectrogramImpl({
  amplitudes,
  width = INTRINSIC_WIDTH,
  height = 22,
  barColor = '#1A1A1A',
}: Props) {
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      {amplitudes.map((amplitude, i) => {
        const value = Math.max(0, Math.min(1, amplitude));
        const barHeight = MIN_BAR_HEIGHT + (height - MIN_BAR_HEIGHT) * value;
        return (
          <Rect
            key={i}
            x={i * (BAR_WIDTH + BAR_GAP)}
            y={(height - barHeight) / 2}
            width={BAR_WIDTH}
            height={barHeight}
            rx={BAR_RADIUS}
            fill={barColor}
          />
        );
      })}
    </Svg>
  );
}

export const RollingSpectrogram = React.memo(RollingSpectrogramImpl);
