export type ItemCategory =
  | 'fish'
  | 'protein'
  | 'produce'
  | 'dry'
  | 'dairy_cold'
  | 'frozen'
  | 'sauces'
  | 'packaging'
  | 'alcohol';

export type SupplierCategory =
  | 'fish_supplier'
  | 'main_distributor'
  | 'asian_market';

export type UserRole = 'employee' | 'manager';
export type AuthProvider = 'email' | 'google' | 'apple';

export type OrderStatus = 'draft' | 'submitted' | 'processing' | 'fulfilled' | 'cancelled' | 'cancel_requested';
export type OrderInputMode = 'quantity' | 'remaining';

export type UnitType = 'base' | 'pack';

export type CheckFrequency = 'daily' | 'every_2_days' | 'every_3_days' | 'weekly';
export type StockUpdateMethod = 'nfc' | 'qr' | 'manual' | 'quick_select';
export type QuickSelectValue = 'empty' | 'low' | 'good' | 'full';
export type StockCheckStatus = 'in_progress' | 'completed' | 'abandoned';
export type StockScanMethod = 'nfc' | 'qr' | 'manual';
export type StockLevel = 'empty' | 'critical' | 'low' | 'good' | 'full';
export type ReorderUrgency = 'low' | 'medium' | 'high';

export interface Location {
  id: string;
  name: string;
  short_code: string;
  active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  default_location_id: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole | null;
  is_suspended: boolean;
  notifications_enabled: boolean;
  last_active_at: string | null;
  last_order_at: string | null;
  profile_completed: boolean;
  provider: AuthProvider | null;
  created_at: string;
  updated_at: string;
}

export type ReminderThreadStatus = 'active' | 'resolved' | 'cancelled';
export type ReminderEventType = 'sent' | 'reminded_again' | 'auto_resolved' | 'cancelled';
export type RecurringReminderScope = 'employee' | 'location';
export type RecurringReminderCondition = 'no_order_today' | 'days_since_last_order_gte';

export interface ReminderSystemSetting {
  id: string;
  org_id: string;
  overdue_threshold_days: number;
  reminder_rate_limit_minutes: number;
  recurring_window_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface ReminderThread {
  id: string;
  employee_id: string;
  manager_id: string | null;
  location_id: string | null;
  status: ReminderThreadStatus;
  created_at: string;
  resolved_at: string | null;
  cancelled_at: string | null;
  last_reminded_at: string;
  reminder_count: number;
}

export interface ReminderEvent {
  id: string;
  reminder_id: string;
  event_type: ReminderEventType;
  sent_at: string;
  channels_attempted: string[];
  delivery_result: Record<string, unknown>;
}

export interface RecurringReminderRule {
  id: string;
  scope: RecurringReminderScope;
  employee_id: string | null;
  location_id: string | null;
  days_of_week: number[];
  time_of_day: string;
  timezone: string;
  condition_type: RecurringReminderCondition;
  condition_value: number | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  channels: Record<string, unknown>;
  enabled: boolean;
  created_by: string;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InAppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  notification_type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface DevicePushToken {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type OrderLaterItemStatus = 'queued' | 'added' | 'cancelled';
export type OrderLaterLocationGroup = 'sushi' | 'poki';
export type PastOrderShareMethod = 'share' | 'copy';

export interface PastOrderRow {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  created_by: string;
  created_at: string;
  payload: Record<string, unknown>;
  message_text: string;
  share_method: PastOrderShareMethod;
}

export interface OrderLaterItemRow {
  id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  scheduled_at: string;
  item_id: string | null;
  item_name: string;
  unit: string;
  location_id: string | null;
  location_name: string | null;
  notes: string | null;
  preferred_supplier_id: string | null;
  preferred_location_group: OrderLaterLocationGroup | null;
  source_order_item_id: string | null;
  source_order_id: string | null;
  notification_id: string | null;
  status: OrderLaterItemStatus;
  payload: Record<string, unknown>;
  added_at: string | null;
  cancelled_at: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  supplier_category: SupplierCategory;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
  active: boolean;
  created_at: string;
  created_by?: string | null;
}

export interface Order {
  id: string;
  order_number: number;
  user_id: string;
  location_id: string;
  status: OrderStatus;
  notes: string | null;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  inventory_item_id: string;
  quantity: number;
  unit_type: UnitType;
  input_mode: OrderInputMode;
  quantity_requested: number | null;
  remaining_reported: number | null;
  decided_quantity: number | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  supplier_type: SupplierCategory;
  is_default: boolean;
  created_at: string;
}

export interface StorageArea {
  id: string;
  name: string;
  description: string | null;
  location_id: string;
  nfc_tag_id: string | null;
  qr_code: string | null;
  check_frequency: CheckFrequency;
  last_checked_at: string | null;
  last_checked_by: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageAreaWithStatus extends StorageArea {
  item_count: number;
  check_status: 'overdue' | 'due_soon' | 'ok';
}

export interface AreaItem {
  id: string;
  area_id: string;
  inventory_item_id: string;
  min_quantity: number;
  max_quantity: number;
  par_level: number | null;
  current_quantity: number;
  unit_type: string;
  order_unit: string | null;
  conversion_factor: number | null;
  active: boolean;
  last_updated_at: string | null;
  last_updated_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AreaItemWithDetails extends AreaItem {
  inventory_item: InventoryItem;
  stock_level: StockLevel;
}

export interface StockUpdate {
  id: string;
  area_id: string;
  inventory_item_id: string;
  previous_quantity: number | null;
  new_quantity: number;
  updated_by: string;
  update_method: StockUpdateMethod;
  quick_select_value: QuickSelectValue | null;
  photo_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface StockCheckSession {
  id: string;
  area_id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  items_checked: number;
  items_skipped: number;
  items_total: number;
  status: StockCheckStatus;
  scan_method: StockScanMethod;
}

export interface ReorderSuggestion {
  areaItem: AreaItemWithDetails;
  reorderQuantity: number;
  urgency: ReorderUrgency;
}

export interface QuickSelectRange {
  min: number;
  max: number;
}

export type QuickSelectRanges = Record<QuickSelectValue, QuickSelectRange>;

// Joined types for queries
export interface OrderWithDetails extends Order {
  user: User;
  location: Location;
  order_items: OrderItemWithInventory[];
}

export interface OrderItemWithInventory extends OrderItem {
  inventory_item: InventoryItem;
}

// Database schema type for Supabase
export interface Database {
  public: {
    Tables: {
      locations: {
        Row: Location;
        Insert: Omit<Location, 'id' | 'created_at'>;
        Update: Partial<Omit<Location, 'id' | 'created_at'>>;
      };
      users: {
        Row: User;
        Insert: Omit<User, 'id' | 'created_at'>;
        Update: Partial<Omit<User, 'id' | 'created_at'>>;
      };
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole | null;
          is_suspended?: boolean;
          notifications_enabled?: boolean;
          last_active_at?: string | null;
          last_order_at?: string | null;
          profile_completed?: boolean;
          provider?: AuthProvider | null;
        };
        Update: Partial<{
          full_name: string | null;
          role: UserRole | null;
          is_suspended: boolean;
          notifications_enabled: boolean;
          last_active_at: string | null;
          last_order_at: string | null;
          profile_completed: boolean;
          provider: AuthProvider | null;
        }>;
      };
      inventory_items: {
        Row: InventoryItem;
        Insert: Omit<InventoryItem, 'id' | 'created_at'>;
        Update: Partial<Omit<InventoryItem, 'id' | 'created_at'>>;
      };
      orders: {
        Row: Order;
        Insert: Omit<Order, 'id' | 'order_number' | 'created_at'>;
        Update: Partial<Omit<Order, 'id' | 'order_number' | 'created_at'>>;
      };
      order_items: {
        Row: OrderItem;
        Insert: Omit<OrderItem, 'id' | 'created_at'>;
        Update: Partial<Omit<OrderItem, 'id' | 'created_at'>>;
      };
      suppliers: {
        Row: Supplier;
        Insert: Omit<Supplier, 'id' | 'created_at'>;
        Update: Partial<Omit<Supplier, 'id' | 'created_at'>>;
      };
      storage_areas: {
        Row: StorageArea;
        Insert: Omit<StorageArea, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<StorageArea, 'id' | 'created_at' | 'updated_at'>>;
      };
      area_items: {
        Row: AreaItem;
        Insert: Omit<AreaItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AreaItem, 'id' | 'created_at' | 'updated_at'>>;
      };
      stock_updates: {
        Row: StockUpdate;
        Insert: Omit<StockUpdate, 'id' | 'created_at'>;
        Update: Partial<Omit<StockUpdate, 'id' | 'created_at'>>;
      };
      stock_check_sessions: {
        Row: StockCheckSession;
        Insert: Omit<StockCheckSession, 'id'>;
        Update: Partial<Omit<StockCheckSession, 'id'>>;
      };
      reminder_system_settings: {
        Row: ReminderSystemSetting;
        Insert: Omit<ReminderSystemSetting, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ReminderSystemSetting, 'id' | 'created_at' | 'updated_at'>>;
      };
      reminders: {
        Row: ReminderThread;
        Insert: Omit<ReminderThread, 'id' | 'created_at'>;
        Update: Partial<Omit<ReminderThread, 'id' | 'created_at'>>;
      };
      reminder_events: {
        Row: ReminderEvent;
        Insert: Omit<ReminderEvent, 'id' | 'sent_at'>;
        Update: Partial<Omit<ReminderEvent, 'id' | 'sent_at'>>;
      };
      recurring_reminder_rules: {
        Row: RecurringReminderRule;
        Insert: Omit<RecurringReminderRule, 'id' | 'created_at' | 'updated_at' | 'last_triggered_at'>;
        Update: Partial<Omit<RecurringReminderRule, 'id' | 'created_at' | 'updated_at'>>;
      };
      notifications: {
        Row: InAppNotification;
        Insert: Omit<InAppNotification, 'id' | 'created_at' | 'read_at'> & {
          read_at?: string | null;
        };
        Update: Partial<Omit<InAppNotification, 'id' | 'created_at'>>;
      };
      device_push_tokens: {
        Row: DevicePushToken;
        Insert: Omit<DevicePushToken, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DevicePushToken, 'id' | 'created_at' | 'updated_at'>>;
      };
      past_orders: {
        Row: PastOrderRow;
        Insert: Omit<PastOrderRow, 'id' | 'created_at'> & {
          created_at?: string;
        };
        Update: Partial<Omit<PastOrderRow, 'id' | 'created_at'>>;
      };
      order_later_items: {
        Row: OrderLaterItemRow;
        Insert: Omit<OrderLaterItemRow, 'id' | 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<OrderLaterItemRow, 'id' | 'created_at' | 'updated_at'>>;
      };
    };
  };
}
