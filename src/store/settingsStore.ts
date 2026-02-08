import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FontSize,
  TextScale,
  UIScale,
  ButtonSize,
  Theme,
  NotificationSettings,
  ReminderSettings,
  Reminder,
  ExportFormatSettings,
  InventoryView,
  StockSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_REMINDER_SETTINGS,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_EXPORT_FORMAT_SETTINGS,
  DEFAULT_INVENTORY_VIEW,
  DEFAULT_STOCK_SETTINGS,
} from '@/types/settings';

interface SettingsState {
  // Display & Accessibility
  fontSize: FontSize;
  textScale: TextScale;
  uiScale: UIScale;
  buttonSize: ButtonSize;
  theme: Theme;
  hapticFeedback: boolean;
  reduceMotion: boolean;

  // Profile
  avatarUri: string | null;

  // Notifications
  notifications: NotificationSettings;

  // Reminders
  reminders: ReminderSettings;
  exportFormat: ExportFormatSettings;
  inventoryView: InventoryView;
  stockSettings: StockSettings;

  // Display Actions
  setFontSize: (size: FontSize) => void;
  setTextScale: (scale: TextScale) => void;
  setUIScale: (scale: UIScale) => void;
  setButtonSize: (size: ButtonSize) => void;
  setTheme: (theme: Theme) => void;
  setHapticFeedback: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;

  // Profile Actions
  setAvatarUri: (uri: string | null) => void;

  // Notification Actions
  setNotificationSettings: (settings: Partial<NotificationSettings>) => void;
  setQuietHours: (quietHours: Partial<NotificationSettings['quietHours']>) => void;

  // Reminder Actions
  setReminderSettings: (settings: Partial<ReminderSettings>) => void;
  addReminder: (reminder: Omit<Reminder, 'id' | 'createdAt'>) => void;
  updateReminder: (id: string, updates: Partial<Reminder>) => void;
  deleteReminder: (id: string) => void;
  toggleReminder: (id: string) => void;

  // Export Format Actions
  setExportFormat: (settings: Partial<ExportFormatSettings>) => void;
  setInventoryView: (view: InventoryView) => void;
  setStockSettings: (settings: Partial<StockSettings>) => void;

  // Reset
  resetDisplayToDefaults: () => void;
  resetAllToDefaults: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Display & Accessibility - Initial State
      fontSize: DEFAULT_DISPLAY_SETTINGS.fontSize,
      textScale: DEFAULT_DISPLAY_SETTINGS.textScale,
      uiScale: DEFAULT_DISPLAY_SETTINGS.uiScale,
      buttonSize: DEFAULT_DISPLAY_SETTINGS.buttonSize,
      theme: DEFAULT_DISPLAY_SETTINGS.theme,
      hapticFeedback: DEFAULT_DISPLAY_SETTINGS.hapticFeedback,
      reduceMotion: DEFAULT_DISPLAY_SETTINGS.reduceMotion,

      // Profile - Initial State
      avatarUri: null,

      // Notifications - Initial State
      notifications: DEFAULT_NOTIFICATION_SETTINGS,

      // Reminders - Initial State
      reminders: DEFAULT_REMINDER_SETTINGS,

      // Export Format - Initial State
      exportFormat: DEFAULT_EXPORT_FORMAT_SETTINGS,
      inventoryView: DEFAULT_INVENTORY_VIEW,
      stockSettings: DEFAULT_STOCK_SETTINGS,

      // Display Actions
      setFontSize: (fontSize) => set({ fontSize }),

      setTextScale: (textScale) => set({ textScale }),

      setUIScale: (uiScale) => set({ uiScale }),

      setButtonSize: (buttonSize) => set({ buttonSize }),

      setTheme: (theme) => set({ theme }),

      setHapticFeedback: (hapticFeedback) => set({ hapticFeedback }),

      setReduceMotion: (reduceMotion) => set({ reduceMotion }),

      // Profile Actions
      setAvatarUri: (avatarUri) => set({ avatarUri }),

      // Notification Actions
      setNotificationSettings: (settings) =>
        set((state) => ({
          notifications: { ...state.notifications, ...settings },
        })),

      setQuietHours: (quietHours) =>
        set((state) => ({
          notifications: {
            ...state.notifications,
            quietHours: { ...state.notifications.quietHours, ...quietHours },
          },
        })),

      // Reminder Actions
      setReminderSettings: (settings) =>
        set((state) => ({
          reminders: { ...state.reminders, ...settings },
        })),

      addReminder: (reminder) =>
        set((state) => ({
          reminders: {
            ...state.reminders,
            reminders: [
              ...state.reminders.reminders,
              {
                ...reminder,
                id: `reminder-${Date.now()}`,
                createdAt: Date.now(),
              },
            ],
          },
        })),

      updateReminder: (id, updates) =>
        set((state) => ({
          reminders: {
            ...state.reminders,
            reminders: state.reminders.reminders.map((r) =>
              r.id === id ? { ...r, ...updates } : r
            ),
          },
        })),

      deleteReminder: (id) =>
        set((state) => ({
          reminders: {
            ...state.reminders,
            reminders: state.reminders.reminders.filter((r) => r.id !== id),
          },
        })),

      toggleReminder: (id) =>
        set((state) => ({
          reminders: {
            ...state.reminders,
            reminders: state.reminders.reminders.map((r) =>
              r.id === id ? { ...r, enabled: !r.enabled } : r
            ),
          },
        })),

      setExportFormat: (settings) =>
        set((state) => ({
          exportFormat: { ...state.exportFormat, ...settings },
        })),

      setInventoryView: (inventoryView) => set({ inventoryView }),

      setStockSettings: (settings) =>
        set((state) => ({
          stockSettings: { ...state.stockSettings, ...settings },
        })),

      // Reset Actions
      resetDisplayToDefaults: () =>
        set({
          fontSize: DEFAULT_DISPLAY_SETTINGS.fontSize,
          textScale: DEFAULT_DISPLAY_SETTINGS.textScale,
          uiScale: DEFAULT_DISPLAY_SETTINGS.uiScale,
          buttonSize: DEFAULT_DISPLAY_SETTINGS.buttonSize,
          theme: DEFAULT_DISPLAY_SETTINGS.theme,
          hapticFeedback: DEFAULT_DISPLAY_SETTINGS.hapticFeedback,
          reduceMotion: DEFAULT_DISPLAY_SETTINGS.reduceMotion,
        }),

      resetAllToDefaults: () =>
        set({
          fontSize: DEFAULT_DISPLAY_SETTINGS.fontSize,
          textScale: DEFAULT_DISPLAY_SETTINGS.textScale,
          uiScale: DEFAULT_DISPLAY_SETTINGS.uiScale,
          buttonSize: DEFAULT_DISPLAY_SETTINGS.buttonSize,
          theme: DEFAULT_DISPLAY_SETTINGS.theme,
          hapticFeedback: DEFAULT_DISPLAY_SETTINGS.hapticFeedback,
          reduceMotion: DEFAULT_DISPLAY_SETTINGS.reduceMotion,
          avatarUri: null,
          notifications: DEFAULT_NOTIFICATION_SETTINGS,
          reminders: DEFAULT_REMINDER_SETTINGS,
          exportFormat: DEFAULT_EXPORT_FORMAT_SETTINGS,
          inventoryView: DEFAULT_INVENTORY_VIEW,
          stockSettings: DEFAULT_STOCK_SETTINGS,
        }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Re-export FontSize type for backward compatibility
export type { FontSize };
