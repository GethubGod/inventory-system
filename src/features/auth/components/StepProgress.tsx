import { Text, View } from 'react-native';
import { authTheme, radii } from '@/theme/design';

interface StepProgressProps {
  step: 1 | 2;
  totalSteps?: number;
}

/** "Step N of 2" label with a thin progress bar (invited setup flow). */
export function StepProgress({ step, totalSteps = 2 }: StepProgressProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: authTheme.textDim }}>
        Step {step} of {totalSteps}
      </Text>
      <View
        style={{
          flex: 1,
          height: 4,
          borderRadius: radii.pill,
          backgroundColor: authTheme.progressTrack,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.round((step / totalSteps) * 100)}%`,
            height: '100%',
            borderRadius: radii.pill,
            backgroundColor: authTheme.accent,
          }}
        />
      </View>
    </View>
  );
}
