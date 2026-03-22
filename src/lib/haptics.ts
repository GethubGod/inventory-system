import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useDisplayStore } from '@/store';

export const ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = ExpoHaptics.NotificationFeedbackType;

function canTriggerHaptics() {
  return Platform.OS !== 'web' && useDisplayStore.getState().hapticFeedback;
}

async function performHaptic(effect: () => Promise<unknown>) {
  if (!canTriggerHaptics()) {
    return;
  }

  try {
    await effect();
  } catch {
    // Ignore unsupported-device failures and keep the interaction moving.
  }
}

export function triggerImpactHaptic(
  style: ExpoHaptics.ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle.Light,
) {
  return performHaptic(() => ExpoHaptics.impactAsync(style));
}

export function triggerNotificationHaptic(
  type: ExpoHaptics.NotificationFeedbackType = ExpoHaptics.NotificationFeedbackType.Success,
) {
  return performHaptic(() => ExpoHaptics.notificationAsync(type));
}

export function triggerSelectionHaptic() {
  return performHaptic(() => ExpoHaptics.selectionAsync());
}

export function triggerConfirmationHaptic() {
  return triggerNotificationHaptic(ExpoHaptics.NotificationFeedbackType.Success);
}
