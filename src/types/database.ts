export const KNOWN_ITEM_CATEGORIES = [
  'fish',
  'protein',
  'produce',
  'dry',
  'dairy_cold',
  'frozen',
  'sauces',
  'packaging',
  'alcohol',
] as const;

export type KnownItemCategory = (typeof KNOWN_ITEM_CATEGORIES)[number];
export type ItemCategory = KnownItemCategory | (string & {});

export const KNOWN_SUPPLIER_CATEGORIES = [
  'fish_supplier',
  'main_distributor',
  'asian_market',
] as const;

export type KnownSupplierCategory = (typeof KNOWN_SUPPLIER_CATEGORIES)[number];
export type SupplierCategory = KnownSupplierCategory | (string & {});

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
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  is_suspended: boolean;
  suspended_at: string | null;
  suspended_by: string | null;
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
export type ReminderThreadScope = 'employee' | 'location_banner';
export type RecurringReminderScope = 'employee' | 'location';
export type RecurringReminderCondition = 'no_order_today' | 'days_since_last_order_gte';

export interface ReminderSystemSetting {
  id: string;
  overdue_threshold_days: number;
  reminder_rate_limit_minutes: number;
  recurring_window_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface ReminderThread {
  id: string;
  employee_id: string | null;
  manager_id: string | null;
  location_id: string | null;
  scope: ReminderThreadScope;
  status: ReminderThreadStatus;
  message: string | null;
  sender_name: string | null;
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

export interface PastOrderItemRow {
  id: string;
  past_order_id: string;
  supplier_id: string;
  created_by: string;
  item_id: string;
  item_name: string;
  unit: string;
  quantity: number;
  location_id: string | null;
  location_name: string | null;
  location_group: OrderLaterLocationGroup | null;
  unit_type: UnitType | null;
  ordered_at: string;
  note: string | null;
  created_at: string;
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
  supplier_id?: string | null;
  location_id?: string | null;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
  active: boolean;
  aliases?: string[];
  created_at: string;
  created_by?: string | null;
  hard_cap?: number | null;
  soft_cap?: number | null;
  safety_stock?: number | null;
  target_stock?: number | null;
  default_order_unit?: string | null;
}

export interface Order {
  id: string;
  order_number: number;
  user_id: string;
  location_id: string;
  status: OrderStatus;
  order_type?: string | null;
  entry_method?: 'manual' | 'quick_order' | 'voice_order' | 'suggested_order';
  quick_session_id?: string | null;
  manager_review_status?: 'not_required' | 'pending' | 'approved' | 'changes_requested' | 'rejected';
  manager_review_notes?: string | null;
  manager_reviewed_at?: string | null;
  manager_reviewed_by?: string | null;
  notes: string | null;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
}

export interface ParserExampleRow {
  id: string;
  raw_text: string;
  structured_output: Record<string, unknown>[];
  source: 'manager' | 'correction' | 'seed';
  is_active: boolean;
  created_at: string;
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
  status?: string | null;
  supplier_override_id?: string | null;
  was_suggested?: boolean;
  original_suggested_qty?: number | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  supplier_type?: SupplierCategory | null;
  is_default?: boolean;
  active?: boolean;
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

export interface ItemOrderLimit {
  id: string;
  item_id: string;
  location_id: string | null;
  supplier_id: string | null;
  default_order_unit: string | null;
  typical_min_quantity: number | null;
  typical_max_quantity: number | null;
  soft_max_quantity: number | null;
  hard_max_quantity: number | null;
  manager_approval_quantity: number | null;
  allow_employee_override: boolean;
  allow_manager_override: boolean;
  max_single_order_quantity: number | null;
  max_daily_quantity: number | null;
  max_weekly_quantity: number | null;
  historical_median_quantity: number | null;
  historical_p95_quantity: number | null;
  historical_max_quantity: number | null;
  created_at: string;
  updated_at: string;
}

export interface ItemAllowedUnit {
  id: string;
  item_id: string;
  unit: string;
  is_default: boolean;
  conversion_to_base_unit: number | null;
  min_quantity: number | null;
  soft_max_quantity: number | null;
  hard_max_quantity: number | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeQuickOrderAlias {
  id: string;
  employee_name: string;
  employee_name_key: string;
  employee_user_id: string | null;
  alias_text: string;
  alias_key: string;
  inventory_item_id: string;
  location_id: string | null;
  location_key: string;
  active: boolean;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type EmployeeQuickOrderAliasInsert = Omit<
  EmployeeQuickOrderAlias,
  | 'id'
  | 'employee_name_key'
  | 'alias_key'
  | 'employee_user_id'
  | 'location_id'
  | 'location_key'
  | 'active'
  | 'notes'
  | 'source'
  | 'created_at'
  | 'updated_at'
> & {
  id?: string;
  employee_name_key?: string;
  alias_key?: string;
  employee_user_id?: string | null;
  location_id?: string | null;
  active?: boolean;
  notes?: string | null;
  source?: string;
};

export type EmployeeQuickOrderAliasUpdate = Partial<EmployeeQuickOrderAliasInsert>;

export interface InventoryReorderRule {
  id: string;
  active: boolean;
  location_id: string | null;
  location_key: string;
  inventory_item_id: string;
  applies_to_mode: 'inventory_only' | 'order_only' | 'both';
  trigger_type: 'below' | 'at_or_below' | 'equal' | 'between' | 'at_or_above' | 'always';
  trigger_qty: number | null;
  trigger_qty_max: number | null;
  trigger_qty_key: string;
  trigger_qty_max_key: string;
  trigger_unit: string | null;
  trigger_unit_key: string;
  order_strategy: 'fixed_order_qty' | 'no_order' | 'use_existing_recommendation_engine';
  order_qty: number | null;
  order_unit: string | null;
  priority: number;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type InventoryReorderRuleInsert = Omit<
  InventoryReorderRule,
  | 'id'
  | 'location_key'
  | 'trigger_qty_key'
  | 'trigger_qty_max_key'
  | 'trigger_unit_key'
  | 'active'
  | 'applies_to_mode'
  | 'priority'
  | 'source'
  | 'created_at'
  | 'updated_at'
> & {
  id?: string;
  active?: boolean;
  applies_to_mode?: InventoryReorderRule['applies_to_mode'];
  priority?: number;
  source?: string;
};

export type InventoryReorderRuleUpdate = Partial<InventoryReorderRuleInsert>;

export interface InventoryStatusTerm {
  id: string;
  active: boolean;
  phrase: string;
  phrase_key: string;
  status: 'enough' | 'zero' | 'partial' | 'low' | 'unknown';
  remaining_qty: number | null;
  remaining_unit_behavior: 'none' | 'detected_unit' | 'item_default_unit';
  recommendation_action: 'no_order' | 'check_reorder_rule' | 'ask_quantity' | 'use_existing_recommendation_engine';
  priority: number;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type InventoryStatusTermInsert = Omit<
  InventoryStatusTerm,
  'id' | 'active' | 'priority' | 'source' | 'created_at' | 'updated_at'
> & {
  id?: string;
  active?: boolean;
  priority?: number;
  source?: string;
};

export type InventoryStatusTermUpdate = Partial<InventoryStatusTermInsert>;

export interface CurrentStockSnapshot {
  id: string;
  location_id: string;
  item_id: string;
  quantity: number;
  unit: string | null;
  source_message: string | null;
  source: 'typed' | 'voice';
  entered_by_user_id: string | null;
  quick_order_session_id: string | null;
  confidence: number;
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

type DatabaseTable<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

// Database schema type for Supabase
export interface Database {
  public: {
    Tables: {
      locations: DatabaseTable<
        Location,
        Omit<Location, 'id' | 'created_at'>,
        Partial<Omit<Location, 'id' | 'created_at'>>
      >;
      users: DatabaseTable<
        User,
        Omit<User, 'id' | 'created_at'>,
        Partial<Omit<User, 'id' | 'created_at'>>
      >;
      profiles: DatabaseTable<
        Profile,
        {
          id: string;
          full_name?: string | null;
          role?: UserRole | null;
          is_suspended?: boolean;
          notifications_enabled?: boolean;
          last_active_at?: string | null;
          last_order_at?: string | null;
          profile_completed?: boolean;
          provider?: AuthProvider | null;
        },
        Partial<{
          full_name: string | null;
          role: UserRole | null;
          is_suspended: boolean;
          notifications_enabled: boolean;
          last_active_at: string | null;
          last_order_at: string | null;
          profile_completed: boolean;
          provider: AuthProvider | null;
        }>
      >;
      inventory_items: DatabaseTable<
        InventoryItem,
        Omit<InventoryItem, 'id' | 'created_at'>,
        Partial<Omit<InventoryItem, 'id' | 'created_at'>>
      >;
      orders: DatabaseTable<
        Order,
        Omit<Order, 'id' | 'order_number' | 'created_at'>,
        Partial<Omit<Order, 'id' | 'order_number' | 'created_at'>>
      >;
      order_items: DatabaseTable<
        OrderItem,
        Omit<OrderItem, 'id' | 'created_at'>,
        Partial<Omit<OrderItem, 'id' | 'created_at'>>
      >;
      parser_examples: DatabaseTable<
        ParserExampleRow,
        Omit<ParserExampleRow, 'id' | 'created_at' | 'source'> & {
          source?: ParserExampleRow['source'];
        },
        Partial<Omit<ParserExampleRow, 'id' | 'created_at'>>
      >;
      suppliers: DatabaseTable<
        Supplier,
        Omit<Supplier, 'id' | 'created_at'>,
        Partial<Omit<Supplier, 'id' | 'created_at'>>
      >;
      storage_areas: DatabaseTable<
        StorageArea,
        Omit<StorageArea, 'id' | 'created_at' | 'updated_at'>,
        Partial<Omit<StorageArea, 'id' | 'created_at' | 'updated_at'>>
      >;
      area_items: DatabaseTable<
        AreaItem,
        Omit<AreaItem, 'id' | 'created_at' | 'updated_at'>,
        Partial<Omit<AreaItem, 'id' | 'created_at' | 'updated_at'>>
      >;
      stock_updates: DatabaseTable<
        StockUpdate,
        Omit<StockUpdate, 'id' | 'created_at'>,
        Partial<Omit<StockUpdate, 'id' | 'created_at'>>
      >;
      item_order_limits: DatabaseTable<
        ItemOrderLimit,
        Omit<ItemOrderLimit, 'id' | 'created_at' | 'updated_at'>,
        Partial<Omit<ItemOrderLimit, 'id' | 'created_at' | 'updated_at'>>
      >;
      item_allowed_units: DatabaseTable<
        ItemAllowedUnit,
        Omit<ItemAllowedUnit, 'id' | 'created_at' | 'updated_at'>,
        Partial<Omit<ItemAllowedUnit, 'id' | 'created_at' | 'updated_at'>>
      >;
      employee_quick_order_aliases: DatabaseTable<
        EmployeeQuickOrderAlias,
        EmployeeQuickOrderAliasInsert,
        EmployeeQuickOrderAliasUpdate
      >;
      inventory_reorder_rules: DatabaseTable<
        InventoryReorderRule,
        InventoryReorderRuleInsert,
        InventoryReorderRuleUpdate
      >;
      inventory_status_terms: DatabaseTable<
        InventoryStatusTerm,
        InventoryStatusTermInsert,
        InventoryStatusTermUpdate
      >;
      current_stock_snapshots: DatabaseTable<
        CurrentStockSnapshot,
        Omit<CurrentStockSnapshot, 'id' | 'created_at'>,
        Partial<Omit<CurrentStockSnapshot, 'id' | 'created_at'>>
      >;
      stock_check_sessions: DatabaseTable<
        StockCheckSession,
        Omit<StockCheckSession, 'id'>,
        Partial<Omit<StockCheckSession, 'id'>>
      >;
      reminder_system_settings: DatabaseTable<
        ReminderSystemSetting,
        Omit<ReminderSystemSetting, 'id' | 'created_at' | 'updated_at'>,
        Partial<Omit<ReminderSystemSetting, 'id' | 'created_at' | 'updated_at'>>
      >;
      reminders: DatabaseTable<
        ReminderThread,
        Omit<ReminderThread, 'id' | 'created_at'>,
        Partial<Omit<ReminderThread, 'id' | 'created_at'>>
      >;
      reminder_events: DatabaseTable<
        ReminderEvent,
        Omit<ReminderEvent, 'id' | 'sent_at'>,
        Partial<Omit<ReminderEvent, 'id' | 'sent_at'>>
      >;
      recurring_reminder_rules: DatabaseTable<
        RecurringReminderRule,
        Omit<
          RecurringReminderRule,
          'id' | 'created_at' | 'updated_at' | 'last_triggered_at'
        >,
        Partial<Omit<RecurringReminderRule, 'id' | 'created_at' | 'updated_at'>>
      >;
      notifications: DatabaseTable<
        InAppNotification,
        Omit<InAppNotification, 'id' | 'created_at' | 'read_at'> & {
          read_at?: string | null;
        },
        Partial<Omit<InAppNotification, 'id' | 'created_at'>>
      >;
      device_push_tokens: DatabaseTable<
        DevicePushToken,
        Omit<DevicePushToken, 'id' | 'created_at' | 'updated_at'>,
        Partial<Omit<DevicePushToken, 'id' | 'created_at' | 'updated_at'>>
      >;
      past_orders: DatabaseTable<
        PastOrderRow,
        Omit<PastOrderRow, 'id' | 'created_at'> & {
          created_at?: string;
        },
        Partial<Omit<PastOrderRow, 'id' | 'created_at'>>
      >;
      past_order_items: DatabaseTable<
        PastOrderItemRow,
        Omit<PastOrderItemRow, 'id' | 'created_at' | 'ordered_at' | 'note'> & {
          created_at?: string;
          ordered_at?: string;
          note?: string | null;
        },
        Partial<Omit<PastOrderItemRow, 'id' | 'created_at'>>
      >;
      order_later_items: DatabaseTable<
        OrderLaterItemRow,
        Omit<OrderLaterItemRow, 'id' | 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<OrderLaterItemRow, 'id' | 'created_at' | 'updated_at'>>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
