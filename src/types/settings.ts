// Settings Types for Babytuna App

export type FontSize = 'normal' | 'large' | 'xlarge';
export type TextScale = 0.8 | 0.9 | 1.0 | 1.1 | 1.4;
export type UIScale = 'compact' | 'default' | 'large';
export type ButtonSize = 'small' | 'medium' | 'large';
export type Theme = 'light' | 'system' | 'dark';
export type RepeatType = 'daily' | 'weekly' | 'custom';
export type InventoryView = 'list' | 'compact';

export interface StockSettings {
  flagUnusualQuantities: boolean;
  resumeReminders: boolean;
}

export interface QuietHours {
  enabled: boolean;
  startTime: string; // "HH:MM" format
  endTime: string;   // "HH:MM" format
}

export interface NotificationSettings {
  pushEnabled: boolean;
  orderStatus: boolean;
  newOrders: boolean;
  dailySummary: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  quietHours: QuietHours;
}

export interface Reminder {
  id: string;
  name: string;
  message: string;
  enabled: boolean;
  repeatType: RepeatType;
  selectedDays: number[];  // 0-6 for Sunday-Saturday
  time: string;            // "HH:MM" format
  createdAt: number;
}

export interface ReminderSettings {
  enabled: boolean;
  reminders: Reminder[];
  noOrderTodayReminder: boolean;
  beforeClosingReminder: boolean;
  closingTime: string; // "HH:MM" format
}

export interface ExportFormatSettings {
  template: string;
}

export interface DisplaySettings {
  fontSize: FontSize;
  textScale: TextScale;
  uiScale: UIScale;
  buttonSize: ButtonSize;
  theme: Theme;
  hapticFeedback: boolean;
  reduceMotion: boolean;
}

// Default values
export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startTime: '22:00',
  endTime: '07:00',
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  pushEnabled: true,
  orderStatus: true,
  newOrders: true,
  dailySummary: false,
  soundEnabled: true,
  vibrationEnabled: true,
  quietHours: DEFAULT_QUIET_HOURS,
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  reminders: [],
  noOrderTodayReminder: false,
  beforeClosingReminder: false,
  closingTime: '21:00',
};

export const DEFAULT_EXPORT_FORMAT_SETTINGS: ExportFormatSettings = {
  template:
    "Hi, I'd like to place an order:\n\nORDER - Babytuna\nSupplier: {{supplier}}\nDate: {{date}}\n\n{{items}}\n\nPlease confirm availability.\nThank you!",
};

export const DEFAULT_INVENTORY_VIEW: InventoryView = 'list';

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  flagUnusualQuantities: true,
  resumeReminders: true,
};

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  fontSize: 'normal',
  textScale: 1.0,
  uiScale: 'default',
  buttonSize: 'medium',
  theme: 'system',
  hapticFeedback: true,
  reduceMotion: false,
};

// Text scale steps for the slider
export const TEXT_SCALE_STEPS: TextScale[] = [0.8, 0.9, 1.0, 1.1, 1.4];
export const TEXT_SCALE_LABELS = ['0.8x', '0.9x', '1.0x', '1.1x', '1.4x'];

// Button size pixel values
export const BUTTON_SIZE_VALUES: Record<ButtonSize, number> = {
  small: 44,
  medium: 52,
  large: 60,
};

// UI scale multipliers
export const UI_SCALE_MULTIPLIERS: Record<UIScale, number> = {
  compact: 0.85,
  default: 1.0,
  large: 1.15,
};
