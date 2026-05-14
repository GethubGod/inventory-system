export type QuickOrderShortcut = {
  icon: 'time-outline' | 'calendar-outline' | 'star-outline';
  label: string;
  /** Text fed to the parser — must match the intents it recognises. */
  intent: string;
};

export const QUICK_ORDER_SHORTCUTS: QuickOrderShortcut[] = [
  { icon: 'time-outline', label: 'Reorder recent', intent: 'reorder recent' },
  { icon: 'calendar-outline', label: 'Last week', intent: 'last week' },
  { icon: 'star-outline', label: 'Usual order', intent: 'usual order' },
];
