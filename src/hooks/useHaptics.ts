import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useDisplayStore } from '@/store';

export function useHaptics() {
  const { hapticFeedback } = useDisplayStore();

  const impact = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(style);
    }
  };

  const notification = (type = Haptics.NotificationFeedbackType.Success) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.notificationAsync(type);
    }
  };

  const selection = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
  };

  return {
    impact,
    notification,
    selection,
    // Re-export types for convenience
    ImpactFeedbackStyle: Haptics.ImpactFeedbackStyle,
    NotificationFeedbackType: Haptics.NotificationFeedbackType,
  };
}
