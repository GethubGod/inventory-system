import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NotificationSettings,
  ReminderSettings,
  Reminder,
  ExportFormatSettings,
  InventoryView,
  StockSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_REMINDER_SETTINGS,
  DEFAULT_EXPORT_FORMAT_SETTINGS,
  DEFAULT_INVENTORY_VIEW,
  DEFAULT_STOCK_SETTINGS,
} from '@/types/settings';
import type { ComposerMode } from '@/features/ordering/quickOrderComposer';

interface SettingsState {
  // Profile
  avatarUri: string | null;

  // Notifications
  notifications: NotificationSettings;

  // Reminders
  reminders: ReminderSettings;
  exportFormat: ExportFormatSettings;
  inventoryView: InventoryView;
  stockSettings: StockSettings;

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
  resetAllToDefaults: () => void;

  // Quick Order Settings
  quickOrderComposerMode: ComposerMode;
  setQuickOrderComposerMode: (mode: ComposerMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
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

      // Quick Order - Initial State
      quickOrderComposerMode: 'order',

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

      // Quick Order Actions
      setQuickOrderComposerMode: (quickOrderComposerMode) => set({ quickOrderComposerMode }),

      // Reset Actions
      resetAllToDefaults: () =>
        set({
          avatarUri: null,
          notifications: DEFAULT_NOTIFICATION_SETTINGS,
          reminders: DEFAULT_REMINDER_SETTINGS,
          exportFormat: DEFAULT_EXPORT_FORMAT_SETTINGS,
          inventoryView: DEFAULT_INVENTORY_VIEW,
          stockSettings: DEFAULT_STOCK_SETTINGS,
          quickOrderComposerMode: 'order',
        }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
