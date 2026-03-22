import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  triggerImpactHaptic,
  triggerNotificationHaptic,
  triggerSelectionHaptic,
} from '@/lib/haptics';

export function useHaptics() {
  const impact = (style = ImpactFeedbackStyle.Light) => triggerImpactHaptic(style);
  const notification = (type = NotificationFeedbackType.Success) =>
    triggerNotificationHaptic(type);
  const selection = () => triggerSelectionHaptic();

  return {
    impact,
    notification,
    selection,
    ImpactFeedbackStyle,
    NotificationFeedbackType,
  };
}
